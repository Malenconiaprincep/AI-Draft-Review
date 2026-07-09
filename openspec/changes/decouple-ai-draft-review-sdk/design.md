# Design: Decoupled AI Draft Review Integration Project

## Architecture

```text
Host review page
  ├─ fetches draft / campaign / history / comments from host backend
  ├─ depends on @tutti/draft-doc for DraftDocJSON parsing
  ├─ renders host editor or read-only viewer
  ├─ installs editor-highlight-sdk decorations
  ├─ embeds AIAssistantPanel
        ├─ calls AI Assistant Service with explicit JSON
        ├─ displays review proposal
        └─ invokes host callbacks for confirmed actions
  ├─ embeds BrandReviewPanel for submitted brand review
  └─ embeds CreatorFeedbackPanel for post-submit creator feedback

AI Assistant Service
  ├─ validates request schema
  ├─ builds prompt from draft, brief, history and open comments
  ├─ calls model adapter (DeepSeek preferred, Minimax compatible)
  ├─ validates structured response
  └─ returns review proposal with analyzed doc_version
```

核心原则：

- `doc_json` 只读。AI assistant 和高亮 SDK 永远不写文档本体。
- 高亮来自 comments / suggestions 的派生状态，以 ProseMirror Decoration 呈现。
- service 无状态。所有数据由宿主输入，所有落库由宿主回调处理。
- component 不知道宿主数据库和权限系统，只依赖 props、callbacks 和 typed contracts。
- demo shell 只证明接入路径完整，不替代生产系统。
- 本地 fixture / React state 只用于 demo；生产持久化归宿主。
- `@tutti/draft-doc` 是最核心共享契约，所有模块都依赖它而不是复制 schema 文件。

## Package Boundary

为了让后续系统接入更简单，第一版采用 package-first 设计：

```text
@tutti/draft-doc
  ├─ DraftDocJSON schema
  ├─ Tiptap extension factory
  ├─ fixtures
  ├─ serializers: docJsonToPlainText / docJsonToBlocks
  └─ optional block identity helpers

@tutti/editor-highlight-sdk
  ├─ ProseMirror decoration helpers
  ├─ Tiptap CommentHighlight extension
  └─ anchor locate / remap utilities

@tutti/ai-assistant-service
  ├─ reviewDraft pure service
  ├─ prompt builder
  ├─ model adapters
  └─ Next.js route helper

@tutti/ai-assistant-react
  ├─ AIAssistantPanel
  └─ useAIAssistant

@tutti/brand-review-react
  └─ BrandReviewPanel

@tutti/creator-feedback-react
  └─ CreatorFeedbackPanel

apps/demo-next
  └─ consumes the same packages as a host app would
```

`@tutti/draft-doc` 应该由 tutti-web、brand-admin 和外部协作项目共同依赖。现在“两边各放一份 byte-identical schema.ts”的方式只作为过渡，不作为长期协作方式。

## Shared Domain Types

```ts
export type DraftKind = "url" | "doc";

export type DraftReviewInput = {
  draft: {
    postStateId: string;
    draftKind: DraftKind;
    draftUrl?: string;
    docJson?: unknown;
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
  campaignContext?: Array<{
    id?: string;
    title?: string;
    sourceType?: "brief" | "proposal" | "brand_kit" | "requirements" | "reference" | "other";
    text: string;
    url?: string;
  }>;
  reviewHistory: ReviewHistoryEvent[];
  openComments: DraftCommentThread[];
  options?: {
    language?: "zh" | "en";
    maxInlineSuggestions?: number;
    enabledChecks?: ReviewCheck[];
  };
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
  messages: {
    id: string;
    body: string;
    authorKind: "brand" | "creator";
    authorHandle?: string;
    createdAt: string;
  }[];
};

export type ReviewProposal = {
  reviewId: string;
  analyzedDocVersion: number;
  verdict: "approve" | "request_changes" | "reject";
  summary: string;
  inlineSuggestions: InlineSuggestionProposal[];
  risks?: ReviewRisk[];
};

export type InlineSuggestionProposal = {
  id: string;
  quotedText: string;
  body: string;
  severity: "blocker" | "suggestion";
  category:
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
  /**
   * comment: only create a host comment.
   * replace: replace quotedText with suggestedText.
   * insert_after: insert suggestedText after quotedText.
   * delete: remove quotedText.
   */
  action?: "comment" | "replace" | "insert_after" | "delete";
  suggestedText?: string;
  /**
   * AI service 不要求输出 ProseMirror position。
   * 该字段只允许在前端 SDK 或宿主完成定位后补充。
   */
  resolvedAnchor?: {
    from: number;
    to: number;
  };
  evidence?: {
    source: "campaign_brief" | "campaign_context" | "review_history" | "open_comment" | "system_rule";
    text: string;
  }[];
};
```

