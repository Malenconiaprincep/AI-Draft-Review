import type { DraftDocJSON, DraftNodeJSON, InlineSuggestionProposal, SerializedBlock } from "./types";

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader"
]);

const ATOM_BLOCK_LABELS: Record<string, string> = {
  image: "[image]",
  video: "[video]",
  horizontalRule: "[divider]"
};

export function emptyDraftDoc(): DraftDocJSON {
  return {
    type: "doc",
    content: [{ type: "paragraph" }]
  };
}

export function isDraftDocEmpty(doc: DraftDocJSON | undefined): boolean {
  return docPlainText(doc).trim().length === 0;
}

export function docPlainText(doc: DraftDocJSON | undefined): string {
  if (!doc) return "";
  return textFromNode(doc).replace(/\n{3,}/g, "\n\n").trim();
}

export function docJsonToPlainText(doc: DraftDocJSON | undefined): string {
  return docPlainText(doc);
}

export function docJsonToBlocks(doc: DraftDocJSON | undefined): SerializedBlock[] {
  if (!doc) return [];

  const blocks: SerializedBlock[] = [];
  let cursor = 0;

  const visit = (node: DraftNodeJSON, path: number[]) => {
    const text = textFromNode(node).trim();
    const atomText = ATOM_BLOCK_LABELS[node.type];
    const blockText = text || atomText || "";
    const isBlock = BLOCK_TYPES.has(node.type) || Boolean(atomText);

    if (isBlock && blockText) {
      const from = cursor;
      const to = cursor + blockText.length;
      blocks.push({
        blockId: readBlockId(node),
        type: node.type,
        text: blockText,
        from,
        to,
        path
      });
      cursor = to + 1;
      return;
    }

    node.content?.forEach((child, index) => visit(child, [...path, index]));
  };

  doc.content?.forEach((child, index) => visit(child, [index]));
  return blocks;
}

export function quotedTextFromDocRange(
  doc: DraftDocJSON | undefined,
  from: number,
  to: number
): string {
  // These offsets belong to docJsonToPlainText output. For ProseMirror
  // absolute positions use quotedTextFromRange from editor-highlight-sdk.
  if (from < 0 || to < from) return "";
  return docPlainText(doc).slice(from, to);
}

export type ApplyInlineSuggestionResult = {
  doc: DraftDocJSON;
  applied: boolean;
  reason?: string;
};

export function applyInlineSuggestionToDraftDoc(
  doc: DraftDocJSON,
  suggestion: InlineSuggestionProposal
): ApplyInlineSuggestionResult {
  const action = suggestion.action ?? "comment";
  if (action === "comment") {
    return { doc, applied: false, reason: "comment_only" };
  }

  if (!suggestion.quotedText.trim()) {
    return { doc, applied: false, reason: "missing_quote" };
  }

  if ((action === "replace" || action === "insert_after") && !suggestion.suggestedText?.trim()) {
    return { doc, applied: false, reason: "missing_suggested_text" };
  }

  let replaced = false;
  const nextDoc = transformFirstTextMatch(doc, suggestion.quotedText, (match) => {
    replaced = true;
    if (action === "delete") return "";
    if (action === "insert_after") return `${match}${suggestion.suggestedText}`;
    return suggestion.suggestedText ?? match;
  });

  if (!replaced) {
    return { doc, applied: false, reason: "quote_not_found" };
  }

  if (docPlainText(doc).trim() && !docPlainText(nextDoc).trim()) {
    return { doc, applied: false, reason: "would_empty_doc" };
  }

  return { doc: nextDoc, applied: true };
}

function textFromNode(node: DraftNodeJSON | DraftDocJSON): string {
  if ("text" in node && typeof node.text === "string") return node.text;

  const atomText = ATOM_BLOCK_LABELS[node.type];
  if (atomText) return `${atomText}\n`;

  const childText = node.content?.map(textFromNode).join("") ?? "";
  if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") {
    return `${childText}\n`;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    return `${childText}\n`;
  }
  if (node.type === "tableCell" || node.type === "tableHeader") {
    return `${childText}\t`;
  }
  if (node.type === "tableRow") {
    return `${childText.trimEnd()}\n`;
  }
  if (node.type === "table") {
    return `${childText}\n`;
  }
  return childText;
}

function readBlockId(node: DraftNodeJSON): string | undefined {
  const id = node.attrs?.blockId ?? node.attrs?.id;
  return typeof id === "string" ? id : undefined;
}

function transformFirstTextMatch(
  doc: DraftDocJSON,
  quotedText: string,
  transform: (match: string) => string
): DraftDocJSON {
  let done = false;
  const visit = (node: DraftNodeJSON): DraftNodeJSON | null => {
    if (done) return node;

    if (typeof node.text === "string") {
      const index = node.text.indexOf(quotedText);
      if (index === -1) return node;

      done = true;
      const before = node.text.slice(0, index);
      const match = node.text.slice(index, index + quotedText.length);
      const after = node.text.slice(index + quotedText.length);
      const text = `${before}${transform(match)}${after}`;
      if (!text) return null;

      return {
        ...node,
        text
      };
    }

    if (!node.content) return node;

    let changed = false;
    const content = node.content.flatMap((child) => {
      const nextChild = visit(child);
      if (nextChild !== child) changed = true;
      return nextChild ? [nextChild] : [];
    });

    if (!changed) return node;

    const nextNode: DraftNodeJSON = { ...node };
    if (content.length > 0) {
      nextNode.content = content;
    } else {
      delete nextNode.content;
    }
    return nextNode;
  };

  return {
    ...doc,
    content: doc.content?.flatMap((node) => {
      const nextNode = visit(node);
      return nextNode ? [nextNode] : [];
    })
  };
}
