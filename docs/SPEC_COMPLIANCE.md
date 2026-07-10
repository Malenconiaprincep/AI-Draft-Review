# OpenSpec 对照结果

对照来源：

- `openspec/project.md`
- `openspec/changes/decouple-ai-draft-review-sdk/proposal.md`
- `openspec/changes/decouple-ai-draft-review-sdk/design.md`
- `openspec/changes/decouple-ai-draft-review-sdk/specs/ai-draft-review-integration/spec.md`

## 结论

核心架构和宿主边界已经符合 P0 spec；源码 workspace 方式可以用于业务接入。当前还不能宣称“私有 npm 制品交付完成”，因为包仍直接导出 TypeScript 源码，且独立样式制品和完整组件测试尚未完成。

## 符合项

| Spec 能力 | 状态 | 代码位置 |
| --- | --- | --- |
| 六个复用包 + 一个 Demo | 符合 | `packages/*`、`apps/demo-next` |
| 共享 DraftDocJSON / Tiptap schema | 符合 | `packages/draft-doc` |
| `doc_json` 结构化运行时校验 | 符合 | `packages/ai-assistant-service/src/schema.ts` |
| decoration-only 高亮 | 符合 | `packages/editor-highlight-sdk/src/decorations.ts` |
| quotedText 定位、歧义、orphan、anchor remap | 符合 | `packages/editor-highlight-sdk/src/anchors.ts` |
| editable 模式不拦截正文 caret | 符合 | `packages/editor-highlight-sdk/src/tiptap-extension.ts` |
| panel → 高亮定位 / 滚动 API | 符合 | `packages/editor-highlight-sdk/src/navigation.ts` |
| 无状态 AI service + provider 注入 | 符合 | `packages/ai-assistant-service` |
| DeepSeek 优先、Minimax / OpenAI-compatible 兼容 | 符合 | `model-adapter.ts` |
| custom provider 必须注入 adapter | 符合 | `createModelAdapterForProvider()` |
| AI UI apply / reject / bulk callbacks | 符合 | `packages/ai-assistant-react` |
| Brand UI create / remove / send / approve callbacks | 符合 | `packages/brand-review-react` |
| Creator UI filter / apply / reject / reopen / bulk / resubmit callbacks | 符合 | `packages/creator-feedback-react` |
| stale doc version 提示 | 符合 | `AIAssistantPanel` / `useAIAssistant` |
| Demo 不依赖生产 DB | 符合 | `apps/demo-next` |

## 已知差距与处理建议

### 1. 私有 npm 发布链路尚未完成

当前 `package.json` 使用 `private: true`，并直接导出 `src/index.ts`。这适合拉代码后的 workspace 集成，不适合直接发布 registry。

正式发布前需要：

- 为每个包生成 JS + `.d.ts` 的 `dist`。
- 把 exports 切换到 `dist`。
- 增加 `files`、publish config、版本和 changelog。
- 在干净消费项目中执行 pack / install smoke test。

### 2. 样式仍由 Demo 提供

React 包公开了组件和稳定 class names，但没有独立 CSS export。业务接入可先映射 `apps/demo-next/app/globals.css`；正式 npm 交付前应拆分 stylesheet entry。

### 3. 自动化测试覆盖还不完整

已有 Demo 逻辑测试和 service schema 测试，但 spec 要求的 component callback、anchor locate/remap、stale UI 和完整 Demo integration tests 仍需补齐。

### 4. Demo 含 P0 以外的可选展示

Revision diff 是 Demo / BrandReviewPanel 的可选扩展，不应被业务方理解为 P0 必须能力，也不应改变宿主状态机边界。

### 5. 纯文本 offset 与 ProseMirror position 必须区分

`docJsonToBlocks()` / `quotedTextFromDocRange()` 使用 plain-text serialization offsets。生产 comment anchor 必须使用 editor SDK 的 ProseMirror position API。

### 6. Lint 工具链尚未补齐

仓库已有 `lint` script，但当前未安装 ESLint，因此交付验证以 typecheck、tests 和 production build 为准。正式 CI 接入前应补齐 ESLint 配置并恢复 lint gate。

## 交付判断

- 拉代码进行 monorepo 源码接入：可以。
- 接入现有宿主 API / 权限 / 状态机：接口边界已具备。
- 直接发布并安装私有 npm 包：尚需 dist / CSS / pack smoke test。
- 宣称所有 OpenSpec tasks 完成：暂不可以，主要缺发布链路和测试覆盖。
