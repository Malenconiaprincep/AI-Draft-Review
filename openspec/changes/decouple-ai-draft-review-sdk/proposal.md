# Change Proposal: Decoupled AI Draft Review Integration Project

## Summary

把原先偏完整双端 prototype 的方案收敛为一个可演示、可接入、边界清晰的 Next.js 项目，第一版交付六块可复用能力：

1. Shared DraftDocJSON contract package：把 `draft-doc/schema.ts`、fixtures 和类型抽成私有 npm 包，例如 `@tutti/draft-doc`。
2. 编辑器高亮 SDK：基于 Tiptap / ProseMirror 文档和评论锚点渲染高亮，不写入 `doc_json`。
3. AI Assistant Service：无状态 AI 审稿服务，接收宿主系统提供的显式 JSON，返回结构化 review proposal。
4. AI Assistant Component：可嵌入宿主系统的 React 组件，用于触发 AI Review、展示行内建议，并通过回调交给宿主处理 apply / reject。
5. Brand Review Component：可嵌入品牌方审核台的 React 组件，用于审核 Draft、添加反馈、发送反馈给创作者或通过，并通过回调交给宿主落库和变更状态。
6. Creator Feedback Component：可嵌入创作者端的 React 组件，用于展示品牌方反馈、处理反馈、再次提交前的本地状态联动，并通过回调交给宿主落库。

Next.js 项目本身作为 demo shell 和接入样例，不承担生产系统的权限、数据库、审核状态机、创作者编辑器保存或真实发布流程。Demo 阶段使用本地 fixture 和 React state 跑通提交、品牌审核、品牌反馈、创作者处理反馈、再次提交的交互闭环；生产接入阶段所有持久化数据、权限校验和审核状态变更均由宿主系统提供。

## Why

昨天版本的 prototype 范围包括创作者端、品牌方端和完整审核流，演示闭环完整，但接入边界偏大。当前更合理的第一版是把能力做成后续系统可集成的模块：

- 主系统已经有 draft 数据结构、审核状态机、评论表和写库入口。
- 真正需要跨 repo 共享的契约是 DraftDocJSON，而不是数据库表；把 `draft-doc/schema.ts` 从“两边各放一份”升级为私有 npm 包，可以避免 schema 手工同步。
- AI assistant 不应该直接连库，也不应该直接改 `doc_json` 或审核状态。
- 高亮能力应该从评论 / AI 建议派生，作为 editor decoration / viewer decoration，而不是写进文档本体。
- AI service 不需要在服务端运行 ProseMirror 来计算位置；行内建议先输出 `quoted_text` / `quotedText`，宿主或前端 SDK 再反查定位。
- React 组件应该依赖显式 props 和 callback，方便品牌后台、审核详情页或未来其他系统接入。
- 提交后的创作者反馈处理也应通过可复用组件接入，避免 demo-only UI 和未来 tutti-web 创作者端重复实现。
- 品牌方审核操作也应通过可复用组件接入，避免 demo-only 按钮和未来 brand-admin 审核台重复实现。
- Next.js demo 需要保证演示完整性，但不能把 demo 内部 workflow state 误设计成生产边界。

## Goals

- 创建一个 Next.js 项目，作为集成 demo、开发环境和模块导出载体。
- 抽出 `@tutti/draft-doc` 私有 npm 包，包含 DraftDocJSON schema、Tiptap extension list、fixtures、serializer 和基础类型。
- 定义共享 TypeScript schema，覆盖 draft 输入、campaign brief、review history、open comments、AI review proposal、inline suggestions、highlight anchors。
- 实现编辑器高亮 SDK：
  - 兼容现有 `doc_json` 契约。
  - 使用 ProseMirror absolute position 渲染高亮。
  - 支持 `quoted_text` 回退和 orphan comment 展示。
  - 不修改文档内容。
- 实现 AI Assistant Service：
  - 无状态，不直连生产数据库。
  - 输入输出均为显式 JSON。
  - 使用 prompt + proposal 结构：prompt 负责审稿上下文，proposal 负责结构化输出。
  - 第一版优先支持 DeepSeek provider。
  - Minimax provider 保留兼容。
  - provider、model 和 API key 通过服务端配置 / adapter 注入，后续允许接入方替换模型。
  - 行内建议输出 `quotedText`，不要求服务端输出 ProseMirror anchor。
  - 返回结果携带分析时的 `doc_version`，便于宿主做过期校验。
