# 给业务接入同学的 Codex Prompt

使用方式：把 AI Draft Review 仓库和目标业务仓库拉到本地，在目标业务仓库打开 Codex，然后完整粘贴下面的 prompt。无需复制 Demo 页面代码。

```text
请把本地 AI Draft Review 能力接入当前业务仓库。你需要自主定位包含以下包的源码仓库：

- @tutti/draft-doc
- @tutti/editor-highlight-sdk
- @tutti/ai-assistant-service
- @tutti/ai-assistant-react
- @tutti/brand-review-react
- @tutti/creator-feedback-react

开始修改前必须完整阅读能力仓库中的：

- docs/INTEGRATION_GUIDE.md
- docs/SPEC_COMPLIANCE.md
- openspec/project.md
- openspec/changes/decouple-ai-draft-review-sdk/specs/ai-draft-review-integration/spec.md

目标：在当前宿主系统中接入 AI 自查、编辑器高亮、品牌审核反馈和创作者反馈处理，同时保留宿主现有权限、数据库和审核状态机。

执行要求：

1. 先检查当前仓库的框架、workspace/package manager、Tiptap schema、draft 数据类型、评论 API、审核事件入口、权限判断和目标页面。输出一份“宿主字段/API → Draft Review contract”的映射，再开始实现。
2. 优先以 workspace 源码包方式接入六个包；不要复制并维护第二份 draft schema。Tiptap / ProseMirror 版本必须与 @tutti/draft-doc 的 3.27.1 契约一致。
3. 如果是 Next.js 源码包接入，把六个包全部加入 transpilePackages。不要复制 apps/demo-next 的 routing 或本地 workflow state。
4. 在服务端创建 AI review route 或 server action：输入按 unknown 接收，调用 reviewDraft 做 runtime validation；provider config 和 API key 只从服务端环境读取。浏览器组件、client props 和日志中不得出现 raw API key。
5. 将宿主 draft、campaign、动态 proposal/brand kit、review history 和 open comments 映射为 DraftReviewInput。campaignBrief 至少传 campaignId，完整动态资料放 campaignContext。
6. 在宿主 Tiptap editor/viewer 安装 createDraftDocExtensions 和 createCommentHighlightExtension。高亮只使用 decorations，不能写入 doc_json。使用 getHighlights、getSelectedId 和 refreshCommentHighlights 刷新，不要因为 panel selection 重建 Editor。
7. AI suggestion 仅依赖 quotedText 时使用 locateQuotedText。ambiguous / orphaned 必须显示可人工处理的状态，不能静默选择错误位置落库。
8. 接入 AIAssistantPanel。所有 apply、reject、bulk action 都调用宿主 adapter。执行前校验 proposal.analyzedDocVersion 等于当前 docVersion；过期时要求重新 review。
9. 在品牌审核页面接入 BrandReviewPanel。捕获只读 viewer 的原生选区，保存 quotedText 和 ProseMirror anchor。create/remove 可以是页面草稿状态；send/approve 必须调用宿主现有评论 API 和审核事件入口。
10. 在创作者改稿页面接入 CreatorFeedbackPanel。apply/resolve/reopen/resubmit 必须调用宿主 API；组件本身不能直接更新审核状态。
11. 将能力组件 class names 映射到宿主 design system。可以参考 apps/demo-next/app/globals.css，但不要把 Demo 的全局 button/textarea 规则原样覆盖到业务应用。
12. 不实现或替换宿主登录、权限、通知、发布、数据库、完整编辑器保存系统。不要引入 Google Docs/Notion import 或 X/Typefully publish adapter。
13. 如果缺少评论 API、审核事件入口、权限规则或 draft schema 信息，不要猜数据库写法。先完成 typed adapter 和无副作用 UI 接入，把精确缺失项列为 blocker，并告诉我需要业务方提供什么。
14. 增加测试，至少覆盖：非法 doc_json 拒绝、doc/url 必填关系、stale docVersion、quotedText locate/orphan/ambiguous、component callbacks、editable caret 不被高亮拦截。
15. 完成后运行仓库现有 typecheck、tests、lint/build（按项目可用命令），修复由本次改动造成的问题。

必须保持的不变量：

- AI service、React components 和 highlight SDK 不直连生产数据库。
- AI assistant、品牌审核端和 highlight SDK 不修改 doc_json。
- 只有创作者侧宿主 callback 可以保存 doc_json，并负责 docVersion 递增。
- approve/request changes/reject/resubmit 只走宿主统一审核事件入口。
- AI proposal 必须保留 analyzedDocVersion，并在确认动作前检查是否 stale。
- 组件动作全部通过显式 props/callbacks，不能依赖 Demo 全局状态。

最终交付请包含：

1. 已修改文件清单。
2. 宿主字段/API 映射表。
3. 六个包分别接入到哪个页面/服务。
4. 所有持久化 callback 的实现位置。
5. 环境变量清单（只写变量名，不输出值）。
6. 测试和构建结果。
7. 尚未完成的 blocker、风险和上线前检查项。
```
