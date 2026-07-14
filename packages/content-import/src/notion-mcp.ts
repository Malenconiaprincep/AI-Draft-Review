import { canonicalDocumentToDraftDoc } from "./canonical.ts";
import { parseMarkdownToCanonical } from "./markdown.ts";
import { notionMarkdownAdapter } from "./notion-markdown-adapter.ts";
import { parseNotionPageId } from "./notion.ts";
import type { CanonicalDocument, ContentImportResult } from "./types.ts";

export function notionMcpFetchResultToImport(result: unknown, source: string): ContentImportResult {
  const envelope = asRecord(result);
  const payload = extractPayload(envelope);
  const rawText = extractMarkdown(payload, envelope);
  const adapted = adaptNotionEnhancedMarkdown(rawText);
  const markdown = adapted.markdown;
  const title = extractTitle(payload, rawText);
  const parsed = parseMarkdownToCanonical(markdown, "notion", notionMarkdownAdapter);
  const metadata = asRecord(payload.metadata);
  const sourceUrl = stringValue(payload.url) || (isHttpUrl(source) ? source : undefined);
  const sourceId = parseNotionPageId(sourceUrl || source) || stringValue(payload.id) || source;
  const revision = stringValue(metadata.last_edited_time) || stringValue(payload.last_edited_time);

  const document: CanonicalDocument = {
    ref: { provider: "notion", id: sourceId, kind: "page", url: sourceUrl },
    title,
    revision,
    lastEditedAt: revision,
    content: parsed.content,
    assets: parsed.assets,
    warnings: [...adapted.warnings, ...parsed.warnings]
  };
  return canonicalDocumentToDraftDoc(document);
}

export function adaptNotionEnhancedMarkdown(value: string): {
  markdown: string;
  warnings: CanonicalDocument["warnings"];
} {
  const warnings: CanonicalDocument["warnings"] = [];
  let markdown = unwrapNotionMcpContent(value)
    .replace(/<synced_block_reference\b/gi, "<synced_block")
    .replace(/<\/synced_block_reference>/gi, "</synced_block>")
    .replace(/<mention-date\b([^>]*)\/>/gi, (_match, rawAttributes: string) => {
      const attributes = parseAttributes(rawAttributes);
      const start = attributes.start || "日期";
      const end = attributes.end ? ` – ${attributes.end}` : "";
      const time = attributes.startTime ? ` ${attributes.startTime}` : "";
      return `${start}${time}${end}`;
    })
    .replace(/<unknown\b([^>]*)\/>/gi, (_match, rawAttributes: string) => {
      const attributes = parseAttributes(rawAttributes);
      const label = attributes.alt ? `Notion ${attributes.alt}` : "Notion 暂不支持的内容块";
      warnings.push({
        code: "unsupported_block",
        message: `${label} 已降级为链接。`
      });
      return attributes.url ? `[${label}](${attributes.url})` : label;
    })
    .replace(/<table_of_contents\b[^>]*\/>/gi, () => {
      warnings.push({
        code: "format_downgraded",
        message: "Notion 目录块未导入，Tutti 会根据标题重新生成目录。"
      });
      return "";
    })
    .replace(/<\/?meeting-notes\b[^>]*>/gi, "")
    .replace(/^([ \t]*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|[^\n]+?))\s+\{[^}\n]*(?:color|toggle)=["'][^"']+["'][^}\n]*\}\s*$/gmi, "$1")
    .replace(/^([ \t]*)- \[x\]\s+/gmi, "$1- ☑ ")
    .replace(/^([ \t]*)- \[ \]\s+/gm, "$1- ☐ ");

  let inFence = false;
  markdown = markdown.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const imageCandidate = line.replace(/\\(!|\[|\]|\(|\))/g, "$1");
    const escapedImage = imageCandidate !== line && /^\s*!\[[^\]]*\]\(https?:\/\/\S+\)\s*$/i.test(imageCandidate);
    const escapedBlockStructure = /^([ \t]{0,3})(?:\\(?=#{1,4}\s+)|\\(?=(?:---|\*\*\*|___)\s*$)|\\(?=(?:[-*+]|\d+\.|>)\s+)|&#35;(?=#{0,3}\s+))/i.test(line);
    let repaired = (escapedImage ? imageCandidate : line)
      .replace(/^[\u200B-\u200D\uFEFF]+/, "")
      .replace(/^([ \t]{0,3})\\(?=#{1,4}\s+)/, "$1")
      .replace(/^([ \t]{0,3})\\(?=(?:---|\*\*\*|___)\s*$)/, "$1")
      .replace(/^([ \t]{0,3})\\(?=(?:[-*+]|\d+\.|>)\s+)/, "$1")
      .replace(/^([ \t]{0,3})&#35;(?=#{0,3}\s+)/i, "$1#")
      .replace(/^([ \t]{0,3})&gt;\s+/i, "$1> ");

    if (/^\t+/.test(repaired)) {
      const indentation = repaired.match(/^\t+/)?.[0].length ?? 0;
      repaired = `${"  ".repeat(indentation)}${repaired.slice(indentation)}`;
    }
    const explicitBlock = /^ {0,3}(?:#{1,4}\s+|(?:---|\*\*\*|___)\s*$|>\s+|!\[[^\]]*\]\(https?:\/\/\S+\)\s*$)/i.test(repaired);
    return escapedBlockStructure || escapedImage || explicitBlock ? `\n${repaired}\n` : repaired;
  }).join("\n");

  return { markdown: markdown.trim(), warnings };
}

function extractPayload(envelope: Record<string, unknown>): Record<string, unknown> {
  const structured = asRecord(envelope.structuredContent);
  if (Object.keys(structured).length) return structured;
  for (const text of textBlocks(envelope)) {
    try {
      const parsed = asRecord(JSON.parse(text));
      if (Object.keys(parsed).length) return parsed;
    } catch {
      continue;
    }
  }
  return {};
}

function extractMarkdown(payload: Record<string, unknown>, envelope: Record<string, unknown>): string {
  for (const key of ["text", "markdown", "content", "body"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return textBlocks(envelope).join("\n\n");
}

function extractTitle(payload: Record<string, unknown>, markdown: string): string {
  const direct = stringValue(payload.title) || stringValue(asRecord(payload.metadata).title);
  if (direct) return direct;
  const propertyMatch = markdown.match(/<properties>\s*([\s\S]*?)\s*<\/properties>/i);
  if (propertyMatch) {
    try {
      const properties = asRecord(JSON.parse(propertyMatch[1]));
      const title = stringValue(properties.title) || stringValue(properties.Name);
      if (title) return title;
    } catch {
      // Fall through to the first Markdown heading.
    }
  }
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "Untitled Notion page";
}

function unwrapNotionMcpContent(value: string): string {
  const content = value.match(/<content(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/content>/i)?.[1];
  return (content || value).trim();
}

function textBlocks(envelope: Record<string, unknown>): string[] {
  const content = Array.isArray(envelope.content) ? envelope.content : [];
  return content.flatMap((block) => {
    const item = asRecord(block);
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
