# Project: Tutti AI Draft Review Integration

## Purpose

本项目用于把 Tutti draft 审稿能力拆成可演示、可集成、可复用的模块，服务后续系统接入。

当前第一版不重建完整审核系统，只围绕以下能力：

- Shared DraftDocJSON contract package
- Editor Highlight SDK
- AI Assistant Service
- AI Assistant React Component
- Brand Review React Component
- Creator Feedback React Component
- Next.js integration demo

## Minimum Delivery

第一版最小交付物固定为：

```text
@tutti/draft-doc
@tutti/editor-highlight-sdk
@tutti/ai-assistant-service
@tutti/ai-assistant-react
@tutti/brand-review-react
@tutti/creator-feedback-react
apps/demo-next
```

除非后续 OpenSpec change 明确扩展范围，否则不增加导入 adapter、发布 adapter、完整品牌审核后台、完整创作者端编辑系统或真实提交/发布后端。品牌审核只交付可嵌入的操作面板，不拥有生产状态机。

## System Context

Tutti 是连接品牌和 X / Twitter 创作者的内容投放平台。创作者提交 campaign draft，品牌方审核后 approve / reject / request changes。

主系统已有：

- draft 数据结构和 `doc_json`
- campaign brief
- review event 状态流水
- draft inline comments
- 审核状态变更入口

本项目只作为能力模块和接入样例，不拥有生产数据库和主审核状态机。

## Core Invariants

- `doc_json` 只有创作者端写入；AI assistant、品牌端和 highlight SDK 永远只读。
- 评论高亮必须由评论行或 AI suggestion 派生为 decoration，不写入文档本体。
- AI assistant service 必须是无状态模块，不直接连生产库。
- 审核状态变更必须由宿主系统统一入口处理。
- AI proposal 必须携带分析时的 `doc_version`。
- 宿主系统负责权限、取数、落库、状态变更和过期校验。
- Demo 阶段可以使用本地 fixture 和 demo-only React state 保证演示完整性；生产接入阶段所有持久化数据归宿主系统。
- AI service 输出行内建议时优先使用 `quoted_text` / `quotedText`，不要求服务端计算 ProseMirror position。

## Current Draft Contract

- Draft kind:
  - `url`: legacy external draft
  - `doc`: Tiptap / ProseMirror JSON in `doc_json`
- DraftDocJSON 应抽成私有 npm 包，例如 `@tutti/draft-doc`，由 tutti-web、brand-admin 和外部协作项目共同依赖。
- Tiptap packages should be pinned to `3.27.1` unless host contract changes.
- Comment anchors use ProseMirror absolute positions: `anchor_from` / `anchor_to`.
- `quoted_text` is required as fallback when anchors drift or become orphaned.
- Stable `blockId` can improve anchoring, but it should be introduced through the shared `@tutti/draft-doc` contract with semantic versioning and migration rules. First version must work without it.

## Technology Direction

- Next.js + TypeScript for demo and API route.
- Package-first delivery for integration: private npm packages are preferred over app-local `src/modules`.
- React component exported with prop / callback boundary.
- ProseMirror Decoration for editor / viewer highlights.
- Runtime schema validation for service inputs and model outputs.
- DeepSeek is the preferred real LLM provider for the first implementation.
- Minimax remains supported as a compatibility provider.
- Model provider / model name / API key must be configurable server-side so an integrator can provide their own model later.

## Documentation Style

- Specs should distinguish demo behavior from production responsibilities.
- Requirements should use explicit SHALL language.
- Every feature that touches host data must define whether it is module-owned or host-owned.
- Avoid adding production workflow scope unless a later change explicitly expands the boundary.
