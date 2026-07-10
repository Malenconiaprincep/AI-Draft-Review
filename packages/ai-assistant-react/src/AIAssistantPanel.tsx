"use client";

import { useEffect, useRef, useState, type MouseEvent, type Ref } from "react";
import type { DraftReviewInput, InlineSuggestionProposal, ReviewProposal } from "@tutti/draft-doc";
import { useAIAssistant, type AIAssistantStatus } from "./useAIAssistant";

export type SuggestionStatus = "pending" | "accepted" | "rejected";
type SuggestionFilter = "all" | "pending" | "done";

export type AIAssistantPanelProps = {
  input: DraftReviewInput;
  proposal?: ReviewProposal;
  status?: AIAssistantStatus;
  errorMessage?: string;
  selectedSuggestionId?: string | null;
  suggestionStatuses?: Record<string, SuggestionStatus>;
  canUndo?: boolean;
  showRunReviewAction?: boolean;
  onRunReview: (input: DraftReviewInput) => Promise<ReviewProposal>;
  onSelectSuggestion?: (suggestionId: string) => void;
  onApplySuggestion?: (suggestion: InlineSuggestionProposal) => Promise<void> | void;
  onRejectSuggestion?: (suggestion: InlineSuggestionProposal) => Promise<void> | void;
  onApplyAllSuggestions?: (suggestions: InlineSuggestionProposal[]) => Promise<void> | void;
  onRejectAllSuggestions?: (suggestions: InlineSuggestionProposal[]) => Promise<void> | void;
  onUndoLastAction?: () => Promise<void> | void;
  onDismissSuggestion?: (suggestionId: string) => void;
};

