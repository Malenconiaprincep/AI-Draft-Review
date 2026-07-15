import { canonicalDocumentToDraftDoc } from "./canonical.ts";
import { ConnectorError, errorCodeForStatus, readErrorBody } from "./errors.ts";
import { parseMarkdownToCanonical } from "./markdown.ts";
import { notionMarkdownAdapter } from "./notion-markdown-adapter.ts";
import type {
  CanonicalDocument,
  ContentImportResult,
  ExternalDocumentRef,
  FetchLike,
  ImportWarning
} from "./types.ts";

const MAX_PUBLIC_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PUBLIC_BLOCKS = 20_000;
const MAX_PUBLIC_BLOCK_DEPTH = 100;

type JsonRecord = Record<string, unknown>;

type NotionPublicBlock = {
  id: string;
  type: string;
  alive?: boolean;
  content?: string[];
  properties?: JsonRecord;
  format?: JsonRecord;
  last_edited_time?: number | string;
};

type NotionRichText = Array<[string, unknown?]>;

export async function importPublicNotionDocument(input: {
  fetch: FetchLike;
  apiBaseUrl: string;
  ref: ExternalDocumentRef;
}): Promise<ContentImportResult> {
  let response: Response | undefined;
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await input.fetch(`${input.apiBaseUrl}/api/v3/loadCachedPageChunk`, {
        method: "POST",
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; TuttiPublicDocumentPreview/1.0)"
        },
        body: JSON.stringify({
          pageId: input.ref.id,
          limit: 100,
          cursor: { stack: [] },
          chunkNumber: 0,
          verticalColumns: false
        })
      });
      break;
    } catch (error) {
      lastNetworkError = error;
      if (attempt === 0) await delay(200);
    }
  }

  if (!response) {
    throw new ConnectorError({
      provider: "notion",
      code: "provider_error",
      message: "匿名访问 Notion 公开链接失败，请稍后重试。",
      status: 502,
      retryable: true,
      details: lastNetworkError instanceof Error ? lastNetworkError.message : lastNetworkError
    });
  }

  if (!response.ok) {
    const code = errorCodeForStatus(response.status);
    throw new ConnectorError({
      provider: "notion",
      code,
      message: response.status === 404
        ? "Notion 公开链接不存在、已失效，或页面没有开启公开访问。"
        : "这个 Notion 页面无法匿名读取，需要连接 Notion 后重试。",
      status: response.status,
      retryable: code === "rate_limited" || response.status >= 500,
      details: await readErrorBody(response)
    });
  }

  const text = await readLimitedResponseText(response);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw invalidPublicResponse("Notion 公开页面返回了无法识别的数据格式。");
  }

  return canonicalDocumentToDraftDoc(parseNotionPublicPageChunk(payload, input.ref));
}

export function parseNotionPublicPageChunk(
  payload: unknown,
  ref: ExternalDocumentRef
): CanonicalDocument {
  const recordMap = asRecord(asRecord(payload).recordMap);
  const rawBlocks = asRecord(recordMap.block);
  const entries = Object.entries(rawBlocks);
  if (entries.length > MAX_PUBLIC_BLOCKS) {
    throw invalidPublicResponse("Notion 公开页面包含过多内容块，无法安全生成预览。");
  }

  const blocks = new Map<string, NotionPublicBlock>();
  for (const [id, record] of entries) {
    const block = unwrapBlockRecord(record);
    if (block) blocks.set(block.id || id, block);
  }

  const root = blocks.get(ref.id);
  if (!root) {
    throw new ConnectorError({
      provider: "notion",
      code: "access_denied",
      message: "这个 Notion 页面没有向匿名访客开放，请连接 Notion 后重试。",
      status: 401
    });
  }
  if (root.alive === false) {
    throw new ConnectorError({
      provider: "notion",
      code: "not_found",
      message: "Notion 公开页面已被删除或取消分享。",
      status: 404
    });
  }

  const renderer = new PublicNotionRenderer(blocks, ref.url);
  const markdown = renderer.render(root.content ?? []);
  const parsed = parseMarkdownToCanonical(markdown, "notion", notionMarkdownAdapter);
  const revision = notionTimestamp(root.last_edited_time);

  return {
    ref,
    title: richTextPlain(root.properties?.title) || "Untitled Notion page",
    revision,
    lastEditedAt: revision,
    content: parsed.content,
    assets: parsed.assets,
    warnings: [
      ...renderer.warnings,
      ...parsed.warnings,
      {
        code: "format_downgraded",
        message: "此预览来自 Notion 匿名公开页面；数据库视图、评论和部分高级 Block 可能被降级。"
      }
    ]
  };
}