- 实现 AI Assistant Component：
  - 可独立嵌入宿主页面。
  - 不内置宿主业务写库逻辑。
  - 通过 callbacks 请求宿主 apply / reject AI suggestion。
- 实现 Creator Feedback Component：
  - 可独立嵌入创作者端。
  - 展示品牌方 open / resolved comments。
  - 支持筛选、展开、应用、拒绝、重新打开、批量应用和再次提交回调。
  - 不内置评论持久化、审核事件写入或真实发布逻辑。
- 实现 Brand Review Component：
  - 可独立嵌入品牌方审核台。
  - 展示审核上下文、当前选区和待发送反馈。
  - 支持基于选区创建评论或替换建议、删除反馈、发送反馈给创作者和通过回调。
  - 不内置评论持久化、权限校验或审核状态机。
- 提供 fixture demo，验证从 draft viewer、AI review、行内高亮、assistant panel、提交、品牌反馈、创作者反馈处理到再提交的接入路径。
- Demo 本地数据使用 fixtures / React state；生产数据由宿主系统通过 props、API route 或 server-to-server request 提供。
- 输出清晰接入文档，说明宿主系统需要提供什么、组件 / service / SDK 返回什么。

## Non-Goals

- 不做完整创作者端编辑器保存系统。
- 不做完整品牌方审核工作台。
- 不直接实现生产数据库读写。
- 不直接调用 `appendReviewEvent` 或更新 `post_state.status`。
- 不做生产权限、登录、团队协作、通知系统。
- 不做自动发布、Typefully 发布或 X/Twitter 发布。
- 不做图片 OCR / 视频理解 / 视觉一致性检查；第一版只把图片、视频作为文档节点和可提示的素材风险。
- 不做 fine-tune 或复杂知识库后台。
- 不承诺多编辑器正式 SDK；第一版以 Tiptap / ProseMirror adapter 为主，同时保留扩展接口。
- 不把导入 Google Docs / Notion、Typefully 式发布转换纳入第一版交付；这些后续可以作为同一 DraftDocJSON 契约上的纯 adapter 扩展。

## Deliverables

最小交付物：

```text
@tutti/draft-doc
@tutti/editor-highlight-sdk
@tutti/ai-assistant-service
@tutti/ai-assistant-react
@tutti/brand-review-react
@tutti/creator-feedback-react
apps/demo-next
```

建议项目结构：

```text
apps/demo-next/
  app/
  fixtures/
  app/api/ai-assistant/review/route.ts
packages/draft-doc/
  src/schema.ts
  src/fixtures.ts
  src/serializers.ts
  src/types.ts
packages/editor-highlight-sdk/
  src/index.ts
  src/tiptap-extension.ts
  src/anchors.ts
packages/ai-assistant-service/
  src/index.ts
  src/prompt.ts
  src/schema.ts
  src/model-adapter.ts
packages/ai-assistant-react/
  src/AIAssistantPanel.tsx
  src/useAIAssistant.ts
packages/brand-review-react/
  src/BrandReviewPanel.tsx
packages/creator-feedback-react/
  src/CreatorFeedbackPanel.tsx
```

为了后续别人接入方便，第一版按 package-first 组织，优先交付私有 npm 包而不是 app-local `src/modules`。Next.js demo 依赖这些包，就像未来的 brand-admin / tutti-web 一样接入。

建议包名：

- `@tutti/draft-doc`
- `@tutti/editor-highlight-sdk`
- `@tutti/ai-assistant-service`
- `@tutti/ai-assistant-react`
- `@tutti/brand-review-react`
- `@tutti/creator-feedback-react`

## MVP Scope

P0 只完成最小交付：

