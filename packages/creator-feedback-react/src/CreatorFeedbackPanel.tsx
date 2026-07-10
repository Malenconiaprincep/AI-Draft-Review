"use client";

import { useEffect, useRef, useState, type MouseEvent, type Ref } from "react";
import type { DraftCommentThread } from "@tutti/draft-doc";

type FeedbackFilter = "all" | "open" | "resolved";

export type CreatorFeedbackPanelProps = {
  comments: DraftCommentThread[];
  selectedCommentId?: string | null;
  canResubmit?: boolean;
  canResolveManualComments?: boolean;
  onSelectComment?: (commentId: string) => void;
  onApplyComment?: (comment: DraftCommentThread) => Promise<void> | void;
  onRejectComment?: (comment: DraftCommentThread) => Promise<void> | void;
  onResolveComment?: (comment: DraftCommentThread) => Promise<void> | void;
  onReopenComment?: (comment: DraftCommentThread) => Promise<void> | void;
  onResubmit?: () => Promise<void> | void;
};

export function CreatorFeedbackPanel(props: CreatorFeedbackPanelProps) {
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const selectedCardRef = useRef<HTMLElement | null>(null);
  const openComments = props.comments.filter((comment) => comment.status === "open");
  const resolvedComments = props.comments.filter((comment) => comment.status === "resolved");
  const filteredComments = props.comments.filter((comment) => {
    if (filter === "open") return comment.status === "open";
    if (filter === "resolved") return comment.status === "resolved";
    return true;
  });

  useEffect(() => {
    if (filter === "open" && openComments.length === 0) setFilter("all");
    if (filter === "resolved" && resolvedComments.length === 0) setFilter("all");
  }, [filter, openComments.length, resolvedComments.length]);

  useEffect(() => {
    if (!props.selectedCommentId || filter === "all") return;
    const selectedComment = props.comments.find((comment) => comment.id === props.selectedCommentId);
    if (!selectedComment) return;
    const selectedFilter: FeedbackFilter = selectedComment.status === "open" ? "open" : "resolved";
    if (filter !== selectedFilter) setFilter(selectedFilter);
  }, [filter, props.comments, props.selectedCommentId]);

  useEffect(() => {
    if (!props.selectedCommentId) return;
    selectedCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [props.selectedCommentId]);

  return (
    <aside className="creator-feedback-panel panel review-panel" aria-label="创作者反馈处理">
      <div className="panel-header">
        <div>
          <div className="panel-title">品牌反馈</div>
          <div className="subtitle">Creator feedback queue</div>
        </div>
        <span className={`status-pill ${openComments.length > 0 ? "amber" : "green"}`}>
          {openComments.length > 0 ? `${openComments.length} 待处理` : "可再提交"}
        </span>
      </div>

      <div className="creator-feedback-panel__body panel-body">
        <div className="tutti-ai-panel__suggestion-toolbar">
          {props.comments.length > 1 ? (
            <div className="comment-filter-row" aria-label="Brand feedback status filters">
              <FeedbackChip active={filter === "all"} count={props.comments.length} label="全部" onClick={() => setFilter("all")} />
              <FeedbackChip active={filter === "open"} count={openComments.length} label="待处理" onClick={() => setFilter("open")} />
              <FeedbackChip
                active={filter === "resolved"}
                count={resolvedComments.length}
                label="已处理"
                onClick={() => setFilter("resolved")}
              />
            </div>
          ) : null}
          {props.comments.length > 0 ? (
            <span className="comment-count">
              {openComments.length} / {props.comments.length} 待处理
            </span>
          ) : null}
        </div>

        {props.comments.length === 0 ? (
          <div className="tutti-ai-panel__empty">暂无品牌反馈。</div>
        ) : filteredComments.length === 0 ? (
          <p className="tutti-ai-panel__muted">当前筛选下没有反馈。</p>
        ) : (
          filteredComments.map((comment) => (
            <FeedbackCard
              key={comment.id}
              cardRef={props.selectedCommentId === comment.id ? selectedCardRef : undefined}
              comment={comment}
              index={props.comments.findIndex((item) => item.id === comment.id) + 1}
              selected={props.selectedCommentId === comment.id}
              canResolveManualComment={Boolean(props.canResolveManualComments)}
              onSelect={() => props.onSelectComment?.(comment.id)}
              onApply={() => void props.onApplyComment?.(comment)}
              onReject={() => void (props.onRejectComment ?? props.onResolveComment)?.(comment)}
              onResolve={() => void props.onResolveComment?.(comment)}
              onReopen={() => void props.onReopenComment?.(comment)}
            />
          ))
        )}

      </div>
    </aside>
  );
}

function FeedbackChip(props: {
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

function FeedbackCard(props: {
  cardRef?: Ref<HTMLElement>;
  comment: DraftCommentThread;
  index: number;
  selected: boolean;
  canResolveManualComment: boolean;
  onSelect: () => void;
  onApply: () => void;
  onReject: () => void;
  onResolve: () => void;
  onReopen: () => void;
}) {
  const refCode = `B${props.index}`;
  const latestMessage = props.comment.messages[props.comment.messages.length - 1];
  const isDone = props.comment.status === "resolved";
  const isReplace = props.comment.action === "replace" && Boolean(props.comment.suggestedText?.trim());
  const body = formatFeedbackBody(latestMessage?.body ?? "品牌方留下了一条反馈。");
  const quotedText = props.comment.quotedText ?? "未定位到原文";
  const resolvedText = props.comment.resolvedText?.trim();
  const showManualDiff = Boolean(!isReplace && isDone && resolvedText && normalizeText(resolvedText) !== normalizeText(quotedText));

  return (
    <article
      ref={props.cardRef}
      className={`creator-feedback-card item comment-card ${
        props.selected ? "current comment-card--expanded" : "comment-card--collapsed"
      } ${isDone ? "tutti-ai-card--done" : ""}`}
      onClick={props.onSelect}
    >
      <div className="item-head">
        <div className="item-title-row">
          <span className="ref-code" aria-label={refCode}>
            {refCode}
          </span>
          <div className="item-title">
            反馈 {props.index}
            <span className="comment-category"> · 品牌审核</span>
          </div>
        </div>
        <div className="meta-row">
          <span className={`status-pill ${isDone ? "green" : "amber"}`}>{isDone ? "已处理" : "待处理"}</span>
        </div>
      </div>

      {props.selected ? (
        <>
          <div className="quote">
            <span>{refCode}</span>
            {quotedText}
          </div>
          <p className="item-copy">{body}</p>
          {isReplace ? (
            <div className="diff" aria-label="品牌替换建议">
              <div className="diff-row remove">
                <span className="diff-sign">-</span>
                <span className="diff-text">{quotedText}</span>
              </div>
              <div className="diff-row add">
                <span className="diff-sign">+</span>
                <span className="diff-text">{props.comment.suggestedText}</span>
              </div>
            </div>
          ) : null}
          {showManualDiff ? (
            <div className="diff" aria-label="创作者修改结果">
              <div className="diff-row remove">
                <span className="diff-sign">-</span>
                <span className="diff-text">{quotedText}</span>
              </div>
              <div className="diff-row add">
                <span className="diff-sign">+</span>
                <span className="diff-text">{resolvedText}</span>
              </div>
            </div>
          ) : null}
          <div className="item-actions">
            {isDone ? (
              <button className="mini-btn warn" type="button" onClick={(event) => actionClick(event, props.onReopen)}>
                重新打开
              </button>
            ) : isReplace ? (
              <>
                <button className="mini-btn primary" type="button" onClick={(event) => actionClick(event, props.onApply)}>
                  应用
                </button>
                <button className="mini-btn warn" type="button" onClick={(event) => actionClick(event, props.onReject)}>
                  拒绝
                </button>
              </>
            ) : (
              <>
                <button
                  className="mini-btn primary"
                  type="button"
                  disabled={!props.canResolveManualComment}
                  onClick={(event) => actionClick(event, props.onResolve)}
                >
                  {props.canResolveManualComment ? "标记完成" : "改稿后完成"}
                </button>
                <button className="mini-btn warn" type="button" onClick={(event) => actionClick(event, props.onReject)}>
                  拒绝
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="compact-quote">{props.comment.quotedText ?? latestMessage?.body ?? "品牌反馈"}</div>
      )}
    </article>
  );
}

function actionClick(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.stopPropagation();
  action();
}

function formatFeedbackBody(body: string) {
  const explanation = body.match(/说明：([\s\S]*)$/)?.[1]?.trim();
  if (explanation) return explanation;
  if (body.startsWith("建议替换为：")) return "请按替换建议调整选中内容。";
  return body;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
