import { marked } from "marked";
import type {
  CanonicalMark,
  CanonicalNode,
  ConnectorProvider,
  ExternalAsset,
  ImportWarning
} from "./types.ts";

type MarkdownToken = {
  type: string;
  raw?: string;
  text?: string;
  depth?: number;
  lang?: string;
  href?: string;
  title?: string | null;
  ordered?: boolean;
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
  header?: Array<MarkdownToken | { text?: string; tokens?: MarkdownToken[] }>;
  rows?: Array<Array<MarkdownToken | { text?: string; tokens?: MarkdownToken[] }>>;
};

export type MarkdownParseResult = {
  content: CanonicalNode[];
  assets: ExternalAsset[];
  warnings: ImportWarning[];
};

export type MarkdownAdapter = {
  breaks?: boolean;
  repairInlineText?(value: string): string;
  finalizeText?(value: string): string;
};

export function parseMarkdownToCanonical(
  markdown: string,
  provider: ConnectorProvider,
  adapter: MarkdownAdapter = {}
): MarkdownParseResult {
  const assets: ExternalAsset[] = [];
  const warnings: ImportWarning[] = [];
  const tokens = marked.lexer(markdown, {
    gfm: true,
    breaks: adapter.breaks ?? false
  }) as unknown as MarkdownToken[];
  const content = blockTokensToCanonical(tokens, { provider, adapter, assets, warnings });
  return { content, assets, warnings };
}

type ParseContext = {
  provider: ConnectorProvider;
  adapter: MarkdownAdapter;
  assets: ExternalAsset[];
  warnings: ImportWarning[];
};

function blockTokensToCanonical(tokens: MarkdownToken[], context: ParseContext): CanonicalNode[] {
  return tokens.flatMap((token) => {
    switch (token.type) {
      case "space":
        return [];
      case "paragraph":
        if (token.text) {
          const raw = token.text.trim();
          const media = mediaHtmlToCanonical(raw, context);
          if (media) return media;
          if (/^<(callout|details)\b[\s\S]*<\/\1>$/i.test(raw)) {
            return htmlBlockToCanonical(raw, context);
          }
        }
        return inlineNodesToBlocks(inlineTokens(token, context));
      case "text":
        return inlineNodesToBlocks(inlineTokens(token, context));
      case "heading":
        return [
          {
            type: "heading",
            attrs: { level: token.depth ?? 1 },
            content: inlineTokens(token, context)
          }
        ];
      case "blockquote":
        return [
          {
            type: "blockquote",
            content: blockTokensToCanonical(token.tokens ?? [], context)
          }
        ];
      case "code":
        return [
          {
            type: "codeBlock",
            attrs: token.lang ? { language: token.lang } : undefined,
            content: token.text ? [{ type: "text", text: token.text }] : []
          }
        ];
      case "list":
        return [listTokenToCanonical(token, context)];
      case "table":
        return [tableTokenToCanonical(token, context)];
      case "hr":
        return [{ type: "horizontalRule" }];
      case "html": {
        return htmlBlockToCanonical(token.text ?? token.raw ?? "", context);
      }
      default: {
        const inline = inlineTokens(token, context);
        if (inline.length > 0) {
          context.warnings.push({
            code: "unsupported_markdown",
            message: `Markdown 节点 ${token.type} 已降级为段落。`
          });
          return [{ type: "paragraph", content: inline }];
        }
        return [];
      }
    }
  });
}

function listTokenToCanonical(token: MarkdownToken, context: ParseContext): CanonicalNode {
  return {
    type: token.ordered ? "orderedList" : "bulletList",
    content: (token.items ?? []).map((item) => {
      const content = blockTokensToCanonical(item.tokens ?? [], context);
      return {
        type: "listItem",
        content: content.length > 0 ? content : inlineNodesToBlocks(inlineTokens(item, context))
      };
    })
  };
}