- `@tutti/draft-doc`：共享 DraftDocJSON 契约、schema、fixtures、plain text / blocks serializer。
- `@tutti/editor-highlight-sdk`：基于现有 Tiptap / ProseMirror schema 的高亮、定位、orphan / stale / ambiguous 状态。
- `@tutti/ai-assistant-service`：`reviewDraft(input)`、prompt builder、schema validation、DeepSeek adapter、Minimax adapter、OpenAI-compatible provider adapter 接口。
- `@tutti/ai-assistant-react`：`AIAssistantPanel`、`useAIAssistant`、props / callbacks 接入边界。
- `@tutti/brand-review-react`：`BrandReviewPanel`、选区操作、评论 / 替换反馈草稿、发送反馈、通过 callbacks。
- `@tutti/creator-feedback-react`：`CreatorFeedbackPanel`、品牌反馈列表、筛选、应用 / 拒绝、再次提交 callbacks。
- `apps/demo-next`：fixture + React state 跑通加载 draft、运行 AI review、展示高亮、处理 AI suggestion、提交、品牌方审核、发送反馈、处理反馈、再次提交。

P0 不做：

- Google Docs / Notion import adapter。
- Typefully-like publish adapter。
- 完整创作者端编辑器保存系统。
- 完整品牌审核后台、权限和状态机。
- 生产数据库、权限、审核状态机接入。

## Integration Boundary

宿主系统负责：

- 获取 `doc_json`、`doc_version`、`draft_kind`、可选 `campaignBrief`、动态 `campaignContext`、`reviewHistory`、`openComments`。
- 校验当前用户权限。
- 保存评论、评论消息、resolve 状态。
- 执行审核状态变更：统一走宿主的 append review event 入口。
- 校验 AI 结果的 `doc_version` 是否过期。
- 在生产环境提供 LLM provider 配置；当前优先使用 DeepSeek，Minimax 保留兼容。

本项目负责：

- 从显式输入生成 AI review proposal。
- 在编辑器 / viewer 中渲染 comment 和 suggestion 高亮。
- 提供 assistant UI 组件和交互状态。
- 提供 brand review UI 组件和审核操作回调。
- 提供 creator feedback UI 组件和提交后处理状态。
- 通过 callbacks 把用户确认后的动作交还给宿主。
- 提供 demo fixtures、提交后流程样例和接入示例。

## Decisions

- **Package strategy**: 使用 package-first / 私有 npm 包方式，优先保证外部接入便利性。
- **Draft contract**: `@tutti/draft-doc` 是第一共享契约，tutti-web、brand-admin 和外部协作项目都依赖它。
- **LLM provider**: 第一版优先 DeepSeek，Minimax 保留兼容；同时提供 `ModelAdapter` / server-side config，后续允许接入方传入 provider、model 和 API key。API key 不应从浏览器组件直接传入。
- **AI suggestion anchoring**: AI service 输出 `quotedText`，不强制输出 `anchor_from` / `anchor_to`。前端 SDK 或宿主基于 DraftDocJSON 反查定位并创建真实 comment anchor。
- **Block identity**: 第一版不依赖 `blockId`。建议后续通过 `@tutti/draft-doc` 引入稳定 block id，并配合语义化版本和迁移策略；如果宿主当前没有，不能阻塞第一版。
- **Demo data**: 本地 fixture / React state 仅用于演示和联调，生产数据持久化归宿主。
- **Review decision**: AI Assistant Component 可以展示 AI verdict，但不直接提交 approve / request changes / reject；最终审核动作仍由宿主系统处理。
- **Submit workflow demo**: Demo 提供品牌审核操作面板跑通提交、品牌反馈、再提交和发布路径，但所有真实审核状态变更仍由宿主系统处理。

## Risks

- ProseMirror position 对 schema 和 extension 列表敏感，必须锁定和宿主一致的 draft schema。
- AI 输出可能缺字段或错误定位，必须做 schema validation 和 quoted text fallback。
- `quotedText` 在正文中重复出现时可能定位不唯一；第一版由 UI 提示人工确认，后续通过 blockId / text fingerprint 增强。
- 宿主编辑器如果在 AI 分析后保存了新版本，旧 proposal 必须标记 stale。
- Demo 为了完整性会包含本地状态，但文档必须明确它不代表生产写库或状态机边界。

## Open Questions

- 当前无阻塞性 open question。后续实现前只需要确认私有 npm 发布方式。
