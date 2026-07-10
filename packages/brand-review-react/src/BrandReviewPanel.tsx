"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type Ref } from "react";
import type { DraftCommentThread, ReviewCategory } from "@tutti/draft-doc";

export type BrandReviewStatus = "waiting" | "reviewing" | "resubmitted" | "approved" | "published";
export type BrandFeedbackAction = "comment" | "replace";

export type BrandFeedbackDraftInput = {
  quotedText: string;
  body: string;
  action: BrandFeedbackAction;
  suggestedText?: string;
  category?: ReviewCategory;
};

export type BrandRevisionChange = {
  id?: string;
  label: string;
  oldText: string;
  newText: string;
};

export type BrandRevisionDiff = {
  baseVersion?: number | null;
  revision?: number | null;
  changes: BrandRevisionChange[];
};

export type BrandReviewPanelProps = {
  status: BrandReviewStatus;
  campaignName?: string;
  draftVersion?: number;
  revisionDiff?: BrandRevisionDiff | null;
  compareChanges?: boolean;
  feedbackDrafts: DraftCommentThread[];
  selectedText?: string;
  selectedFeedbackId?: string | null;
  canApprove?: boolean;
  onSelectFeedback?: (feedbackId: string) => void;
  onClearSelection?: () => void;
  /** Called when the reviewer begins editing or chooses an action for the selected text. */
  onFeedbackInteraction?: () => void;
  onToggleCompareChanges?: () => void;
  onCreateFeedback?: (feedback: BrandFeedbackDraftInput) => Promise<void> | void;
  onRemoveFeedback?: (feedback: DraftCommentThread) => Promise<void> | void;
  onSendFeedback?: (feedback: DraftCommentThread[]) => Promise<void> | void;
  onApproveDraft?: () => Promise<void> | void;
};