## Draft Document Contract

第一版只支持 handoff 中的 Tiptap / ProseMirror JSON：

- Contract is distributed through `@tutti/draft-doc`.
- Root: `{ type: "doc", content: [...] }`
- Tiptap packages locked to `3.27.1`。
- Extension set must match host:
  - `StarterKit` with heading 1-3
  - `Image` as block node, no base64
  - custom `Video` block atom with `src` / `poster`
  - `TableKit` with `resizable: false`
  - `CommentHighlight` as decoration-only extension
- `anchor_from` / `anchor_to` use ProseMirror absolute positions.
- If an anchor cannot be remapped or located, the UI shows an orphan comment fallback using `quoted_text`.
- Stable `blockId` is recommended but optional for v1. If host does not have it, v1 uses `quotedText` plus optional preferred position. If host can add it, it should be introduced in `@tutti/draft-doc` as a versioned schema change, not as an app-local patch.

## Editor Highlight SDK

SDK 分两层：

1. Core utilities：不依赖 React，不依赖宿主业务。
2. Tiptap adapter：把 core highlight 转为 ProseMirror plugin / decoration。

Proposed exports：

```ts
export function createCommentHighlightExtension(config: {
  getHighlights: () => EditorHighlight[];
  onSelectHighlight?: (highlightId: string) => void;
  editable?: boolean;
});

export function buildHighlightDecorations(params: {
  doc: ProseMirrorNode;
  highlights: EditorHighlight[];
  editable: boolean;
}): DecorationSet;

export function remapAnchor(
  mapping: Mapping,
  anchor: { from: number | null; to: number | null }
): { from: number | null; to: number | null };

export function locateQuotedText(params: {
  doc: ProseMirrorNode;
  quotedText: string;
  preferredFrom?: number | null;
  preferredTo?: number | null;
}): { from: number; to: number } | null;

export function quotedTextFromRange(params: {
  doc: ProseMirrorNode;
  from: number;
  to: number;
}): string;

export type EditorHighlight = {
  id: string;
  source: "ai" | "brand";
  status: "open" | "resolved" | "stale" | "orphaned" | "recovered";
  severity?: "blocker" | "suggestion";
  anchorFrom?: number | null;
  anchorTo?: number | null;
  quotedText?: string | null;
  blockId?: string;
  label?: string;
};
```

可编辑状态下，高亮文本不拦截鼠标点击，避免影响 caret。只有 badge 或右侧 panel item 触发定位 / 选中。只读 viewer 可以允许整段高亮作为定位热区。

## AI Assistant Service

Service 可以同时暴露函数、route helper 和 Next.js route：

```ts
export async function reviewDraft(
  input: DraftReviewInput,
  options?: ReviewDraftOptions
): Promise<ReviewProposal>;

export type ReviewDraftOptions = {
  modelAdapter?: ModelAdapter;
  providerConfig?: LLMProviderConfig;
};

export type LLMProviderConfig = {
  provider: "deepseek" | "minimax" | "openai_compatible" | "custom";
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

export interface ModelAdapter {
  generateReviewProposal(args: {
    prompt: string;
    schema: unknown;
    providerConfig?: LLMProviderConfig;
  }): Promise<unknown>;
}
```

```http
POST /api/ai-assistant/review
Content-Type: application/json

DraftReviewInput
```

Response：

```ts
type ReviewDraftResponse = ReviewProposal;
```

Service responsibilities：