export function AIAssistantPanel(props: AIAssistantPanelProps) {
  const [filter, setFilter] = useState<SuggestionFilter>("all");
  const assistant = useAIAssistant({
    input: props.input,
    onRunReview: props.onRunReview,
    initialProposal: props.proposal
  });

  const hasControlledProposal = Object.prototype.hasOwnProperty.call(props, "proposal");
  const proposal = hasControlledProposal ? props.proposal : assistant.proposal;
  const status =
    props.status ??
    (hasControlledProposal && !proposal && assistant.status !== "reviewing" && assistant.status !== "error"
      ? "idle"
      : assistant.status);
  const errorMessage = props.errorMessage ?? assistant.errorMessage;
  const suggestions = proposal
    ? proposal.inlineSuggestions.filter((suggestion) =>
        assistant.visibleSuggestions.some((visible) => visible.id === suggestion.id)
      )
    : [];
  const pendingSuggestions = suggestions.filter(
    (suggestion) => getSuggestionStatus(props.suggestionStatuses, suggestion.id) === "pending"
  );
  const doneSuggestions = suggestions.filter(
    (suggestion) => getSuggestionStatus(props.suggestionStatuses, suggestion.id) !== "pending"
  );
  const filteredSuggestions = suggestions.filter((suggestion) => {
    const suggestionStatus = getSuggestionStatus(props.suggestionStatuses, suggestion.id);
    if (filter === "pending") return suggestionStatus === "pending";
    if (filter === "done") return suggestionStatus !== "pending";
    return true;
  });
  const stale = Boolean(proposal && proposal.analyzedDocVersion !== props.input.draft.docVersion);
  const openBrandFeedbackCount = props.input.openComments.filter((comment) => comment.status === "open").length;
  const selectedCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (filter === "pending" && pendingSuggestions.length === 0) setFilter("all");
    if (filter === "done" && doneSuggestions.length === 0) setFilter("all");
  }, [doneSuggestions.length, filter, pendingSuggestions.length]);

  useEffect(() => {
    if (!props.selectedSuggestionId || filter === "all") return;
    const selectedSuggestion = suggestions.find((suggestion) => suggestion.id === props.selectedSuggestionId);
    if (!selectedSuggestion) return;

    const selectedStatus = getSuggestionStatus(props.suggestionStatuses, selectedSuggestion.id);
    const selectedFilter: SuggestionFilter = selectedStatus === "pending" ? "pending" : "done";
    if (filter !== selectedFilter) setFilter(selectedFilter);
  }, [filter, props.selectedSuggestionId, props.suggestionStatuses, suggestions]);

  useEffect(() => {
    if (!props.selectedSuggestionId) return;
    selectedCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [props.selectedSuggestionId]);

  return (
    <aside className="tutti-ai-panel panel review-panel" aria-label="AI 审稿助手">
      <div className="tutti-ai-panel__header panel-header">
        <div className="panel-title">Review Panel</div>
        <div className="tabs" role="tablist">
          <button className="tab active" type="button">
            AI
            {pendingSuggestions.length > 0 ? <span className="tab-count">{pendingSuggestions.length}</span> : null}
          </button>
          <button className="tab" type="button" disabled>
            品牌反馈
            {openBrandFeedbackCount > 0 ? <span className="tab-count">{openBrandFeedbackCount}</span> : null}
          </button>
        </div>
      </div>

      <div className="tutti-ai-panel__body panel-body">
        {props.showRunReviewAction !== false ? (
          <div className="tutti-ai-panel__run-action">
            <button
              className="bulk-btn primary"
              type="button"
              disabled={status === "reviewing"}
              onClick={() => void assistant.runReview()}
            >
              {status === "reviewing" ? "审阅中…" : proposal ? "重新审阅" : "运行 AI Review"}
            </button>
          </div>
        ) : null}

        {status === "idle" && !proposal ? (
          <div className="tutti-ai-panel__empty">暂无 AI 审稿建议。</div>
        ) : null}

        {status === "reviewing" && !proposal ? (
          <div className="tutti-ai-panel__empty">正在分析当前稿件…</div>
        ) : null}

        {status === "error" ? (
          <div className="tutti-ai-panel__error">{errorMessage ?? "AI 审阅失败。"}</div>
        ) : null}

        {proposal ? (
          <>
          {stale && (
            <div className="tutti-ai-panel__stale">
              这份建议基于文档版本 {proposal.analyzedDocVersion} 生成；当前版本是{" "}
              {props.input.draft.docVersion}，建议重新审阅。
            </div>
          )}

          <section className="tutti-ai-panel__suggestions">
            <div className="tutti-ai-panel__suggestion-toolbar">
              {suggestions.length > 1 && (
                <div className="comment-filter-row" aria-label="AI comment status filters">
                  <FilterChip active={filter === "all"} count={suggestions.length} label="全部" onClick={() => setFilter("all")} />
                  <FilterChip
                    active={filter === "pending"}
                    count={pendingSuggestions.length}
                    label="未处理"
                    onClick={() => setFilter("pending")}
                  />
                  <FilterChip
                    active={filter === "done"}
                    count={doneSuggestions.length}
                    label="已处理"
                    onClick={() => setFilter("done")}
                  />
                </div>
              )}
              {suggestions.length > 0 && (
                <span className="comment-count">
                  {pendingSuggestions.length} / {suggestions.length} 待处理
                </span>
              )}
            </div>
            {suggestions.length > 1 && (
              <div className="tutti-ai-panel__bulk-actions">
                <button
                  className="bulk-btn primary"
                  type="button"
                  disabled={pendingSuggestions.length === 0}
                  onClick={() => void props.onApplyAllSuggestions?.(pendingSuggestions)}
                >
                  全部应用
                </button>
                <button
                  className="bulk-btn danger"
                  type="button"
                  disabled={pendingSuggestions.length === 0}
                  onClick={() => void props.onRejectAllSuggestions?.(pendingSuggestions)}
                >
                  全部拒绝
                </button>
                <button className="bulk-btn ghost" type="button" disabled={!props.canUndo} onClick={() => void props.onUndoLastAction?.()}>
                  撤销
                </button>
              </div>
            )}
            {suggestions.length === 0 ? (
              <p className="tutti-ai-panel__muted">暂无待处理 AI 建议。</p>
            ) : filteredSuggestions.length === 0 ? (
              <p className="tutti-ai-panel__muted">当前筛选下没有建议。</p>
            ) : (
              filteredSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  cardRef={props.selectedSuggestionId === suggestion.id ? selectedCardRef : undefined}
                  index={suggestions.findIndex((item) => item.id === suggestion.id) + 1}
                  suggestion={suggestion}
                  status={getSuggestionStatus(props.suggestionStatuses, suggestion.id)}
                  selected={props.selectedSuggestionId === suggestion.id}
                  onSelect={() => props.onSelectSuggestion?.(suggestion.id)}
                  onApply={() => void props.onApplySuggestion?.(suggestion)}
                  onReject={() => void props.onRejectSuggestion?.(suggestion)}
                  onDismiss={() => {
                    assistant.dismissSuggestion(suggestion.id);
                    props.onDismissSuggestion?.(suggestion.id);
                  }}
                />
              ))
            )}
          </section>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function FilterChip(props: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={`comment-filter-chip ${props.active ? "active" : ""}`}
      disabled={props.count === 0}
      onClick={props.onClick}
    >
      {props.label} {props.count}
    </button>
  );
}

function SuggestionCard(props: {
  cardRef?: Ref<HTMLElement>;
  index: number;
  suggestion: InlineSuggestionProposal;
  status: SuggestionStatus;
  selected: boolean;
  onSelect: () => void;
  onApply: () => void;
  onReject: () => void;
  onDismiss: () => void;
}) {
  const isDone = props.status !== "pending";
  const refCode = `A${props.index}`;
  return (
    <article
      ref={props.cardRef}
      className={`tutti-ai-card item comment-card ${props.selected ? "current comment-card--expanded" : "comment-card--collapsed"} ${
        isDone ? "tutti-ai-card--done" : ""
      }`}
      onClick={props.onSelect}
    >
      <div className="item-head">
        <div className="item-title-row">
          <span className="ref-code" aria-label={refCode}>
            {refCode}
          </span>
          <div className="item-title">
            评论 {props.index}
            <span className="comment-category"> · {formatCategory(props.suggestion.category)}</span>
          </div>
        </div>
        <div className="meta-row">
          <span className={`status-pill ${statusClass(props.status)}`}>{formatSuggestionStatus(props.status)}</span>
        </div>
      </div>
      {props.selected ? (
        <>
          <div className="quote">
            <span>{refCode}</span>
            {props.suggestion.quotedText}
          </div>
          <p className="item-copy">{props.suggestion.body}</p>
          {props.suggestion.suggestedText ? (
            <div className="comment-suggestion">
              <span>建议改为</span>
              <p>{props.suggestion.suggestedText}</p>
            </div>
          ) : null}
          {props.suggestion.evidence?.length ? (
            <ul>
              {props.suggestion.evidence.map((item, index) => (
                <li key={`${item.source}-${index}`}>
                  {formatEvidenceSource(item.source)}：{item.text}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="item-actions">
            <button className="mini-btn primary" type="button" disabled={isDone} onClick={(event) => actionClick(event, props.onApply)}>
              处理
            </button>
            <button className="mini-btn warn" type="button" disabled={isDone} onClick={(event) => actionClick(event, props.onReject)}>
              忽略
            </button>
          </div>
        </>
      ) : (
        <div className="compact-quote">{props.suggestion.quotedText}</div>
      )}
    </article>
  );
}

function actionClick(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.stopPropagation();
  action();
}

function getSuggestionStatus(statuses: AIAssistantPanelProps["suggestionStatuses"], id: string): SuggestionStatus {
  return statuses?.[id] ?? "pending";
}

function statusClass(status: SuggestionStatus) {
  if (status === "accepted") return "green";
  if (status === "rejected") return "red";
  return "neutral";
}

function formatSuggestionStatus(status: SuggestionStatus) {
  if (status === "accepted") return "已应用";
  if (status === "rejected") return "已拒绝";
  return "待处理";
}

function formatEvidenceSource(source: NonNullable<InlineSuggestionProposal["evidence"]>[number]["source"]) {
  const labels = {
    campaign_brief: "活动 brief",
    campaign_context: "活动资料",
    review_history: "历史反馈",
    open_comment: "已有评论",
    system_rule: "审核规则"
  };
  return labels[source];
}

function formatCategory(category: InlineSuggestionProposal["category"]) {
  const labels = {
    brand_cta: "品牌导流",
    link_issue: "链接问题",
    campaign_brief: "Brief 符合度",
    factual_error: "事实错误",
    format_issue: "格式问题",
    content_quality: "内容质量",
    similarity_risk: "相似风险",
    image_asset: "图片素材",
    publish_flow: "发布流程",
    general_comment: "一般建议"
  };
  return labels[category];
}