export function BrandReviewPanel(props: BrandReviewPanelProps) {
  const [action, setAction] = useState<BrandFeedbackAction>("comment");
  const [body, setBody] = useState("");
  const [suggestedText, setSuggestedText] = useState("");
  const selectedCardRef = useRef<HTMLElement | null>(null);
  const isReviewing = props.status === "reviewing" || props.status === "resubmitted";
  const hasFeedback = props.feedbackDrafts.length > 0;
  const selectedText = props.selectedText?.trim() ?? "";
  const canCreateComment = Boolean(isReviewing && selectedText && body.trim());
  const canCreateReplace = Boolean(isReviewing && selectedText && suggestedText.trim());

  useEffect(() => {
    if (!props.selectedFeedbackId) return;
    selectedCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [props.selectedFeedbackId]);

  function submitSelectionFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action === "comment" && !canCreateComment) return;
    if (action === "replace" && !canCreateReplace) return;
    void props.onCreateFeedback?.({
      quotedText: selectedText,
      body: action === "replace" && !body.trim() ? "请按替换建议调整选中内容。" : body.trim(),
      action,
      suggestedText: action === "replace" ? suggestedText.trim() : undefined,
      category: "general_comment"
    });
    setBody("");
    setSuggestedText("");
  }

  return (
    <aside className="brand-review-panel panel review-panel" aria-label="品牌方审核">
      <div className="panel-header">
        <div>
          <div className="panel-title">品牌审核</div>
          <div className="subtitle">{getStatusSubtitle(props.status)}</div>
        </div>
        <span className={`status-pill ${getStatusClass(props.status, hasFeedback)}`}>
          {getStatusLabel(props.status, props.feedbackDrafts.length)}
        </span>
      </div>

      <div className="brand-review-panel__body panel-body">
        <div className="brand-review-meta" aria-label="审核上下文">
          <div>
            <span>Campaign</span>
            <strong>{props.campaignName ?? "未命名 Campaign"}</strong>
          </div>
          <div>
            <span>Revision</span>
            <strong>{props.draftVersion ? `v${props.draftVersion}` : "—"}</strong>
          </div>
        </div>

        {isReviewing ? (
          <>
            {props.status === "resubmitted" && props.revisionDiff ? (
              <RevisionDiffPanel
                compareChanges={Boolean(props.compareChanges)}
                diff={props.revisionDiff}
                onToggleCompareChanges={props.onToggleCompareChanges}
              />
            ) : null}

            <section className="brand-review-section">
              <div className="brand-review-section-head">
                <h3>反馈对象</h3>
                <span>{selectedText ? "已选择" : "未选择"}</span>
              </div>
              <form
                className="brand-review-form"
                onSubmit={submitSelectionFeedback}
                onMouseDownCapture={props.onFeedbackInteraction}
              >
                <div className={`brand-review-selection ${selectedText ? "" : "empty"}`}>
                  {selectedText ? (
                    <>
                      <span className="brand-review-selection-mark" aria-hidden="true" />
                      <div className="brand-review-selection-copy">
                        <strong>已定位左侧区块</strong>
                        <span>选择评论或替换后添加反馈</span>
                      </div>
                      <button className="brand-review-selection-clear" type="button" onClick={props.onClearSelection}>
                        重选
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="brand-review-selection-mark muted" aria-hidden="true" />
                      <div className="brand-review-selection-copy">
                        <strong>选择反馈对象</strong>
                        <span>在左侧稿件中拖选一段内容</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="brand-review-mode-row" role="group" aria-label="反馈行为">
                  <button
                    type="button"
                    className={`brand-review-mode ${action === "comment" ? "active" : ""}`}
                    onClick={() => setAction("comment")}
                  >
                    评论
                  </button>
                  <button
                    type="button"
                    className={`brand-review-mode ${action === "replace" ? "active" : ""}`}
                    onClick={() => setAction("replace")}
                  >
                    替换
                  </button>
                </div>
                {action === "replace" ? (
                  <label>
                    <span>替换为</span>
                    <textarea
                      value={suggestedText}
                      onChange={(event) => setSuggestedText(event.target.value)}
                      placeholder="写给创作者的替换文本"
                    />
                  </label>
                ) : null}
                <label>
                  <span>{action === "replace" ? "说明" : "评论内容"}</span>
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={action === "replace" ? "说明为什么建议替换" : "写给创作者的修改意见"}
                  />
                </label>
                <button className="bulk-btn primary" type="submit" disabled={action === "replace" ? !canCreateReplace : !canCreateComment}>
                  添加{action === "replace" ? "替换" : "评论"}
                </button>
              </form>
            </section>

            <section className="brand-review-section">
              <div className="brand-review-section-head">
                <h3>待发送反馈</h3>
                <span>{props.feedbackDrafts.length}</span>
              </div>
              {props.feedbackDrafts.length === 0 ? (
                <p className="tutti-ai-panel__muted">还没有添加反馈；没有问题时可以直接通过。</p>
              ) : (
                <div className="brand-review-list">
                  {props.feedbackDrafts.map((feedback, index) => (
                    <BrandFeedbackCard
                      key={feedback.id}
                      cardRef={props.selectedFeedbackId === feedback.id ? selectedCardRef : undefined}
                      feedback={feedback}
                      index={index + 1}
                      selected={props.selectedFeedbackId === feedback.id}
                      onSelect={() => props.onSelectFeedback?.(feedback.id)}
                      onRemove={() => void props.onRemoveFeedback?.(feedback)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="brand-review-empty">
            <strong>{getEmptyTitle(props.status)}</strong>
            <p>{getEmptyCopy(props.status)}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function RevisionDiffPanel(props: {
  compareChanges: boolean;
  diff: BrandRevisionDiff;
  onToggleCompareChanges?: () => void;
}) {
  const rangeLabel =
    props.diff.baseVersion && props.diff.revision
      ? `v${props.diff.baseVersion} → v${props.diff.revision}`
      : "本轮变更";
  const changeCount = props.diff.changes.length;

  return (
    <section className="brand-revision-diff" aria-label="本轮版本变更">
      <div className="brand-revision-diff-head">
        <div>
          <span className="revision-kicker">Changes</span>
          <h3>{rangeLabel}</h3>
          <p>{changeCount > 0 ? `${changeCount} 处正文变化，可在左侧稿件中对比查看。` : "未检测到正文变化。"}</p>
        </div>
      </div>
      <button
        className={`bulk-btn ${props.compareChanges ? "ghost" : "primary"}`}
        type="button"
        disabled={changeCount === 0}
        onClick={() => void props.onToggleCompareChanges?.()}
      >
        {props.compareChanges ? "查看当前稿" : "对比 changes"}
      </button>
    </section>
  );
}

function BrandFeedbackCard(props: {
  cardRef?: Ref<HTMLElement>;
  feedback: DraftCommentThread;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const refCode = `B${props.index}`;
  const latestMessage = props.feedback.messages[props.feedback.messages.length - 1];

  return (
    <article
      ref={props.cardRef}
      className={`brand-review-card item comment-card ${props.selected ? "current comment-card--expanded" : "comment-card--collapsed"}`}
      onClick={props.onSelect}
    >
      <div className="item-head">
        <div className="item-title-row">
          <span className="ref-code" aria-label={refCode}>
            {refCode}
          </span>
          <div className="item-title">反馈 {props.index}</div>
        </div>
        <button className="mini-icon-btn" type="button" onClick={(event) => actionClick(event, props.onRemove)} aria-label="删除反馈">
          ×
        </button>
      </div>
      <div className="quote">
        <span>{refCode}</span>
        {props.feedback.quotedText ?? "未定位到原文"}
      </div>
      <p className="item-copy">{latestMessage?.body ?? "品牌方反馈。"}</p>
    </article>
  );
}

function getStatusSubtitle(status: BrandReviewStatus) {
  if (status === "waiting") return "Waiting for creator submission";
  if (status === "resubmitted") return "Resubmitted draft review";
  if (status === "approved") return "Approved by brand";
  if (status === "published") return "Published";
  return "Submitted draft review";
}

function getStatusLabel(status: BrandReviewStatus, feedbackCount: number) {
  if (status === "waiting") return "等待提交";
  if (status === "approved") return "已通过";
  if (status === "published") return "已发布";
  if (feedbackCount > 0) return `${feedbackCount} 条反馈`;
  return "审核中";
}

function getStatusClass(status: BrandReviewStatus, hasFeedback: boolean) {
  if (status === "approved" || status === "published") return "green";
  if (status === "waiting") return "neutral";
  return hasFeedback ? "amber" : "";
}

function getEmptyTitle(status: BrandReviewStatus) {
  if (status === "approved") return "品牌方已通过";
  if (status === "published") return "内容已发布";
  return "等待创作者提交";
}

function getEmptyCopy(status: BrandReviewStatus) {
  if (status === "approved") return "这版 draft 已经通过，后续可以进入发布动作。";
  if (status === "published") return "审核和发布流程已经完成。";
  return "创作者提交后，这里会出现品牌方审核、添加反馈和通过操作。";
}

function actionClick(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.stopPropagation();
  action();
}