- Validate request with a runtime schema.
- Normalize `doc_json` to plain text for prompt context.
- Include campaign brief, review history notes and open comment messages.
- Build a prompt that asks for a structured proposal, not freeform advice.
- Use DeepSeek as the preferred real provider in v1.
- Keep Minimax as a compatibility provider.
- Allow a host to inject `modelAdapter` or server-side `providerConfig` for other providers later.
- Parse and validate model output.
- Return `analyzedDocVersion`.
- Never write comments, status or `doc_json`.
- Never require the model to output ProseMirror positions.

Provider rules：

- First preferred real adapter is DeepSeek.
- Minimax remains available when configured.
- If no real provider config exists, the service returns an explainable configuration error.
- External model / API key support is server-side configuration. Browser components must not receive or forward raw API keys.
- If this service is deployed by an integrator, they may provide `provider`, `model`, `apiKey` and `baseUrl` through environment variables or a server-to-server request.

Prompt must include：

- 当前 draft 内容。
- Campaign brief：description、slogan、hashtags、official posts、content url、idea starters。
- 历史 review notes，按时间升序。
- 当前 open comments，避免重复提出已存在问题。
- 高频拒稿规则：缺产品实测 / 演示、品牌名错误、事实错误、案例太弱、泛泛而谈。
- 输出 JSON schema。

Proposal semantics：

- `verdict = approve` means AI found no blocking issue; host still decides final approval.
- `verdict = request_changes` means AI suggests inline comments or review note changes.
- `verdict = reject` means AI found strong rejection risk, but host must confirm.
- `inlineSuggestions` are proposals. Host creates real rows through existing comment API after human confirmation.
- Each inline suggestion uses `quotedText` as its primary locator. The editor SDK or host resolves it into `anchor_from` / `anchor_to` when creating a real comment.

## AI Assistant React Component

Core component：

```tsx
export function AIAssistantPanel(props: {
  input: DraftReviewInput;
  proposal?: ReviewProposal;
  status?: "idle" | "reviewing" | "ready" | "error" | "stale";
  errorMessage?: string;
  selectedSuggestionId?: string;
  onRunReview: (input: DraftReviewInput) => Promise<ReviewProposal>;
  onSelectSuggestion?: (suggestionId: string) => void;
  onApplySuggestion?: (suggestion: InlineSuggestionProposal) => Promise<void>;
  onRejectSuggestion?: (suggestion: InlineSuggestionProposal) => Promise<void>;
  onApplyAllSuggestions?: (suggestions: InlineSuggestionProposal[]) => Promise<void>;
  onRejectAllSuggestions?: (suggestions: InlineSuggestionProposal[]) => Promise<void>;
  onUndoLastAction?: () => Promise<void>;
});
```

Component responsibilities：

- 展示 inline suggestion 列表、处理状态、证据和批量动作。
- 展示 loading、error、empty、stale 状态。
- 当 `proposal.analyzedDocVersion !== input.draft.docVersion` 时提示过期。
- 点击 suggestion 时通知宿主定位高亮。
- 用户 apply / reject 后通过 callback 让宿主决定是否改文、落库或仅更新本地状态。
- 可以展示 AI verdict，但不直接提交 approve / request changes / reject。
- 不直接调用宿主数据库或审核状态接口。

## Brand Review React Component

`@tutti/brand-review-react` 提供品牌方审核已提交 draft 的可复用组件：

```tsx
export function BrandReviewPanel(props: {
  status: "waiting" | "reviewing" | "resubmitted" | "approved" | "published";
  campaignName?: string;
  draftVersion?: number;
  feedbackDrafts: DraftCommentThread[];
  selectedText?: string;
  selectedFeedbackId?: string | null;
  canApprove?: boolean;
  onSelectFeedback?: (feedbackId: string) => void;
  onCreateFeedback?: (feedback: BrandFeedbackDraftInput) => Promise<void>;
  onRemoveFeedback?: (feedback: DraftCommentThread) => Promise<void>;
  onSendFeedback?: (feedback: DraftCommentThread[]) => Promise<void>;
  onApproveDraft?: () => Promise<void>;
});
```

Component responsibilities：

