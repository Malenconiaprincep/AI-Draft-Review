import assert from "node:assert/strict";
import test from "node:test";
import { applyBrandReplacement, getBrandCommentHighlights, type DraftEditorLike } from "./review-demo-logic.ts";
import type { DraftCommentThread, DraftDocJSON } from "../../../packages/draft-doc/src/types.ts";

function comment(overrides: Partial<DraftCommentThread> = {}): DraftCommentThread {
  return {
    id: "feedback_1",
    anchorFrom: 1,
    anchorTo: 6,
    quotedText: "old text",
    status: "open",
    action: "replace",
    suggestedText: "new text",
    messages: [
      {
        id: "message_1",
        body: "replace it",
        authorKind: "brand",
        createdAt: "2026-07-10T00:00:00.000Z"
      }
    ],
    ...overrides
  };
}

function draft(text: string): DraftDocJSON {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }]
      }
    ]
  };
}

test("brand highlights only include open feedback and keep right-panel numbering", () => {
  const highlights = getBrandCommentHighlights(
    [
      comment({ id: "resolved", status: "resolved" }),
      comment({ id: "open", status: "open", anchorFrom: 4, anchorTo: 9 })
    ],
    true
  );

  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].id, "open");
  assert.equal(highlights[0].label, "B2");
  assert.equal(highlights[0].preferAnchor, true);
  assert.equal(highlights[0].status, "open");
});

test("brand replacement uses editor anchor even when quoted text no longer matches", () => {
  const nextDoc = draft("prefix replacement suffix");
  const calls: Array<{ text: string; from: number; to: number }> = [];
  const dispatched: unknown[] = [];
  const editor: DraftEditorLike = {
    state: {
      doc: { content: { size: 100 } },
      tr: {
        insertText: (text, from, to) => {
          calls.push({ text, from, to });
          return { text, from, to };
        }
      }
    },
    view: {
      dispatch: (transaction) => {
        dispatched.push(transaction);
      }
    },
    getJSON: () => nextDoc
  };

  const result = applyBrandReplacement({
    comment: comment({
      anchorFrom: 8,
      anchorTo: 18,
      quotedText: "this quote does not exist",
      suggestedText: "replacement"
    }),
    docJson: draft("prefix original suffix"),
    editor
  });

  assert.equal(result.applied, true);
  assert.equal(result.appliedViaEditor, true);
  assert.equal(result.doc, nextDoc);
  assert.deepEqual(calls, [{ text: "replacement", from: 8, to: 18 }]);
  assert.equal(dispatched.length, 1);
});

test("brand replacement falls back to quoted text when anchor is unavailable", () => {
  const result = applyBrandReplacement({
    comment: comment({
      anchorFrom: null,
      anchorTo: null,
      quotedText: "old text",
      suggestedText: "new text"
    }),
    docJson: draft("before old text after")
  });

  assert.equal(result.applied, true);
  assert.equal(result.appliedViaEditor, false);
  assert.deepEqual(result.doc, draft("before new text after"));
});
