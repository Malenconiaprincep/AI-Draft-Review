"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DraftReviewInput, ReviewProposal } from "@tutti/draft-doc";

export type AIAssistantStatus = "idle" | "reviewing" | "ready" | "error" | "stale";

export function useAIAssistant(args: {
  input: DraftReviewInput;
  onRunReview: (input: DraftReviewInput) => Promise<ReviewProposal>;
  initialProposal?: ReviewProposal;
}) {
  const { input, onRunReview, initialProposal } = args;
  const [proposal, setProposal] = useState<ReviewProposal | undefined>(initialProposal);
  const [status, setStatus] = useState<AIAssistantStatus>(initialProposal ? "ready" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!initialProposal) return;
    setProposal(initialProposal);
    setDismissedIds(new Set());
    setStatus(initialProposal.analyzedDocVersion === input.draft.docVersion ? "ready" : "stale");
    setErrorMessage(undefined);
  }, [initialProposal, input.draft.docVersion]);

  const isStale = Boolean(proposal && proposal.analyzedDocVersion !== input.draft.docVersion);

  const runReview = useCallback(async () => {
    setStatus("reviewing");
    setErrorMessage(undefined);
    try {
      const nextProposal = await onRunReview(input);
      setProposal(nextProposal);
      setDismissedIds(new Set());
      setStatus(nextProposal.analyzedDocVersion === input.draft.docVersion ? "ready" : "stale");
      return nextProposal;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI review failed.";
      setErrorMessage(message);
      setStatus("error");
      return undefined;
    }
  }, [input, onRunReview]);

  const dismissSuggestion = useCallback((suggestionId: string) => {
    setDismissedIds((current) => new Set([...current, suggestionId]));
  }, []);

  const visibleSuggestions = useMemo(() => {
    return proposal?.inlineSuggestions.filter((suggestion) => !dismissedIds.has(suggestion.id)) ?? [];
  }, [dismissedIds, proposal]);

  return {
    proposal,
    visibleSuggestions,
    status: isStale ? "stale" : status,
    errorMessage,
    runReview,
    dismissSuggestion
  };
}