- 展示品牌审核上下文、当前选区和待发送反馈。
- 支持品牌方基于选区创建评论或替换建议、删除反馈、发送反馈给创作者、通过。
- 点击反馈时通知宿主定位正文高亮。
- 所有评论创建、发送、approve 状态变更都通过 callbacks 交给宿主。
- 不直接持久化 comment，不直接变更 `post_state.status`。

## Creator Feedback React Component

`@tutti/creator-feedback-react` 提供创作者提交后处理品牌方反馈的可复用组件：

```tsx
export function CreatorFeedbackPanel(props: {
  comments: DraftCommentThread[];
  selectedCommentId?: string | null;
  canResubmit?: boolean;
  onSelectComment?: (commentId: string) => void;
  onApplyComment?: (comment: DraftCommentThread) => Promise<void>;
  onRejectComment?: (comment: DraftCommentThread) => Promise<void>;
  onApplyAllComments?: (comments: DraftCommentThread[]) => Promise<void>;
  onResolveComment?: (comment: DraftCommentThread) => Promise<void>;
  onReopenComment?: (comment: DraftCommentThread) => Promise<void>;
  onResolveAllComments?: (comments: DraftCommentThread[]) => Promise<void>;
  onResubmit?: () => Promise<void>;
});
```

Component responsibilities：

- 展示品牌方 open / resolved comments。
- 保持 `B{n}` 编号与输入 comment 顺序一致。
- 支持全部 / 待处理 / 已处理筛选。
- 支持展开、应用、拒绝、重新打开、批量应用、再次提交回调。
- 不直接持久化 comment 状态，不直接变更 `post_state.status`。

## Next.js Demo

Demo 需要包含：

- 一个 draft review 页面，展示只读 Tiptap viewer + assistant panel。
- fixture data：
  - `doc_json` sample
  - `campaignBrief`，可选结构化摘要
  - `campaignContext`，动态资料源，例如完整 proposal、品牌工具包、发布规范、参考素材
  - `reviewHistory`
  - `openComments`
- API route：`/api/ai-assistant/review`。
- DeepSeek model adapter：通过服务端 env var 开启。
- Minimax model adapter：保留兼容。
- Provider config example：展示后续如何替换 model / API key。
- Demo React state：保存演示内已处理 suggestion、品牌反馈草稿、提交后 workflow stage、selection state。
- Host callback examples：
  - apply / reject AI suggestion
  - submit draft
  - create / remove brand feedback
  - send brand feedback to creator
  - approve draft
  - resolve / reopen brand feedback
  - resubmit draft
  - select / scroll highlight

Demo 验收不是完整生产 workflow，而是证明宿主未来可以用同样 contract 接入 AI 自查、品牌审核操作和提交后的创作者反馈处理。

## Future Contract Adapters

导入和发布不进入当前第一版，但它们应该沿用同一个 `@tutti/draft-doc` 契约：

- Google Docs / Notion import adapter: HTML / export payload -> DraftDocJSON。
- Typefully-like publish adapter: DraftDocJSON -> X thread segments / media payload。

OAuth、真实发布调用和 `doc_json` 落库仍由宿主负责。

## Testing Strategy

- Unit tests：
  - request / response schema validation
  - `doc_json` to plain text
  - quoted text extraction
  - anchor locate fallback
  - stale `doc_version` detection
- Component tests：
  - loading / error / ready / stale states
  - suggestion selection callback
  - apply / reject callback
  - brand review create / remove / send / approve callbacks
  - creator feedback filter / resolve / resubmit callback
- Integration demo tests：
  - run AI review with fixtures
  - proposal renders in panel
  - highlight decorations appear in viewer
  - selecting panel item selects corresponding highlight

## Migration From Existing Prototype Spec

保留：

- Review category taxonomy。
- AI structured suggestions。
- 高亮与右侧 panel 联动。
- `from / to + quotedText` anchor design。
- AI 不自动改稿。
- 品牌方最终判定优先。

移出第一版：

- 创作者完整写作 workspace。
- 品牌方完整 review console。
- 真实 Submit / resubmit workflow API。
- Revision diff。

原因：当前目标是为后续系统做集成边界，而不是重建一个完整审核系统。
