import { applyInlineSuggestionToDraftDoc } from "../../../packages/draft-doc/src/serializers.ts";
import type { DraftCommentThread, DraftDocJSON } from "../../../packages/draft-doc/src/types.ts";
import type { EditorHighlight } from "../../../packages/editor-highlight-sdk/src/types.ts";

export type DraftEditorLike<Transaction = unknown> = {
  state: {
    doc: {
      content: {
        size: number;
      };
    };
    tr: {
      insertText: (text: string, from: number, to: number) => Transaction;
    };
  };
  view: {
    dispatch: (transaction: Transaction) => void;
  };
  getJSON: () => DraftDocJSON;
};

export function getBrandCommentHighlights(
  comments: DraftCommentThread[],
  canEditDraft: boolean
): EditorHighlight[] {
  return comments.flatMap((comment, index): EditorHighlight[] =>
    comment.status === "open"
      ? [
          {
            id: comment.id,
            source: "brand",
            status: "open",
            anchorFrom: comment.anchorFrom,
            anchorTo: comment.anchorTo,
            quotedText: comment.quotedText,
            label: `B${index + 1}`,
            preferAnchor: canEditDraft
          }
        ]
      : []
  );
}

export function applyBrandReplacement<Transaction>(params: {
  comment: DraftCommentThread;
  docJson: DraftDocJSON | undefined;
  editor?: DraftEditorLike<Transaction> | null;
}): {
  doc: DraftDocJSON | undefined;
  applied: boolean;
  appliedViaEditor: boolean;
} {
  const { comment, editor } = params;
  let nextDoc = params.docJson;
  if (comment.action !== "replace" || !comment.suggestedText?.trim() || !nextDoc) {
    return { doc: nextDoc, applied: false, appliedViaEditor: false };
  }

  const from = comment.anchorFrom;
  const to = comment.anchorTo;
  const hasUsableAnchor =
    editor &&
    from != null &&
    to != null &&
    to > from &&
    to <= editor.state.doc.content.size;

  if (hasUsableAnchor) {
    const transaction = editor.state.tr.insertText(comment.suggestedText, from, to);
    editor.view.dispatch(transaction);
    return {
      doc: editor.getJSON(),
      applied: true,
      appliedViaEditor: true
    };
  }

  const result = applyInlineSuggestionToDraftDoc(nextDoc, {
    id: comment.id,
    quotedText: comment.quotedText ?? "",
    body: comment.messages[comment.messages.length - 1]?.body ?? "",
    severity: "blocker",
    category: "general_comment",
    action: "replace",
    suggestedText: comment.suggestedText
  });

  return {
    doc: result.applied ? result.doc : nextDoc,
    applied: result.applied,
    appliedViaEditor: false
  };
}
