# Tutti AI Draft Review

这是一个解耦版 AI 草稿审阅最小交付，实现范围固定为：

```text
@tutti/draft-doc
@tutti/editor-highlight-sdk
@tutti/ai-assistant-service
@tutti/ai-assistant-react
@tutti/brand-review-react
@tutti/creator-feedback-react
apps/demo-next
```

Demo app 使用本地 fixture 和 React state 演示组件 callbacks。生产环境里的数据、权限、落库和审核状态流转都归宿主系统负责。

## 业务接入文档

- [业务接入指南](docs/INTEGRATION_GUIDE.md)
- [OpenSpec 对照结果](docs/SPEC_COMPLIANCE.md)
- [可直接交给 Codex 的业务接入 Prompt](docs/BUSINESS_INTEGRATION_PROMPT.md)

当前推荐通过拉取源码后的 workspace 方式接入。六个包尚未生成私有 npm registry 所需的 `dist` 与独立样式制品，具体差距见 OpenSpec 对照结果。

## 包说明

### `@tutti/draft-doc`

共享 DraftDocJSON 契约包。

- Tiptap schema factory。
- 中文 demo fixtures。
- `docJsonToPlainText`。
- `docJsonToBlocks`。
- `applyInlineSuggestionToDraftDoc`，用于 demo 或宿主侧把 AI 建议应用到 DraftDocJSON。
- Review input / AI proposal 共享类型。

### `@tutti/editor-highlight-sdk`

编辑器 / viewer 高亮包。

- ProseMirror decoration builder。
- Tiptap `CommentHighlight` extension。
- `quotedText` 反查定位。
- anchor remap 工具。
- `open`、`resolved`、`stale`、`orphaned`、`recovered`、`ambiguous` 状态。

### `@tutti/ai-assistant-service`

服务端 AI 审稿包。

- `reviewDraft(input)`。
- Prompt builder。
- Runtime schema validation。
- DeepSeek model adapter。
- Minimax model adapter 保留兼容。
- 服务端 provider config / custom `ModelAdapter` 扩展点。

浏览器组件不能直接接收或传递 raw API key。

### `@tutti/ai-assistant-react`

可嵌入宿主系统的 React UI。

- `AIAssistantPanel`。
- `useAIAssistant`。
- 支持逐条应用、拒绝、批量应用、批量拒绝和撤销。
- 通过 props / callbacks 把确认动作交给宿主落库。

组件可以展示 AI verdict，但最终 approve / request changes / reject 仍由宿主系统处理。

### `@tutti/brand-review-react`

品牌方审核 Draft 的 React UI。

- `BrandReviewPanel`。
- 展示审核上下文、当前选区和待发送反馈。
- 支持基于选区创建评论或替换建议、删除反馈、发送反馈给创作者、通过 callbacks。
- 不直接写库，也不直接更新 `post_state.status`。

### `@tutti/creator-feedback-react`

创作者提交后处理品牌反馈的 React UI。

- `CreatorFeedbackPanel`。
- 展示品牌方 open / resolved comments。
- 支持全部 / 待处理 / 已处理筛选。
- 支持展开、应用、拒绝、重新打开、批量应用和再次提交 callbacks。
- 不直接写库，也不直接更新 `post_state.status`。

## Demo

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

Demo 的 AI Review 只走真实 LLM provider；没有配置 LLM key 时，API route 会返回配置错误。
页面里内置了几组 campaign context / creator draft 测试样例，可以直接点选后运行 AI Review。真实接入时，完整宣发计划、品牌工具包、发布规范等动态 proposal 应放进 `campaignContext`；`campaignBrief` 只是可选结构化摘要，不再是必填唯一依据。AI 建议处理完后，可以提交给品牌方，在品牌方审核台添加反馈或通过；反馈发送给创作者后，创作者可处理并再次提交。

要启用 DeepSeek，复制示例环境变量：

```bash
cp apps/demo-next/.env.example apps/demo-next/.env.local
```

然后填入：

```bash
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING=disabled
DEEPSEEK_MAX_TOKENS=1200
```

`DEEPSEEK_MODEL` 不填时，默认使用 `deepseek-v4-flash`。这是 DeepSeek 当前价格页里更便宜的模型；如果账号有赠送余额，会优先消耗赠送余额。`DEEPSEEK_THINKING=disabled` 适合这类结构化审稿任务，可以减少思考输出带来的 token 成本。`DEEPSEEK_BASE_URL` 默认是 `https://api.deepseek.com`，通常不用配置。

如果需要继续使用 Minimax，也仍然支持：

```bash
MINIMAX_API_KEY=...
MINIMAX_MODEL=...
MINIMAX_BASE_URL=...
```

Provider 优先级：DeepSeek > OpenAI-compatible > Minimax。

## 验证

```bash
npm run typecheck
npm --workspace demo-next run build
```

交付前这两个命令都应该通过。
