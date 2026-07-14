import type { MarkdownAdapter } from "./markdown.ts";

const INLINE_BOUNDARY = "\u00A0\uE000";
const ADJACENT_BOLD = /(\*\*(?=\S)[^\n]*?\S\*\*)(?=\S)/g;

export const googleDocsMarkdownAdapter = {
  repairInlineText(value) {
    return value.replace(ADJACENT_BOLD, `$1${INLINE_BOUNDARY}`);
  },
  finalizeText(value) {
    return value.replaceAll(INLINE_BOUNDARY, "");
  }
} satisfies MarkdownAdapter;