class PublicNotionRenderer {
  readonly warnings: ImportWarning[] = [];
  private readonly blocks: ReadonlyMap<string, NotionPublicBlock>;
  private readonly sourceUrl?: string;
  private readonly visited = new Set<string>();
  private readonly warnedTypes = new Set<string>();

  constructor(blocks: ReadonlyMap<string, NotionPublicBlock>, sourceUrl?: string) {
    this.blocks = blocks;
    this.sourceUrl = sourceUrl;
  }

  render(ids: string[], depth = 0): string {
    if (depth > MAX_PUBLIC_BLOCK_DEPTH) {
      this.warnings.push({
        code: "partial_document",
        message: "Notion 页面嵌套层级过深，部分内容未展开。"
      });
      return "";
    }

    const chunks: string[] = [];
    for (let index = 0; index < ids.length;) {
      const block = this.blocks.get(ids[index]);
      if (!block || block.alive === false) {
        index += 1;
        continue;
      }
      const listKind = notionListKind(block.type);
      if (listKind) {
        const items: string[] = [];
        while (index < ids.length) {
          const item = this.blocks.get(ids[index]);
          if (!item || notionListKind(item.type) !== listKind) break;
          items.push(this.renderListItem(item, depth));
          index += 1;
        }
        chunks.push(items.filter(Boolean).join("\n"));
        continue;
      }
      chunks.push(this.renderBlock(block, depth));
      index += 1;
    }
    return chunks.filter(Boolean).join("\n\n");
  }

  private renderBlock(block: NotionPublicBlock, depth: number): string {
    if (this.visited.has(block.id)) return "";
    this.visited.add(block.id);
    const title = richTextMarkdown(block.properties?.title);
    const children = this.render(block.content ?? [], depth + 1);

    switch (block.type) {
      case "text":
        return [title, children].filter(Boolean).join("\n\n");
      case "header":
        return `# ${title}`;
      case "sub_header":
        return `## ${title}`;
      case "sub_sub_header":
        return `### ${title}`;
      case "quote":
        return prefixLines([title, children].filter(Boolean).join("\n\n"), "> ");
      case "callout": {
        const icon = richTextPlain(block.format?.page_icon) || "💡";
        return `<callout icon="${escapeHtmlAttribute(icon)}">\n${[title, children].filter(Boolean).join("\n\n")}\n</callout>`;
      }
      case "toggle":
        return `<details><summary>${title || "Details"}</summary>${children ? `\n${children.replace(/\n{2,}/g, "\n")}\n` : ""}</details>`;
      case "divider":
        return "---";
      case "code": {
        const code = richTextPlain(block.properties?.title);
        const language = richTextPlain(block.properties?.language)
          || stringValue(block.format?.code_language)
          || "";
        const fence = code.includes("```") ? "````" : "```";
        return `${fence}${language}\n${code}\n${fence}`;
      }
      case "equation":
        return `$$\n${richTextPlain(block.properties?.title)}\n$$`;
      case "image":
        return renderImage(block);
      case "video":
      case "audio":
      case "file":
      case "pdf":
        return renderMedia(block);
      case "bookmark":
      case "embed": {
        const url = blockSource(block);
        return url ? `[${title || url}](${escapeMarkdownUrl(url)})` : title;
      }
      case "column_list":
        return `<columns>\n${children}\n</columns>`;
      case "column":
        return `<column>\n${children}\n</column>`;
      case "table":
        return renderTable(block, this.blocks);
      case "table_row":
      case "breadcrumb":
        return "";
      case "page":
      case "collection_view":
      case "collection_view_page": {
        this.warnUnsupported(block.type, block.id);
        const label = title || (block.type === "page" ? "Notion 子页面" : "Notion 数据库视图");
        return `[${label}](${this.blockUrl(block.id)})`;
      }
      default:
        this.warnUnsupported(block.type, block.id);
        return [title, children].filter(Boolean).join("\n\n");
    }
  }

  private renderListItem(block: NotionPublicBlock, depth: number): string {
    if (this.visited.has(block.id)) return "";
    this.visited.add(block.id);
    const marker = block.type === "numbered_list"
      ? "1."
      : block.type === "to_do"
        ? `- [${block.properties?.checked === true ? "x" : " "}]`
        : "-";
    const title = richTextMarkdown(block.properties?.title);
    const children = this.render(block.content ?? [], depth + 1);
    const indentedChildren = children ? `\n${indentLines(children, 4)}` : "";
    return `${marker} ${title}${indentedChildren}`;
  }

  private blockUrl(blockId: string): string {
    const compact = blockId.replace(/-/g, "");
    if (!this.sourceUrl) return `https://app.notion.com/p/${compact}`;
    try {
      const url = new URL(this.sourceUrl);
      return `${url.origin}/p/${compact}`;
    } catch {
      return `https://app.notion.com/p/${compact}`;
    }
  }

