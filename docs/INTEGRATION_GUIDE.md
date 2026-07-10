# AI Draft Review 业务接入指南

本文面向 `tutti-web`、`brand-admin` 或其他业务宿主。目标是复用六个能力包，不复制 `apps/demo-next` 的本地状态机。

## 1. 接入边界

宿主系统必须负责：

- 权限校验和业务数据读取。
- `doc_json` / `doc_version` 保存与版本递增。
- 评论、评论消息和 resolve 状态持久化。
- approve、request changes、reject、resubmit 等审核状态流转。
- AI proposal 的 `analyzedDocVersion` 过期校验。

能力包负责：

- 校验显式输入并生成结构化 AI proposal。
- 用 ProseMirror decorations 渲染 AI / 品牌反馈高亮。
- 展示 AI 建议、品牌审核和创作者反馈 UI。
- 通过 callbacks 把用户确认动作交回宿主。

以下动作禁止放进组件或 SDK：直连生产数据库、直接更新 `post_state.status`、在浏览器传递 LLM API key、把高亮 mark 写进 `doc_json`。

## 2. 包与业务页面对应关系

| 包 | 接入位置 | 主要输入 / 输出 |
| --- | --- | --- |
| `@tutti/draft-doc` | 所有涉及 DraftDocJSON 的项目 | schema extensions、共享类型、serializer |
| `@tutti/editor-highlight-sdk` | Tiptap editor / viewer | decorations、anchor locate / remap、定位滚动 |
| `@tutti/ai-assistant-service` | 服务端 route / server action | `unknown` JSON → `ReviewProposal` |
| `@tutti/ai-assistant-react` | 创作者 AI 自查页面 | proposal UI + apply / reject callbacks |
| `@tutti/brand-review-react` | 品牌审核页面 | 选区反馈草稿 + send / approve callbacks |
| `@tutti/creator-feedback-react` | 创作者改稿页面 | 品牌反馈处理 + resubmit callbacks |

## 3. 当前推荐的安装方式

当前六个包是源码 workspace 包，适合业务同学拉取代码后放进同一个 monorepo 接入。它们尚未生成可发布到私有 registry 的 `dist` 产物。

把本仓库的 `packages/*` 放入宿主 monorepo 后，确保根 `package.json` 包含：

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

宿主应用声明所需依赖，例如：

```json
{
  "dependencies": {
    "@tutti/draft-doc": "0.1.0",
    "@tutti/editor-highlight-sdk": "0.1.0",
    "@tutti/ai-assistant-service": "0.1.0",
    "@tutti/ai-assistant-react": "0.1.0",
    "@tutti/brand-review-react": "0.1.0",
    "@tutti/creator-feedback-react": "0.1.0"
  }
}
```

Next.js 使用源码包时，在 `next.config.mjs` 中加入：

```js
const nextConfig = {
  transpilePackages: [
    "@tutti/draft-doc",
    "@tutti/editor-highlight-sdk",
    "@tutti/ai-assistant-service",
    "@tutti/ai-assistant-react",
    "@tutti/brand-review-react",
    "@tutti/creator-feedback-react"
  ]
};

export default nextConfig;
```

Tiptap / ProseMirror 版本必须与共享契约一致，当前为 `3.27.1`。不要在宿主项目里复制一份独立 `schema.ts`。

## 4. 构造 AI Review 输入

最小的 doc draft 输入：

```ts
import type { DraftReviewInput } from "@tutti/draft-doc";

const input: DraftReviewInput = {
  draft: {
    postStateId: postState.id,
    draftKind: "doc",
    docJson: postState.docJson,
    docVersion: postState.docVersion
  },
  campaignBrief: {
    campaignId: campaign.id,
    name: campaign.name
  },
  campaignContext: campaignDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    sourceType: "proposal",
    text: document.text,
    url: document.url
  })),
  reviewHistory: reviewEvents,
  openComments,
  options: {
    language: "zh",
    maxInlineSuggestions: 6
  }
};
```

`campaignBrief` 至少提供 `campaignId`；完整 proposal、brand kit、发布规范等非结构化资料放进 `campaignContext`。

`docJsonToBlocks()` 返回的是序列化 plain-text offsets，不是 ProseMirror absolute positions。评论 anchor 必须使用 editor SDK 的 `quotedTextFromRange()` 或 Tiptap transaction position。

## 5. 接入服务端 AI route

API key 只能出现在服务端环境变量中：

```ts
import {
  reviewDraft,
  resolveProviderConfigFromEnv
} from "@tutti/ai-assistant-service";

export async function POST(request: Request) {
  const rawInput: unknown = await request.json();

  try {
    const proposal = await reviewDraft(rawInput, {
      providerConfig: resolveProviderConfigFromEnv(process.env)
    });
    return Response.json(proposal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI review failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
```

也可以注入自定义 `ModelAdapter`。当 `provider: "custom"` 时必须注入 adapter，不能只传 provider config。

## 6. 接入高亮 SDK

宿主 Tiptap editor / viewer 必须复用 `createDraftDocExtensions()`：

```tsx
import { createDraftDocExtensions } from "@tutti/draft-doc";
import {
  createCommentHighlightExtension,
  refreshCommentHighlights,
  scrollHighlightIntoView,
  type EditorHighlight
} from "@tutti/editor-highlight-sdk";

const highlightsRef = useRef<EditorHighlight[]>([]);
const selectedIdRef = useRef<string | null>(null);

const editor = useEditor({
  editable: false,
  extensions: [
    ...createDraftDocExtensions(),
    createCommentHighlightExtension({
      editable: false,
      getHighlights: () => highlightsRef.current,
      getSelectedId: () => selectedIdRef.current,
      onSelectHighlight: setSelectedId
    })
  ],
  content: input.draft.docJson
});

useEffect(() => {
  highlightsRef.current = highlights;
  selectedIdRef.current = selectedId;
  if (editor && !editor.isDestroyed) {
    refreshCommentHighlights(editor.view);
  }
}, [editor, highlights, selectedId]);
```

