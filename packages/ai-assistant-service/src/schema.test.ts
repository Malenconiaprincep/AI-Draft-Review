import assert from "node:assert/strict";
import test from "node:test";
import { draftReviewInputSchema } from "./schema.ts";

const baseInput = {
  draft: {
    postStateId: "post-state-1",
    draftKind: "doc" as const,
    docVersion: 1,
    docJson: {
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }]
    }
  },
  campaignBrief: { campaignId: "campaign-1" },
  reviewHistory: [],
  openComments: []
};

test("accepts a structurally valid DraftDocJSON input", () => {
  assert.equal(draftReviewInputSchema.parse(baseInput).draft.docJson?.type, "doc");
});

test("accepts shared column layout nodes", () => {
  const result = draftReviewInputSchema.safeParse({
    ...baseInput,
    draft: {
      ...baseInput.draft,
      docJson: {
        type: "doc",
        content: [{
          type: "columns",
          attrs: { count: 2 },
          content: [
            { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "Left" }] }] },
            { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "Right" }] }] }
          ]
        }]
      }
    }
  });
  assert.equal(result.success, true);
});

test("accepts shared callout and toggle nodes", () => {
  const result = draftReviewInputSchema.safeParse({
    ...baseInput,
    draft: {
      ...baseInput.draft,
      docJson: {
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { icon: "i" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Important" }] }]
          },
          {
            type: "toggle",
            attrs: { open: false },
            content: [
              { type: "toggleSummary", content: [{ type: "text", text: "Details" }] },
              { type: "paragraph", content: [{ type: "text", text: "Hidden" }] }
            ]
          }
        ]
      }
    }
  });
  assert.equal(result.success, true);
});

test("rejects a doc draft whose root is not a doc node", () => {
  const result = draftReviewInputSchema.safeParse({
    ...baseInput,
    draft: {
      ...baseInput.draft,
      docJson: { type: "paragraph", content: [] }
    }
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.message, /doc/);
  }
});

test("rejects nodes outside the shared Tiptap schema", () => {
  const result = draftReviewInputSchema.safeParse({
    ...baseInput,
    draft: {
      ...baseInput.draft,
      docJson: { type: "doc", content: [{ type: "unsupportedWidget" }] }
    }
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.message, /unsupportedWidget/);
  }
});

test("requires docJson for doc drafts and draftUrl for url drafts", () => {
  const missingDoc = draftReviewInputSchema.safeParse({
    ...baseInput,
    draft: { postStateId: "post-state-1", draftKind: "doc", docVersion: 1 }
  });
  const missingUrl = draftReviewInputSchema.safeParse({
    ...baseInput,
    draft: { postStateId: "post-state-1", draftKind: "url", docVersion: 1 }
  });

  assert.equal(missingDoc.success, false);
  assert.equal(missingUrl.success, false);
});