function tableTokenToCanonical(token: MarkdownToken, context: ParseContext): CanonicalNode {
  const header = token.header ?? [];
  const rows = (token.rows ?? []).filter((row) => !isMarkdownTableDelimiterRow(
    row.map((cell) => (cell.text ?? "").trim())
  ));
  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: header.map((cell) => ({
          type: "tableHeader",
          content: [{ type: "paragraph", content: inlineTokens(cell, context) }]
        }))
      },
      ...rows.map((row) => ({
        type: "tableRow" as const,
        content: row.map((cell) => ({
          type: "tableCell" as const,
          content: [{ type: "paragraph" as const, content: inlineTokens(cell, context) }]
        }))
      }))
    ]
  };
}

function isMarkdownTableDelimiterRow(values: string[]): boolean {
  const delimiters = values.map((value) => /^:?-{3,}:?$/.test(value));
  return delimiters.some(Boolean) && values.every((value, index) => !value || delimiters[index]);
}

function inlineTokens(
  token: MarkdownToken | { text?: string; tokens?: MarkdownToken[] },
  context: ParseContext
): CanonicalNode[] {
  if (token.tokens && token.tokens.length > 0) {
    return token.tokens.flatMap((child) => inlineTokenToCanonical(child, context));
  }
  return token.text
    ? inlineTokenToCanonical({ type: "text", text: token.text }, context)
    : [];
}

function inlineNodesToBlocks(nodes: CanonicalNode[]): CanonicalNode[] {
  const blocks: CanonicalNode[] = [];
  let inline: CanonicalNode[] = [];
  const flush = () => {
    if (inline.length > 0) blocks.push({ type: "paragraph", content: inline });
    inline = [];
  };

  for (const node of nodes) {
    if (node.type === "image" || node.type === "video" || node.type === "audio") {
      flush();
      blocks.push(node);
    } else {
      inline.push(node);
    }
  }
  flush();
  return blocks.length > 0 ? blocks : [{ type: "paragraph" }];
}

function inlineTokenToCanonical(token: MarkdownToken, context: ParseContext): CanonicalNode[] {
  switch (token.type) {
    case "text":
    case "escape":
      if (token.tokens && token.tokens.length > 0) {
        return token.tokens.flatMap((child) => inlineTokenToCanonical(child, context));
      }
      if (token.text && context.adapter.repairInlineText) {
        const repaired = context.adapter.repairInlineText(token.text);
        if (repaired !== token.text) {
          const repairedTokens = marked.Lexer.lexInline(repaired) as unknown as MarkdownToken[];
          return repairedTokens.flatMap((child) => inlineTokenToCanonical(child, context));
        }
      }
      if (!token.text) return [];
      return [{
        type: "text",
        text: context.adapter.finalizeText?.(token.text) ?? token.text
      }];
    case "strong":
      return withMark(inlineTokens(token, context), { type: "bold" });
    case "em":
      return withMark(inlineTokens(token, context), { type: "italic" });
    case "del":
      return withMark(inlineTokens(token, context), { type: "strike" });
    case "codespan":
      return token.text ? [{ type: "text", text: token.text, marks: [{ type: "code" }] }] : [];
    case "link":
      return withMark(inlineTokens(token, context), {
        type: "link",
        attrs: { href: token.href ?? "" }
      });
    case "image": {
      const sourceUrl = token.href ?? "";
      const id = `${context.provider}:url:${sourceUrl}`;
      context.assets.push({
        id,
        provider: context.provider,
        kind: "image",
        sourceUrl,
        filename: token.title ?? token.text
      });
      return [
        {
          type: "image",
          attrs: {
            src: `tutti-import://${encodeURIComponent(id)}`,
            alt: token.text ?? "",
            title: token.title ?? undefined
          }
        }
      ];
    }
    case "br":
      return [{ type: "hardBreak" }];
    case "html":
      return htmlInlineToCanonical(token.text ?? token.raw ?? "", context);
    default:
      return token.text ? [{ type: "text", text: token.text }] : [];
  }
}

