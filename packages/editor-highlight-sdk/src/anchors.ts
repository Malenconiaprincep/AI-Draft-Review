import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Mapping } from "prosemirror-transform";
import type { LocatedAnchor } from "./types";

export function remapAnchor(
  mapping: Mapping,
  anchor: { from: number | null; to: number | null }
): { from: number | null; to: number | null } {
  if (anchor.from == null || anchor.to == null) {
    return { from: null, to: null };
  }

  const from = mapping.map(anchor.from, 1);
  const to = mapping.map(anchor.to, -1);
  if (to <= from) {
    return { from: null, to: null };
  }
  return { from, to };
}

export function quotedTextFromRange(params: {
  doc: ProseMirrorNode;
  from: number;
  to: number;
}): string {
  if (params.to <= params.from) return "";
  return params.doc.textBetween(params.from, params.to, "\n", "\n");
}

export function locateQuotedText(params: {
  doc: ProseMirrorNode;
  quotedText: string;
  preferredFrom?: number | null;
  preferredTo?: number | null;
}): LocatedAnchor {
  const normalizedQuote = normalizeText(params.quotedText);
  if (!normalizedQuote) return { status: "orphaned" };

  if (
    params.preferredFrom != null &&
    params.preferredTo != null &&
    params.preferredTo > params.preferredFrom
  ) {
    const currentText = normalizeText(
      quotedTextFromRange({
        doc: params.doc,
        from: params.preferredFrom,
        to: params.preferredTo
      })
    );
    if (currentText === normalizedQuote) {
      return {
        status: "located",
        from: params.preferredFrom,
        to: params.preferredTo
      };
    }
  }

  const textIndex = buildTextIndex(params.doc);
  const matches = findAllMatches(textIndex.text, normalizedQuote).map((start) => {
    const end = start + normalizedQuote.length;
    return {
      from: textOffsetToDocPos(textIndex.segments, start),
      to: textOffsetToDocPos(textIndex.segments, end)
    };
  });

  if (matches.length === 0) return { status: "orphaned" };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "recovered", from: matches[0].from, to: matches[0].to };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function findAllMatches(text: string, quote: string): number[] {
  const matches: number[] = [];
  let index = text.indexOf(quote);
  while (index !== -1) {
    matches.push(index);
    index = text.indexOf(quote, index + Math.max(quote.length, 1));
  }
  return matches;
}

type TextSegment = {
  textFrom: number;
  textTo: number;
  docFrom: number;
};

function buildTextIndex(doc: ProseMirrorNode): { text: string; segments: TextSegment[] } {
  let text = "";
  const segments: TextSegment[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const normalized = normalizeText(node.text);
    if (!normalized) return;

    const prefix = text.length > 0 ? " " : "";
    text += prefix;
    const textFrom = text.length;
    text += normalized;
    segments.push({
      textFrom,
      textTo: text.length,
      docFrom: pos
    });
  });

  return { text, segments };
}

function textOffsetToDocPos(segments: TextSegment[], offset: number): number {
  const segment =
    segments.find((candidate) => offset >= candidate.textFrom && offset <= candidate.textTo) ??
    segments[segments.length - 1];
  if (!segment) return 0;
  return segment.docFrom + Math.max(0, Math.min(offset - segment.textFrom, segment.textTo - segment.textFrom));
}
