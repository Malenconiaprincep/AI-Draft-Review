import { Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

export const DRAFT_DOC_TIPTAP_VERSION = "3.27.1";

export const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      poster: { default: null },
      title: { default: null }
    };
  },

  parseHTML() {
    return [{ tag: "video[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(HTMLAttributes, {
        controls: "",
        playsinline: "",
        preload: "metadata"
      })
    ];
  }
});

export function createDraftDocExtensions() {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3]
      }
    }),
    Image.configure({
      inline: false,
      allowBase64: false
    }),
    Video,
    Table.configure({
      resizable: false
    }),
    TableRow,
    TableHeader,
    TableCell
  ];
}