  private warnUnsupported(type: string, sourceId: string) {
    if (this.warnedTypes.has(type)) return;
    this.warnedTypes.add(type);
    this.warnings.push({
      code: "unsupported_block",
      sourceId,
      message: `Notion ${type} Block 已降级为文本或链接。`
    });
  }
}

function notionListKind(type: string): "bullet" | "ordered" | undefined {
  if (type === "bulleted_list" || type === "to_do") return "bullet";
  if (type === "numbered_list") return "ordered";
  return undefined;
}

function unwrapBlockRecord(value: unknown): NotionPublicBlock | undefined {
  let current = asRecord(value);
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current.id === "string" && typeof current.type === "string") {
      return current as NotionPublicBlock;
    }
    const next = asRecord(current.value);
    if (!Object.keys(next).length) return undefined;
    current = next;
  }
  return undefined;
}

function richTextMarkdown(value: unknown): string {
  if (typeof value === "string") return escapeMarkdownText(value);
  if (!Array.isArray(value)) return "";
  return (value as NotionRichText).map((segment) => {
    if (!Array.isArray(segment) || typeof segment[0] !== "string") return "";
    const decorations = Array.isArray(segment[1]) ? segment[1] : [];
    let text = escapeMarkdownText(segment[0]);
    let link: string | undefined;
    let code = false;
    let bold = false;
    let italic = false;
    let strike = false;
    for (const rawDecoration of decorations) {
      if (!Array.isArray(rawDecoration)) continue;
      if (rawDecoration[0] === "a" && typeof rawDecoration[1] === "string") link = rawDecoration[1];
      if (rawDecoration[0] === "c") code = true;
      if (rawDecoration[0] === "b") bold = true;
      if (rawDecoration[0] === "i") italic = true;
      if (rawDecoration[0] === "s") strike = true;
    }
    if (code) text = `\`${segment[0].replace(/`/g, "\\`")}\``;
    if (bold) text = `**${text}**`;
    if (italic) text = `_${text}_`;
    if (strike) text = `~~${text}~~`;
    if (link) text = `[${text}](${escapeMarkdownUrl(link)})`;
    return text;
  }).join("");
}

function richTextPlain(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((segment) => Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : "").join("");
}

function renderImage(block: NotionPublicBlock): string {
  const source = blockSource(block);
  if (!source) return richTextMarkdown(block.properties?.caption);
  const caption = richTextPlain(block.properties?.caption) || richTextPlain(block.properties?.title);
  return `![${escapeMarkdownText(caption)}](${escapeMarkdownUrl(source)})`;
}

function renderMedia(block: NotionPublicBlock): string {
  const source = blockSource(block);
  if (!source) return richTextMarkdown(block.properties?.caption);
  const tag = block.type === "pdf" ? "pdf" : block.type;
  const caption = richTextPlain(block.properties?.caption) || richTextPlain(block.properties?.title) || tag;
  return `<${tag} src="${escapeHtmlAttribute(source)}">${escapeHtml(caption)}</${tag}>`;
}

function blockSource(block: NotionPublicBlock): string {
  return richTextPlain(block.properties?.source)
    || stringValue(block.format?.display_source)
    || stringValue(block.format?.source)
    || "";
}

function renderTable(block: NotionPublicBlock, blocks: ReadonlyMap<string, NotionPublicBlock>): string {
  const rows = (block.content ?? []).flatMap((id) => {
    const row = blocks.get(id);
    if (!row || row.type !== "table_row") return [];
    const cells = Array.isArray(row.properties?.title) ? row.properties.title : [];
    return [`<tr>${cells.map((cell) => `<td>${escapeHtml(richTextPlain(cell))}</td>`).join("")}</tr>`];
  });
  return rows.length ? `<table>\n${rows.join("\n")}\n</table>` : "";
}

function notionTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) return new Date(numeric).toISOString();
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toISOString();
  }
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;
}

async function readLimitedResponseText(response: Response): Promise<string> {
  const announcedSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_PUBLIC_RESPONSE_BYTES) {
    throw invalidPublicResponse("Notion 公开页面过大，无法安全生成预览。");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PUBLIC_RESPONSE_BYTES) {
      await reader.cancel();
      throw invalidPublicResponse("Notion 公开页面过大，无法安全生成预览。");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function invalidPublicResponse(message: string): ConnectorError {
  return new ConnectorError({
    provider: "notion",
    code: "invalid_provider_response",
    message,
    status: 502
  });
}

function prefixLines(value: string, prefix: string): string {
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function indentLines(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_[\]~<>])/g, "\\$1");
}

function escapeMarkdownUrl(value: string): string {
  return value.replace(/\\/g, "%5C").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