右侧 panel 选择某条建议后可滚动定位：

```ts
scrollHighlightIntoView(editor.view.dom, suggestionId);
```

AI 只返回 `quotedText` 时调用 `locateQuotedText()`；重复文本会返回 `ambiguous`，找不到会返回 `orphaned`。不要静默把歧义位置落库。

## 7. 接入 AI Assistant UI

```tsx
<AIAssistantPanel
  input={input}
  proposal={proposal}
  selectedSuggestionId={selectedSuggestionId}
  suggestionStatuses={suggestionStatuses}
  onRunReview={runReviewThroughServerRoute}
  onSelectSuggestion={selectAndScrollSuggestion}
  onApplySuggestion={applySuggestionThroughHost}
  onRejectSuggestion={rejectSuggestionThroughHost}
  onApplyAllSuggestions={applyAllThroughHost}
  onRejectAllSuggestions={rejectAllThroughHost}
/>
```

组件默认显示“运行 AI Review”入口。如果宿主页面已有统一 toolbar，可传 `showRunReviewAction={false}`。

Apply 的真实语义由宿主决定：修改 `doc_json`、创建 comment，或只更新本地 UI。组件不会自行持久化。

## 8. 接入品牌审核 UI

宿主负责从只读 viewer 捕获选区并保存 `selectedText` 与 ProseMirror anchor。把选区文本传给组件：

```tsx
<BrandReviewPanel
  status="reviewing"
  campaignName={campaign.name}
  draftVersion={draft.docVersion}
  feedbackDrafts={feedbackDrafts}
  selectedText={selectedText}
  selectedFeedbackId={selectedFeedbackId}
  canApprove={feedbackDrafts.length === 0}
  onCreateFeedback={createFeedbackDraft}
  onRemoveFeedback={removeFeedbackDraft}
  onSelectFeedback={selectAndScrollFeedback}
  onSendFeedback={persistFeedbackAndRequestChanges}
  onApproveDraft={approveThroughHostReviewEvent}
/>
```

`onCreateFeedback` 收到 `quotedText`、`action`、`body` 和可选 `suggestedText`。宿主必须补齐真实 comment id、anchor、author、timestamp 后再落库。

## 9. 接入创作者反馈 UI

```tsx
<CreatorFeedbackPanel
  comments={comments}
  selectedCommentId={selectedCommentId}
  canResolveManualComments={draftWasEdited}
  canResubmit={comments.every((comment) => comment.status === "resolved")}
  onSelectComment={selectAndScrollComment}
  onApplyComment={applyBrandReplacementThroughHost}
  onRejectComment={rejectBrandFeedbackThroughHost}
  onResolveComment={resolveCommentThroughHost}
  onReopenComment={reopenCommentThroughHost}
  onApplyAllComments={applyAllThroughHost}
  onResolveAllComments={resolveAllThroughHost}
  onResubmit={resubmitThroughHostReviewEvent}
/>
```

组件只调用 callbacks。所有 comment 状态与 resubmit workflow 仍由宿主控制。

## 10. 样式接入

组件输出稳定 class names，但当前版本尚未发布独立 CSS artifact。业务方拉源码接入时，以 `apps/demo-next/app/globals.css` 为视觉参考，把以下样式映射到宿主 design system：

- `.tutti-review-highlight*` / `.tutti-review-badge*`
- `.tutti-ai-panel*` / `.tutti-ai-card*`
- `.brand-review-*`
- `.creator-feedback-*`
- `.panel*` / `.comment-card*` / `.bulk-btn*` / `.mini-btn*`

不要直接覆盖宿主全局 button / textarea 样式。正式发布私有 npm 包前，应为三个 React 包和 highlight SDK 拆分独立 stylesheet entry。

## 11. 业务回调检查表

| 回调 | 宿主应执行 |
| --- | --- |
| `onRunReview` | 调用服务端 route，保存 proposal 到页面状态 |
| `onApplySuggestion` | 校验 doc version，再决定改文或建 comment |
| `onRejectSuggestion` | 记录处理状态，不改 `doc_json` |
| `onCreateFeedback` | 创建本地草稿或宿主临时记录 |
| `onSendFeedback` | 持久化 comments，并走 request changes 事件入口 |
| `onApproveDraft` | 走宿主 approve 事件入口 |
| `onResolveComment` | 保存 comment resolve 状态 |
| `onResubmit` | 保存新 doc version，并走 resubmit 事件入口 |

## 12. 验收标准

- 非法 `doc_json` 根节点返回可解释的 400，不进入模型调用。
- AI proposal 的 `analyzedDocVersion` 与当前版本不一致时显示 stale。
- 高亮只存在于 decorations，序列化后的 `doc_json` 不含 highlight mark。
- editable editor 中点击正文仍可正常放置 caret。
- 品牌和创作者组件的所有业务动作均进入宿主 callback。
- 浏览器 bundle 中不存在 LLM API key。
- 刷新页面后，持久化结果来自宿主后端，而不是 Demo React state。

可直接执行的接入任务说明见 [BUSINESS_INTEGRATION_PROMPT.md](./BUSINESS_INTEGRATION_PROMPT.md)。
