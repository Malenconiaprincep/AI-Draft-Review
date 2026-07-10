export type DraftKind = "url" | "doc";

export type DraftDocJSON = {
  type: "doc";
  content?: DraftNodeJSON[];
};

export type DraftNodeJSON = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DraftNodeJSON[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
};

export type SerializedBlock = {
  blockId?: string;
  type: string;
  text: string;
  from: number;
  to: number;
  path: number[];
};

export type ReviewCategory =
  | "brand_cta"
  | "link_issue"
  | "campaign_brief"
  | "factual_error"
  | "format_issue"
  | "content_quality"
  | "similarity_risk"
  | "image_asset"
  | "publish_flow"
  | "general_comment";

export type ReviewCheck = ReviewCategory;

export type DraftReviewInput = {
  draft: {
    postStateId: string;
    draftKind: DraftKind;
    draftUrl?: string;
    docJson?: DraftDocJSON;
    docVersion: number;
  };
  campaignBrief: {
    campaignId: string;
    name?: string;
    description?: string;
    slogan?: string;
    hashtags?: string[];
    officialPost?: string[];
    contentUrl?: string;
    ideaStarters?: string[];
  };
  campaignContext?: CampaignContextDocument[];
  reviewHistory: ReviewHistoryEvent[];
  openComments: DraftCommentThread[];
  options?: {
    language?: "zh" | "en";
    maxInlineSuggestions?: number;
    enabledChecks?: ReviewCheck[];
  };
};

export type CampaignContextDocument = {
  id?: string;
  title?: string;
  sourceType?: "brief" | "proposal" | "brand_kit" | "requirements" | "reference" | "other";
  text: string;
  url?: string;
};

export type ReviewHistoryEvent = {
  id: string;
  prevStatus?: string;
  newStatus: string;
  note?: string;
  authorKind: "brand" | "creator" | "system";
  authorHandle?: string;
  createdAt: string;
};

export type DraftCommentThread = {
  id: string;
  anchorFrom?: number | null;
  anchorTo?: number | null;
  quotedText?: string | null;
  status: "open" | "resolved";
  action?: "comment" | "replace";
  suggestedText?: string;
  resolvedText?: string;
  messages: DraftCommentMessage[];
};

export type DraftCommentMessage = {
  id: string;
  body: string;
  authorKind: "brand" | "creator";
  authorHandle?: string;
  createdAt: string;
};

export type ReviewProposal = {
  reviewId: string;
  analyzedDocVersion: number;
  verdict: "approve" | "request_changes" | "reject";
  summary: string;
  inlineSuggestions: InlineSuggestionProposal[];
  risks?: ReviewRisk[];
};

export type InlineSuggestionAction = "comment" | "replace" | "insert_after" | "delete";

export type InlineSuggestionProposal = {
  id: string;
  quotedText: string;
  body: string;
  severity: "blocker" | "suggestion";
  category: ReviewCategory;
  action?: InlineSuggestionAction;
  suggestedText?: string;
  resolvedAnchor?: {
    from: number;
    to: number;
  };
  evidence?: ReviewEvidence[];
};

export type ReviewEvidence = {
  source: "campaign_brief" | "campaign_context" | "review_history" | "open_comment" | "system_rule";
  text: string;
};

export type ReviewRisk = {
  category: ReviewCategory;
  severity: "blocker" | "suggestion";
  body: string;
};

export type ReviewNoteDraft = {
  summary: string;
  verdict: ReviewProposal["verdict"];
  analyzedDocVersion: number;
};
