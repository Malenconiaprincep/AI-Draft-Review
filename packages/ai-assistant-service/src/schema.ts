import { z } from "zod";

export const reviewCategorySchema = z.enum([
  "brand_cta",
  "link_issue",
  "campaign_brief",
  "factual_error",
  "format_issue",
  "content_quality",
  "similarity_risk",
  "image_asset",
  "publish_flow",
  "general_comment"
]);

export const draftReviewInputSchema = z.object({
  draft: z.object({
    postStateId: z.string().min(1),
    draftKind: z.enum(["url", "doc"]),
    draftUrl: z.string().optional(),
    docJson: z.any().optional(),
    docVersion: z.number().int().nonnegative()
  }),
  campaignBrief: z.object({
    campaignId: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    slogan: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    officialPost: z.array(z.string()).optional(),
    contentUrl: z.string().optional(),
    ideaStarters: z.array(z.string()).optional()
  }),
  campaignContext: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        sourceType: z.enum(["brief", "proposal", "brand_kit", "requirements", "reference", "other"]).optional(),
        text: z.string().min(1),
        url: z.string().optional()
      })
    )
    .optional(),
  reviewHistory: z.array(
    z.object({
      id: z.string(),
      prevStatus: z.string().optional(),
      newStatus: z.string(),
      note: z.string().optional(),
      authorKind: z.enum(["brand", "creator", "system"]),
      authorHandle: z.string().optional(),
      createdAt: z.string()
    })
  ),
  openComments: z.array(
    z.object({
      id: z.string(),
      anchorFrom: z.number().nullable().optional(),
      anchorTo: z.number().nullable().optional(),
      quotedText: z.string().nullable().optional(),
      status: z.enum(["open", "resolved"]),
      action: z.enum(["comment", "replace"]).optional(),
      suggestedText: z.string().optional(),
      messages: z.array(
        z.object({
          id: z.string(),
          body: z.string(),
          authorKind: z.enum(["brand", "creator"]),
          authorHandle: z.string().optional(),
          createdAt: z.string()
        })
      )
    })
  ),
  options: z
    .object({
      language: z.enum(["zh", "en"]).optional(),
      maxInlineSuggestions: z.number().int().positive().optional(),
      enabledChecks: z.array(reviewCategorySchema).optional()
    })
    .optional()
});

export const inlineSuggestionProposalSchema = z.object({
  id: z.string().min(1),
  quotedText: z.string().min(1),
  body: z.string().min(1),
  severity: z.enum(["blocker", "suggestion"]),
  category: reviewCategorySchema,
  action: z.enum(["comment", "replace", "insert_after", "delete"]).optional(),
  suggestedText: z.string().optional(),
  resolvedAnchor: z
    .object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative()
    })
    .optional(),
  evidence: z
    .array(
      z.object({
        source: z.enum(["campaign_brief", "campaign_context", "review_history", "open_comment", "system_rule"]),
        text: z.string()
      })
    )
    .optional()
});

export const reviewProposalSchema = z.object({
  reviewId: z.string().min(1),
  analyzedDocVersion: z.number().int().nonnegative(),
  verdict: z.enum(["approve", "request_changes", "reject"]),
  summary: z.string().min(1),
  inlineSuggestions: z.array(inlineSuggestionProposalSchema),
  risks: z
    .array(
      z.object({
        category: reviewCategorySchema,
        severity: z.enum(["blocker", "suggestion"]),
        body: z.string()
      })
    )
    .optional()
});
