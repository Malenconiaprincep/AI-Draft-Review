export type HighlightSource = "ai" | "brand" | "brand-selection";

export type HighlightStatus = "open" | "resolved" | "stale" | "orphaned" | "recovered" | "ambiguous" | "focused";

export type EditorHighlight = {
  id: string;
  source: HighlightSource;
  status: HighlightStatus;
  severity?: "blocker" | "suggestion";
  anchorFrom?: number | null;
  anchorTo?: number | null;
  quotedText?: string | null;
  blockId?: string;
  label?: string;
  showBadge?: boolean;
  preferAnchor?: boolean;
};

export type LocatedAnchor =
  | {
      status: "located" | "recovered";
      from: number;
      to: number;
    }
  | {
      status: "ambiguous";
      matches: Array<{ from: number; to: number }>;
    }
  | {
      status: "orphaned";
    };
