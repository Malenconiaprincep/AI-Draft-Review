import { Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
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

export const Audio = Node.create({
  name: "audio",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null }
    };
  },

  parseHTML() {
    return [{ tag: "audio[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "audio",
      mergeAttributes(HTMLAttributes, {
        controls: "",
        preload: "metadata"
      })
    ];
  }
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,

  addAttributes() {
    return { count: { default: 2 } };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "columns" }), 0];
  }
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column" }), 0];
  }
});

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return { icon: { default: "i" } };
  },

  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  }
});

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary block+",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        rendered: false,
        parseHTML: (element) => element.hasAttribute("open")
      }
    };
  },

  parseHTML() {
    return [{ tag: 'details[data-type="toggle"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, {
        "data-type": "toggle",
        ...(node.attrs.open ? { open: "" } : {})
      }),
      0
    ];
  }
});

export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: 'summary[data-type="toggle-summary"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes, { "data-type": "toggle-summary" }), 0];
  }
});

export function createDraftDocExtensions() {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3]
      }
    }),
    TextAlign.configure({
      types: ["heading", "paragraph"]
    }),
    Image.configure({
      inline: false,
      allowBase64: false
    }),
    Video,
    Audio,
    Columns,
    Column,
    Callout,
    Toggle,
    ToggleSummary,
    Table.configure({
      resizable: false
    }),
    TableRow,
    TableHeader,
    TableCell
  ];
}
