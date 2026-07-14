import type { DraftDocJSON, DraftNodeJSON } from "@tutti/draft-doc";
import type { CanonicalDocument, CanonicalNode, ContentImportResult } from "./types.ts";

const SUPPORTED_NODES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "callout",
  "toggle",
  "toggleSummary",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "columns",
  "column",
  "image",
  "video",
  "audio",
  "horizontalRule",
  "hardBreak",
  "text"
]);

export function canonicalDocumentToDraftDoc(document: CanonicalDocument): ContentImportResult {
  const content = document.content.flatMap((node) => {
    const converted = canonicalNodeToDraftNode(node);
    return converted ? [converted] : [];
  });

  const doc: DraftDocJSON = {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }]
  };

  return {
    source: document.ref,
    sourceRevision: document.revision,
    sourceLastEditedAt: document.lastEditedAt,
    title: document.title,
    doc,
    assets: document.assets,
    warnings: document.warnings
  };
}

export function canonicalNodeToDraftNode(node: CanonicalNode): DraftNodeJSON | null {
  if (!SUPPORTED_NODES.has(node.type)) {
    const text = canonicalNodeText(node).trim();
    return text ? paragraphWithText(text) : null;
  }

  if (node.type === "text") {
    if (!node.text) return null;
    return {
      type: "text",
      text: node.text,
      marks: node.marks?.map((mark) => ({ type: mark.type, attrs: mark.attrs }))
    };
  }

  const attrs = { ...node.attrs };
  if (node.type === "heading") {
    const level = typeof attrs.level === "number" ? attrs.level : 1;
    attrs.level = Math.min(3, Math.max(1, level));
  }

  const sourceContent = node.type === "table"
    ? node.content?.filter((child) => !isCanonicalTableDelimiterRow(child))
    : node.content;
  let content = sourceContent?.flatMap((child) => {
    const converted = canonicalNodeToDraftNode(child);
    return converted ? [converted] : [];
  });
  if (node.type === "listItem" && content?.[0]?.type !== "paragraph") {
    content = [{ type: "paragraph" }, ...(content ?? [])];
  }
  if (node.type === "column" && !content?.length) {
    content = [{ type: "paragraph" }];
  }
  if (node.type === "callout" && !content?.length) {
    content = [{ type: "paragraph" }];
  }
  if (node.type === "toggle" && !content?.length) {
    content = [{ type: "toggleSummary" }, { type: "paragraph" }];
  }

  const result: DraftNodeJSON = { type: node.type };
  if (Object.keys(attrs).length > 0) result.attrs = attrs;
  if (content && content.length > 0) result.content = content;
  return result;
}

function isCanonicalTableDelimiterRow(node: CanonicalNode): boolean {
  if (node.type !== "tableRow" || !node.content?.length) return false;
  const values = node.content.map((cell) => canonicalNodeText(cell).trim());
  const delimiters = values.map((value) => /^:?-{3,}:?$/.test(value));
  return delimiters.some(Boolean) && values.every((value, index) => !value || delimiters[index]);
}

export function canonicalNodeText(node: CanonicalNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "image") return "[image]";
  if (node.type === "video") return "[video]";
  if (node.type === "audio") return "[audio]";
  if (node.type === "horizontalRule") return "";
  return node.content?.map(canonicalNodeText).join("") ?? node.text ?? "";
}

export function textNode(text: string): CanonicalNode {
  return { type: "text", text };
}

export function paragraph(text: string): CanonicalNode {
  return { type: "paragraph", content: text ? [textNode(text)] : [] };
}

function paragraphWithText(text: string): DraftNodeJSON {
  return {
    type: "paragraph",
    content: [{ type: "text", text }]
  };
}
