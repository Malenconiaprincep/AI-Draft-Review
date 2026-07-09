# Tasks: Decoupled AI Draft Review Integration Project

## 0. Minimum Delivery Gate

- [ ] 只交付 `@tutti/draft-doc`、`@tutti/editor-highlight-sdk`、`@tutti/ai-assistant-service`、`@tutti/ai-assistant-react`、`@tutti/brand-review-react`、`@tutti/creator-feedback-react` 和 `apps/demo-next`。
- [ ] 不实现 Google Docs / Notion import adapter。
- [ ] 不实现 Typefully-like publish adapter。
- [ ] 不实现完整创作者端编辑器保存系统。
- [ ] 不实现完整品牌审核后台、权限系统或状态机。
- [ ] 不接入生产数据库、权限系统或审核状态机。

## 1. Project Setup

- [ ] 初始化 Next.js 项目，确认使用 App Router、TypeScript 和基础 lint / test 配置。
- [ ] 建立 package-first 工作区：draft-doc、editor highlight SDK、AI assistant service、AI assistant React component、brand review React component、creator feedback React component、demo app。
- [ ] 配置私有 npm 包导出方式，优先支持后续 brand-admin / tutti-web 直接安装接入。
- [ ] 引入并锁定 Tiptap / ProseMirror 相关依赖版本，确保与 `doc_json` 契约一致。
- [ ] 准备 demo fixtures：draft doc、campaign brief、review history、open comments。
- [ ] 准备 demo-only React state，用于演示已处理 suggestion、品牌反馈草稿和提交后流程状态。

## 2. DraftDocJSON Contract Package

- [ ] 创建 `@tutti/draft-doc` 私有包。
- [ ] 迁移 `draft-doc/schema.ts` 到 `@tutti/draft-doc`。
- [ ] 导出 Tiptap extension factory，确保 tutti-web、brand-admin 和 demo 使用同一 schema。
- [ ] 导出 fixture 样例。
- [ ] 导出 `docJsonToPlainText`。
- [ ] 导出 `docJsonToBlocks`。
- [ ] 评估 stable `blockId`：v1 不强依赖；如果要加，必须通过该包做语义化版本升级和迁移说明。
- [ ] 定义 `DraftReviewInput` schema。
- [ ] 支持 `campaignContext` 动态资料源输入，允许完整 proposal / brand kit / 发布规范直接进入 prompt。
- [ ] 定义 `ReviewProposal` schema。
- [ ] 定义 `InlineSuggestionProposal` schema。
- [ ] 定义 `DraftCommentThread` / `ReviewHistoryEvent` schema。
- [ ] 增加 runtime validation，非法输入和非法 AI 输出必须可解释失败。
- [ ] 编写 contract README，说明宿主需要提供哪些字段。

## 3. Editor Highlight SDK

- [ ] 实现 `EditorHighlight` 数据结构。
- [ ] 实现 `quotedTextFromRange`。
- [ ] 实现 `locateQuotedText`，支持 preferred position + 文本回退。
- [ ] 实现 `remapAnchor`，区间坍缩时返回 orphan 状态。
- [ ] 支持 AI service 只给 `quotedText` 时，在前端 / viewer 中反查定位。
- [ ] 支持重复 `quotedText` 的人工确认 / 歧义提示状态。
- [ ] 实现 ProseMirror Decoration builder。
- [ ] 实现 Tiptap `CommentHighlight` extension。
- [ ] 支持 AI suggestion 和 brand comment 两种来源样式。
- [ ] 支持 open / resolved / stale / orphaned 状态。
- [ ] 可编辑模式下高亮文本不拦截 caret。
- [ ] 只读模式下高亮可以作为定位热区。
- [ ] 编写 SDK 使用示例。

## 4. AI Assistant Service

- [ ] 实现 `reviewDraft(input)` service function。
- [ ] 实现 Next.js route：`POST /api/ai-assistant/review`。
- [ ] 实现 `doc_json` 到 plain text 的 prompt serialization。
- [ ] 实现 prompt builder，包含 draft、brief、history、open comments、review rules 和 output schema。
- [ ] 实现 DeepSeek model adapter，作为第一版优先真实 provider。
- [ ] 保留 Minimax model adapter 兼容。
- [ ] 预留 `ModelAdapter` 注入点。
- [ ] 支持服务端配置 provider / model / API key / baseUrl。
- [ ] 禁止浏览器组件直接传递或暴露 raw API key。
- [ ] 要求 AI inline suggestion 输出 `quotedText`，不要求输出 ProseMirror position。
- [ ] 校验模型输出，丢弃或返回可解释错误而不是让 UI 崩溃。
- [ ] 输出 `analyzedDocVersion`。
- [ ] 明确 service 不写库、不改状态、不改 `doc_json`。

