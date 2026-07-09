import type { DraftReviewInput, ReviewProposal } from "@tutti/draft-doc";
import { buildReviewPrompt } from "./prompt";
import { createModelAdapterForProvider, type LLMProviderConfig, type ModelAdapter } from "./model-adapter";
import { draftReviewInputSchema, reviewProposalSchema } from "./schema";

export type ReviewDraftOptions = {
  modelAdapter?: ModelAdapter;
  providerConfig?: LLMProviderConfig;
};

export async function reviewDraft(
  rawInput: DraftReviewInput,
  options: ReviewDraftOptions = {}
): Promise<ReviewProposal> {
  const input = draftReviewInputSchema.parse(rawInput) as DraftReviewInput;
  const prompt = buildReviewPrompt(input);
  const adapter =
    options.modelAdapter ??
    (options.providerConfig ? createModelAdapterForProvider(options.providerConfig) : undefined);

  if (!adapter) {
    throw new Error(
      "LLM provider is not configured. Provide a modelAdapter or providerConfig with an API key."
    );
  }

  const rawProposal = await adapter.generateReviewProposal({
    prompt,
    schema: reviewProposalSchema,
    providerConfig: options.providerConfig
  });

  const proposal = reviewProposalSchema.parse(rawProposal) as ReviewProposal;
  if (proposal.analyzedDocVersion !== input.draft.docVersion) {
    return {
      ...proposal,
      analyzedDocVersion: input.draft.docVersion
    };
  }
  return proposal;
}