function withMark(nodes: CanonicalNode[], mark: CanonicalMark): CanonicalNode[] {
  return nodes.map((node) => {
    if (node.type !== "text") return node;
    return { ...node, marks: [...(node.marks ?? []), mark] };
  });
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlBlockToCanonical(value: string, context: ParseContext): CanonicalNode[] {
  const raw = value.trim();
  if (/^<empty-block\b[^>]*\/>$/i.test(raw)) return [{ type: "paragraph" }];

  const mediaNodes = mediaHtmlToCanonical(raw, context);
  if (mediaNodes) return mediaNodes;

  if (/^<table\b/i.test(raw)) return [htmlTableToCanonical(raw, context)];

  if (/^<columns\b/i.test(raw)) return [htmlColumnsToCanonical(raw, context)];

  if (/^<callout\b/i.test(raw)) return [htmlCalloutToCanonical(raw, context)];

  if (/^<details\b/i.test(raw)) return [htmlDetailsToCanonical(raw, context)];

  if (/^<(column|synced_block|meeting-notes)\b/i.test(raw)) {
    const inner = raw
      .replace(/^<[^>]+>/, "")
      .replace(/<\/[^>]+>$/, "")
      .replace(/<summary>([\s\S]*?)<\/summary>/gi, "$1\n\n")
      .replace(/<\/?(?:column|columns|callout|details|synced_block|meeting-notes)\b[^>]*>/gi, "\n");
    const nested = marked.lexer(inner.replace(/^\s{1,8}/gm, ""), {
      gfm: true,
      breaks: context.adapter.breaks ?? false
    }) as unknown as MarkdownToken[];
    const content = blockTokensToCanonical(nested, context);
    return content;
  }

  const fallback = stripHtml(raw).trim();
  context.warnings.push({
    code: "unsupported_markdown",
    message: "平台扩展 Markdown/HTML 已降级为普通文本。"
  });
  return fallback ? [{ type: "paragraph", content: [{ type: "text", text: fallback }] }] : [];
}

function htmlCalloutToCanonical(raw: string, context: ParseContext): CanonicalNode {
  const attributes = parseHtmlAttributes(raw.match(/^<callout\b([^>]*)>/i)?.[1] ?? "");
  const inner = raw.replace(/^<callout\b[^>]*>/i, "").replace(/<\/callout>$/i, "");
  const content = parseContainerBlocks(inner, context);
  return {
    type: "callout",
    attrs: { icon: attributes.icon || "i" },
    content: content.length ? content : [{ type: "paragraph" }]
  };
}

function htmlDetailsToCanonical(raw: string, context: ParseContext): CanonicalNode {
  const summary = raw.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "Details";
  const summaryTokens = marked.Lexer.lexInline(stripHtml(summary)) as unknown as MarkdownToken[];
  const body = raw
    .replace(/^<details\b[^>]*>/i, "")
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, "")
    .replace(/<\/details>$/i, "");
  const content = parseContainerBlocks(body, context);
  return {
    type: "toggle",
    attrs: { open: /<details\b[^>]*\bopen(?:\s|=|>)/i.test(raw) },
    content: [
      {
        type: "toggleSummary",
        content: summaryTokens.flatMap((token) => inlineTokenToCanonical(token, context))
      },
      ...(content.length ? content : [{ type: "paragraph" as const }])
    ]
  };
}

function parseContainerBlocks(value: string, context: ParseContext): CanonicalNode[] {
  const tokens = marked.lexer(dedentContainer(value), {
    gfm: true,
    breaks: context.adapter.breaks ?? false
  }) as unknown as MarkdownToken[];
  return blockTokensToCanonical(tokens, context);
}

