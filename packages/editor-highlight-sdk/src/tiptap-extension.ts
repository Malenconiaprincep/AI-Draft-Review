import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { buildHighlightDecorations } from "./decorations";
import type { EditorHighlight } from "./types";

export type CommentHighlightOptions = {
  getHighlights: () => EditorHighlight[];
  onSelectHighlight?: (highlightId: string) => void;
  editable?: boolean;
  selectedId?: string | null;
};

export const commentHighlightPluginKey = new PluginKey("tuttiCommentHighlight");

export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: "commentHighlight",

  addOptions() {
    return {
      getHighlights: () => [],
      editable: false,
      selectedId: null
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentHighlightPluginKey,
        props: {
          handleDOMEvents: {
            click: (_view, event) => {
              const highlightId = getHighlightIdFromTarget(event.target);
              if (!highlightId) return false;

              event.preventDefault();
              event.stopPropagation();
              this.options.onSelectHighlight?.(highlightId);
              return true;
            }
          },
          decorations: (state) =>
            buildHighlightDecorations({
              doc: state.doc,
              highlights: this.options.getHighlights(),
              editable: Boolean(this.options.editable),
              selectedId: this.options.selectedId,
              onSelectHighlight: this.options.onSelectHighlight
            })
        }
      })
    ];
  }
});

export function createCommentHighlightExtension(options: CommentHighlightOptions) {
  return CommentHighlight.configure(options);
}

function getHighlightIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-highlight-id]")?.dataset.highlightId ?? null;
}
