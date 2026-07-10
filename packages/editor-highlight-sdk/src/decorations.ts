import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import { locateQuotedText } from "./anchors";
import type { EditorHighlight } from "./types";

export function buildHighlightDecorations(params: {
  doc: ProseMirrorNode;
  highlights: EditorHighlight[];
  editable: boolean;
  selectedId?: string | null;
  onSelectHighlight?: (highlightId: string) => void;
}): DecorationSet {
  const decorations: Decoration[] = [];

  params.highlights.forEach((highlight) => {
    const located = locateHighlight(params.doc, highlight);
    if (!located) return;

    const classes = [
      "tutti-review-highlight",
      `tutti-review-highlight--${highlight.source}`,
      `tutti-review-highlight--${located.status}`,
      highlight.severity ? `tutti-review-highlight--${highlight.severity}` : "",
      params.selectedId === highlight.id ? "tutti-review-highlight--selected" : ""
    ]
      .filter(Boolean)
      .join(" ");

    decorations.push(
      Decoration.inline(located.from, located.to, {
        class: classes,
        "data-highlight-id": highlight.id,
        "data-highlight-source": highlight.source
      })
    );

    if (highlight.showBadge !== false) {
      decorations.push(
        Decoration.widget(
          located.from,
          () => createBadge(highlight, params.onSelectHighlight),
          {
            key: `badge-${highlight.id}`,
            side: -1
          }
        )
      );
    }
  });

  return DecorationSet.create(params.doc, decorations);
}

function locateHighlight(
  doc: ProseMirrorNode,
  highlight: EditorHighlight
): { from: number; to: number; status: string } | null {
  const anchorLocated = locateByAnchor(highlight);
  if (highlight.preferAnchor && anchorLocated) return anchorLocated;

  if (highlight.quotedText) {
    const located = locateQuotedText({
      doc,
      quotedText: highlight.quotedText,
      preferredFrom: highlight.anchorFrom,
      preferredTo: highlight.anchorTo
    });

    if (located.status === "located" || located.status === "recovered") {
      return { from: located.from, to: located.to, status: located.status };
    }
    if (located.status === "ambiguous") {
      const first = located.matches[0];
      return first ? { ...first, status: "ambiguous" } : null;
    }
    return anchorLocated;
  }

  return anchorLocated;
}

function locateByAnchor(highlight: EditorHighlight): { from: number; to: number; status: string } | null {
  if (
    highlight.anchorFrom != null &&
    highlight.anchorTo != null &&
    highlight.anchorTo > highlight.anchorFrom
  ) {
    return {
      from: highlight.anchorFrom,
      to: highlight.anchorTo,
      status: highlight.status
    };
  }

  return null;
}

function createBadge(
  highlight: EditorHighlight,
  onSelectHighlight?: (highlightId: string) => void
): HTMLElement {
  const anchor = document.createElement("span");
  anchor.className = "tutti-review-badge-anchor";
  anchor.dataset.highlightId = highlight.id;
  anchor.contentEditable = "false";

  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = [
    "tutti-review-badge",
    `tutti-review-badge--${highlight.source}`,
    highlight.severity ? `tutti-review-badge--${highlight.severity}` : ""
  ]
    .filter(Boolean)
    .join(" ");
  const label = highlight.label ?? (highlight.source === "ai" ? "AI" : "B");
  badge.textContent = label;
  badge.setAttribute("aria-label", `查看批注 ${label}`);
  badge.dataset.highlightId = highlight.id;
  badge.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  badge.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectHighlight?.(highlight.id);
  });

  anchor.appendChild(badge);
  return anchor;
}