function htmlColumnsToCanonical(raw: string, context: ParseContext): CanonicalNode {
  const columns = [...raw.matchAll(/<column\b[^>]*>([\s\S]*?)<\/column>/gi)].map((match) => {
    const inner = dedentContainer(match[1]).replace(
      /(<empty-block\b[^>]*\/>)[ \t]*\n/gi,
      "$1\n\n"
    );
    const tokens = marked.lexer(inner, {
      gfm: true,
      breaks: context.adapter.breaks ?? false
    }) as unknown as MarkdownToken[];
    const content = blockTokensToCanonical(tokens, context);
    return {
      type: "column" as const,
      content: content.length ? content : [{ type: "paragraph" as const }]
    };
  });
  return {
    type: "columns",
    attrs: { count: Math.max(1, columns.length) },
    content: columns.length ? columns : [{ type: "column", content: [{ type: "paragraph" }] }]
  };
}

function dedentContainer(value: string): string {
  const lines = value.replace(/^\n+|\n+$/g, "").split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const indentation = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(indentation, line.length))).join("\n");
}

function mediaHtmlToCanonical(
  raw: string,
  context: ParseContext
): CanonicalNode[] | undefined {
  const media = raw.match(/^<(audio|video|file|pdf)\b([^>]*)>([\s\S]*?)<\/\1>$/i);
  if (media) {
    const tag = media[1].toLowerCase();
    const attributes = parseHtmlAttributes(media[2]);
    const sourceUrl = attributes.src ?? "";
    const caption = stripHtml(media[3]).trim() || tag;
    const kind = tag === "video" ? "video" : tag === "audio" ? "audio" : "file";
    const id = `${context.provider}:url:${sourceUrl}`;
    context.assets.push({
      id,
      provider: context.provider,
      kind,
      sourceUrl,
      filename: caption
    });
    if (tag === "video" || tag === "audio") {
      return [
        {
          type: tag,
          attrs: { src: `tutti-import://${encodeURIComponent(id)}`, title: caption }
        }
      ];
    }
    return [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `[${tag.toUpperCase()}: ${caption}]`,
            marks: [{ type: "link", attrs: { href: `tutti-import://${encodeURIComponent(id)}` } }]
          }
        ]
      }
    ];
  }
  return undefined;
}

function htmlTableToCanonical(raw: string, context: ParseContext): CanonicalNode {
  const headerRow = /<table\b[^>]*header-row=["']true["']/i.test(raw);
  const rowMatches = [...raw.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].filter((row) => {
    const cells = [...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
    return !cells.length || !isMarkdownTableDelimiterRow(
      cells.map((cell) => stripHtml(cell[2]).trim())
    );
  });
  return {
    type: "table",
    content: rowMatches.map((row, rowIndex) => {
      const cells = [...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
      return {
        type: "tableRow",
        content: cells.map((cell) => {
          const text = stripHtml(cell[2]).trim();
          const tokens = marked.lexer(text, {
            gfm: true,
            breaks: context.adapter.breaks ?? false
          }) as unknown as MarkdownToken[];
          const blocks = blockTokensToCanonical(tokens, context);
          return {
            type: cell[1].toLowerCase() === "th" || (headerRow && rowIndex === 0)
              ? "tableHeader"
              : "tableCell",
            content: blocks.length > 0 ? blocks : [{ type: "paragraph" }]
          };
        })
      };
    })
  };
}

function htmlInlineToCanonical(value: string, context: ParseContext): CanonicalNode[] {
  const raw = value.trim();
  if (/^<br\s*\/?\s*>$/i.test(raw)) return [{ type: "hardBreak" }];
  const media = mediaHtmlToCanonical(raw, context);
  if (media) return media;
  const reference = raw.match(
    /^<(?:page|database|mention-user|mention-page|mention-database|mention-data-source|mention-agent)\b([^>]*)>([\s\S]*?)<\/[^>]+>$/i
  );
  if (reference) {
    const attributes = parseHtmlAttributes(reference[1]);
    const text = stripHtml(reference[2]).trim() || "Reference";
    return [
      {
        type: "text",
        text,
        marks: attributes.url ? [{ type: "link", attrs: { href: attributes.url } }] : undefined
      }
    ];
  }
  const text = stripHtml(raw);
  return text ? [{ type: "text", text }] : [];
}

function parseHtmlAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)) {
    attributes[match[1]] = match[2]
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return attributes;
}