## 5. AI Assistant Component

- [ ] 实现 `AIAssistantPanel`。
- [ ] 实现 `useAIAssistant` hook。
- [ ] 支持 idle / reviewing / ready / error / stale 状态。
- [ ] 展示 inline suggestions、category、evidence、处理状态。
- [ ] suggestion 点击触发 `onSelectSuggestion`。
- [ ] 支持 apply / reject / apply all / reject all / undo 的宿主回调接入。
- [ ] 支持 dismiss suggestion 的本地状态。
- [ ] 组件不直接依赖宿主后端、权限和数据库。

## 6. Brand Review Component

- [ ] 创建 `@tutti/brand-review-react` 私有包。
- [ ] 实现 `BrandReviewPanel`。
- [ ] 支持审核上下文、当前选区和待发送反馈展示。
- [ ] 支持基于选区创建评论或替换建议、删除反馈、发送反馈给创作者和通过回调。
- [ ] 支持反馈卡片选择和正文高亮联动。
- [ ] 组件不直接依赖宿主后端、权限、数据库或审核状态机。

## 7. Creator Feedback Component

- [ ] 创建 `@tutti/creator-feedback-react` 私有包。
- [ ] 实现 `CreatorFeedbackPanel`。
- [ ] 支持品牌反馈 open / resolved 筛选。
- [ ] 支持反馈卡片展开、选择和正文高亮联动。
- [ ] 支持单条应用、拒绝、重新打开、批量应用和再次提交回调。
- [ ] 组件不直接依赖宿主后端、权限、数据库或审核状态机。

## 8. Demo Integration

- [ ] 实现 demo review page。
- [ ] 渲染只读 Tiptap viewer。
- [ ] 接入 editor highlight SDK。
- [ ] 嵌入 AI assistant panel。
- [ ] 嵌入 brand review panel。
- [ ] 嵌入 creator feedback panel。
- [ ] 点击 Run Review 调用 service route。
- [ ] proposal 返回后渲染高亮和 panel 列表。
- [ ] panel suggestion 与正文高亮联动。
- [ ] AI 建议处理完成后支持提交品牌方。
- [ ] 提交后支持品牌方审核台添加反馈或通过。
- [ ] 品牌方发送反馈后切回创作者反馈处理。
- [ ] 品牌反馈与正文高亮联动。
- [ ] 品牌反馈全部处理后支持再次提交。
- [ ] 当 fixture `docVersion` 改变时展示 stale 状态。

## 9. Tests

- [ ] 覆盖 schema validation 测试。
- [ ] 覆盖 plain text serialization 测试。
- [ ] 覆盖 anchor extraction / locate / remap 测试。
- [ ] 覆盖 quotedText-only AI suggestion 的定位测试。
- [ ] 覆盖 component ready / error / stale 状态测试。
- [ ] 覆盖 brand review component 添加、删除、发送和通过状态测试。
- [ ] 覆盖 creator feedback component 筛选和处理状态测试。
- [ ] 覆盖 demo 级 run review + highlight render 测试。

## 10. Documentation

- [ ] 写 integration README。
- [ ] 写 host responsibility vs module responsibility。
- [ ] 写 demo React state 与生产宿主数据的边界说明。
- [ ] 写 `@tutti/draft-doc` 共享契约说明。
- [ ] 写 DeepSeek provider 配置、Minimax 兼容配置和外部 model adapter 接入说明。
- [ ] 写 service API request / response 示例。
- [ ] 写 component props / callbacks 文档。
- [ ] 写 brand review component props / callbacks 文档。
- [ ] 写 creator feedback component props / callbacks 文档。
- [ ] 写 SDK API 文档。
- [ ] 写 demo runbook。
- [ ] 写不变量：不写 `doc_json`、不直连 DB、不直接变更审核状态。

## 11. Acceptance Criteria

- [ ] 使用 fixture 可以完整演示：加载 draft、运行 AI review、展示 proposal、渲染行内高亮、点击 panel 定位高亮、处理 suggestion、提交品牌方、接收品牌反馈、处理反馈、再次提交。
- [ ] service 在没有生产数据库的情况下可以运行。
- [ ] 配置 DeepSeek key 后可以走真实 provider。
- [ ] component 可以通过 props 和 callbacks 独立接入任意宿主页面。
- [ ] creator feedback component 可以通过 props 和 callbacks 独立接入创作者端。
- [ ] editor highlight SDK 不修改 `doc_json`。
- [ ] AI service 可以只返回 `quotedText`，前端 SDK 能完成定位或给出 orphan / ambiguous 状态。
- [ ] AI response 携带 `analyzedDocVersion`，docVersion 不一致时 UI 显示 stale。
- [ ] 文档能让外部开发者在不接触主代码库和生产数据库的情况下完成集成 demo。
