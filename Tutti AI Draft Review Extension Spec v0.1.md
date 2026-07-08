# Tutti AI Draft Review Two-Sided Prototype Spec v0.1

## 0. 最终方案结论

第一版最终方案建议确定为：

> 交付两端 prototype：品牌方管理端负责审核 draft、给反馈、判定通过 / 不通过；创作者端负责写作、查看反馈、修改并再次提交。AI Review 作为两端共享的辅助审稿能力，不单独作为唯一交付物。

第一版的核心交付不是完整生产级审核系统，也不是模型训练系统，而是一套可以演示端到端协作闭环的 prototype：

1. 创作者在创作者端编写 draft
2. 创作者可先触发 AI Review 做提交前自查
3. 创作者提交 draft 给品牌方
4. 品牌方在管理端查看 draft、AI 预审结果和历史反馈参考
5. 品牌方添加批注、要求修改，或判定通过 / 不通过
6. 创作者端收到品牌方反馈
7. 创作者根据反馈修改 draft，逐条处理建议
8. 创作者再次提交，形成可迭代的审核闭环
9. 平台记录 suggestion、comment、decision 和处理状态

### 0.1 MVP 范围判定

MVP 应包含 P0 + P1：

- **P0：两端协作 Prototype**，使用 mock 数据验证品牌方管理端、创作者端、draft 提交、品牌方反馈、通过 / 不通过判定、创作者修改和再次提交。
- **P1：AI Review 增强版 Prototype**，接入真实 LLM Review，使用 campaign brief、历史反馈规则和 few-shot examples 生成结构化 suggestions，并增加 schema validate 和异常兜底。

SDK 化、生产级权限系统、图片 OCR / 视觉识别、相似内容检测、Fine-tune 和复杂知识库管理不进入第一版 MVP。

### 0.2 第一版必须坚持的产品原则

1. **两端闭环优先**：必须能演示品牌方反馈和创作者修改迭代，而不只是创作者单侧自查。
2. **AI 不自动改稿**：所有正文修改必须由创作者点击 Accept 或手动编辑后触发。
3. **品牌方最终判定优先**：AI suggestion 只能辅助审核，draft 是否通过由品牌方 decision 决定。
4. **高风险问题只 comment**：事实不确定、相似内容、发布流程、图片素材等问题第一版只提示，不自动 replace。
5. **结构化输出优先**：AI 和品牌方反馈都尽量沉淀为结构化 suggestion / comment / decision。
6. **锚点可恢复优先**：第一版使用 `from / to + quotedText`，如果现有文档已有稳定 `blockId`，必须同时带上 `blockId`。
7. **历史反馈先做规则和样例**：第一版不做 Fine-tune，把历史数据沉淀为 prompt rules、few-shot examples 和 review skills。
8. **Prototype 优先，SDK 后置**：第一版内部保留 adapter 边界，但不承诺对外稳定 SDK API。

### 0.3 第一版不做的内容

以下内容明确不进入第一版：

1. 生产级品牌方审核工作台
2. 复杂 comment thread / creator reply 协作流
3. 自动发布或发布拦截
4. 图片 OCR / 视觉一致性检查
5. Fine-tune 或模型训练
6. 移动端完整体验
7. 跨平台内容格式完整适配
8. 正式 SDK 包和多编辑器 adapter

## 1. 背景与目标

### 1.1 项目定位

在现有 Tiptap 编辑器和审核流程上扩展一套 AI Draft Review + Brand Review prototype。

核心目标是：

> 建立创作者端和品牌方管理端之间的 draft 审核闭环：创作者写作并提交 draft，品牌方审核并判定通过 / 不通过，双方围绕结构化 feedback 进行修改、迭代和记录；AI 基于 Campaign Brief、历史品牌反馈和审核规则提供预审建议，减少重复低级批注。

当前已有反馈数据集，包含品牌方对创作者初稿的逐条批注、创作者回改、解决状态等数据。数据集中包含 50 篇初稿、60 个批注线程、61 条品牌反馈，以及 286 条历史拒稿理由；数据点结构为"原文 → 被锚定片段 quoted_text → 品牌反馈 → 创作者回改 → 解决状态"。

**该能力后续可以沉淀为 Tutti 的 AI 审稿 Agent / Brand Review Assistant。**

### 1.2 业务目标

第一版的业务目标是：

> 减少品牌方重复低级批注，提高创作者初稿一次通过率，并把品牌方审核意见从群聊沟通沉淀到平台内。

围绕这一目标，第一版聚焦两件事：

1. 创作者提交前可以用 AI Review 发现明显问题。
2. 品牌方可以在管理端查看 draft、留下反馈，并明确判定通过 / 不通过。

这样既能减少"补导流 / 换链接 / 修格式"这类低层级批注，也能让品牌方和创作者围绕同一套结构化反馈闭环协作。

### 1.3 第一版边界

第一版是两端 prototype：

1. **创作者端**：基于 Tiptap 编辑器写作、AI Review、自查、查看品牌方反馈、修改 draft、再次提交。
2. **品牌方管理端**：查看待审核 draft、查看 AI 预审结果、添加反馈、判定通过 / 不通过。

AI Draft Review 作为其中一层能力：读取 draft 内容，结合 campaign brief 和历史品牌反馈生成结构化审核建议，在编辑器内高亮问题，并通过 Review Panel 支持创作者逐条 accept / reject。

### 1.4 核心闭环

第一版只做一条端到端的双端核心闭环：

1. 创作者在 Tiptap 中编写 draft
2. 创作者触发 AI Review，生成结构化 suggestions
3. 创作者可接受 / 拒绝 AI suggestions 并修改 draft
4. 创作者提交 draft 给品牌方
5. 品牌方在管理端审核 draft
6. 品牌方添加结构化 feedback / comment
7. 品牌方判定 approved / changes_requested / rejected
8. 创作者端展示品牌方反馈
9. 创作者修改后再次提交
10. 系统记录 review decision、suggestion 状态和迭代历史

## 2. 使用场景

### 2.1 创作者提交前自查

创作者写完 draft 后，点击 AI Review。

AI 根据当前 campaign 的要求，检查内容是否存在问题，例如：

1. 是否缺少品牌导流 / CTA
2. 是否使用了错误链接
3. 是否引用了过期活动信息
4. 是否产品名、模型名、规格写错
5. 是否内容方向不符合 brief
6. 是否内容太泛、太像资讯，不像真实测评
7. 是否格式有问题，比如空格、大小写、重复 bullet
8. 是否存在与本次 campaign 已有内容高度相似的问题
9. 是否存在未 approved 就发布的流程风险

### 2.2 品牌方历史反馈复用

历史数据里已有大量可复用的品牌反馈，比如"最后加下推荐导流""最后 link 换一下""活动已经结束，看最新 brief""内容偏资讯，不符合开发者测评主题""本次 campaign 已有多篇类似内容，这篇先不收"等。

这些反馈可以作为 AI Review 的参考样例和规则来源。第一版建议先把历史反馈总结成 prompt rules、few-shot examples 或 review skills，让 LLM 在审稿时参考这些经验生成结构化 suggestions；暂不直接用于模型训练 / Fine-tune。

### 2.3 品牌方管理端审核

品牌方进入管理端后，可以看到待审核 draft 列表。点击某篇 draft 后进入审核详情页：

1. 查看创作者提交的 draft 正文
2. 查看 campaign brief 和关键要求
3. 查看 AI Review 预审结果
4. 在正文片段上添加品牌方 feedback / comment
5. 选择审核结论：通过、需要修改、不通过
6. 将审核结果同步给创作者端

第一版品牌方管理端以 prototype 为目标，不做复杂权限、多人协同、审批流配置和完整 comment thread。

### 2.4 创作者根据品牌方反馈迭代

创作者端收到品牌方反馈后，可以在编辑器内查看被锚定的 feedback，定位到正文，修改内容，并再次提交给品牌方。

创作者可以对每条 feedback 标记：

1. 已修改
2. 不采纳
3. 需要确认

第一版可以先用轻量状态表达，不做完整聊天式沟通。

## 3. 第一版范围

### 3.1 In Scope

第一版包含：

1. Tiptap 编辑器内容读取
2. ProseMirror JSON → plain text / blocks 序列化
3. AI Review API 协议
4. ReviewSuggestion 数据结构
5. BrandFeedback / ReviewDecision 数据结构
6. 创作者端 Tiptap 写作页面
7. 创作者端 Review Panel / Feedback Panel
8. 文内 suggestion / feedback 高亮
9. Accept / Reject / Mark as fixed
10. 修改后回写 Tiptap 文档
11. 品牌方管理端 draft 列表
12. 品牌方管理端审核详情页
13. 品牌方添加 comment / feedback
14. 品牌方判定 approved / changes_requested / rejected
15. 用户操作结果和审核状态记录
16. 两端 prototype 使用说明

### 3.2 未来需求 / 后续能力

以下能力不进入第一版交付，但可以作为后续产品演进方向：

1. 完整版本历史
2. 自动发布
3. 复杂权限系统
4. 图片内容识别
5. 模型训练 / Fine-tune（难点 / 后续评估）
6. 全平台内容格式适配
7. 生产级品牌方工作台
8. 完整 comment thread / creator reply
9. 复杂知识库管理后台

其中图片相关问题，第一版可以先识别为 image_asset 类型 comment，但不做视觉识别。后续如果要处理图片中文字、画面内容、素材一致性等问题，再接入 OCR / 视觉检查能力。

### 3.3 第一版交付物

第一版交付物建议定义为：

1. 两端 Prototype Spec：说明第一版业务目标、产品边界、核心流程、数据结构、接口协议、验收标准和后续规划。
2. 创作者端 prototype：提供 Tiptap 写作、AI Review、Review Panel / Feedback Panel、正文高亮、Accept / Reject / Mark as fixed、修改后再次提交。
3. 品牌方管理端 prototype：提供 draft 列表、审核详情、AI 预审结果、品牌方 comment / feedback、approved / changes_requested / rejected 判定。
4. ReviewSuggestion schema：定义 AI 审稿建议的统一数据结构，包括问题类型、严重程度、锚点、建议文本、原因、依据来源和处理状态。
5. BrandFeedback / ReviewDecision schema：定义品牌方反馈和审核结论的数据结构。
6. AI Review API schema：定义前端调用 AI Review 服务时的 request / response 协议，明确 draft 内容、campaign brief、历史反馈和 suggestions 的传输格式。
7. Review workflow mock API：定义 draft 提交、品牌方反馈、审核判定、创作者再次提交的 mock API。
8. TiptapEditorAdapter 内部接口：封装 Tiptap 编辑器读取、定位、高亮和应用修改的能力，降低 prototype 与具体 editor 实现的耦合。
9. Prototype README：说明如何运行两端 prototype、如何验证核心流程和注意事项。

## 4. 产品方案

### 4.1 产品形态

第一版建议优先交付：

- **Tutti Draft Review 双端 Prototype**

即先提供创作者端和品牌方管理端两个 prototype，验证 draft 从创作、AI 自查、提交、品牌方审核、反馈、判定到创作者修改再提交的完整闭环。

后续再沉淀为：

- **Tutti AI Review Extension**
- **AI Draft Review SDK**

Extension / SDK 化不是第一版的主交付目标，而是 P3 阶段在两端闭环稳定后再拆分 core logic、adapter 和可复用 UI 组件。

整体结构：

```text
创作者端 Tiptap Editor
        ↓ 提交 draft
品牌方管理端 Review Console
        ↓ feedback / decision
创作者端 Feedback Panel
        ↓ 修改 / 再提交
审核迭代闭环

AI Review 作为辅助层：
Campaign Brief + Historical Feedback → AI Suggestions → 两端展示 / 复用
```

### 4.2 页面结构

第一版包含两个主要页面：

#### 4.2.1 创作者端

| 区域    | 内容                                             |
| ----- | ---------------------------------------------- |
| 顶部信息栏 | Campaign 信息 / Draft 状态 / AI Review / Submit 按钮 |
| 左侧编辑区 | Tiptap Editor，展示 draft 正文、文内高亮 AI suggestion 和品牌方 feedback、点击定位 |
| 右侧反馈区 | Review Panel / Feedback Panel，展示 AI 建议、品牌方反馈、处理状态、Accept / Reject / Mark as fixed 操作 |

状态补充：

- Draft 处于 `drafting` / `changes_requested` / `revised` 时，创作者端编辑区可编辑，可运行 AI Review，并展示 Review / Feedback Panel。
- Draft 进入 `approved` 后，品牌方已经确认内容可以发布，创作者端编辑区切为只读，隐藏 AI Review 入口和 Review / Feedback Panel，只保留最终发布动作。
- Draft 进入 `published` 后，创作者端继续保持只读，AI Review、AI suggestion 操作、品牌反馈操作均不再出现。

#### 4.2.2 品牌方管理端

| 区域 | 内容 |
| --- | --- |
| Draft 列表 | 待审核 / 需要修改 / 已通过 / 未通过 draft |
| 审核详情 | Draft 正文、Campaign Brief、AI Review 摘要、历史反馈参考 |
| 批注区 | 品牌方添加 comment / feedback，锚定正文片段 |
| 判定区 | Approved / Changes Requested / Rejected |


移动端或窄屏适配待讨论：如果第一版需要支持移动端或窄屏，Review Panel 可以降级为右侧抽屉或底部 Bottom Sheet。

### 4.3 Review / Feedback Panel 设计

创作者端右侧面板同时展示 AI suggestion 和品牌方 feedback。

每条 AI suggestion 展示：

1. 问题类型
2. 严重程度
3. 锚定原文 quotedText
4. AI 建议
5. 修改原因
6. 依据来源
7. Accept
8. Reject
9. 定位到原文

每条品牌方 feedback 展示：

1. 品牌方反馈内容
2. 锚定原文 quotedText
3. 问题类型
4. 严重程度
5. 创作者处理状态
6. Mark as fixed
7. Need clarification
8. 定位到原文

品牌方 feedback 的严重程度必须在卡片 meta 区域中显式展示，建议使用 `High / Medium / Low` 标签。默认排序规则为：

1. 未处理 feedback 优先于已处理 feedback
2. `High` 优先于 `Medium`
3. `Medium` 优先于 `Low`
4. 同级别保持创建顺序或当前业务排序

面板分组建议：

- High Priority
- Medium Priority
- Low Priority

也可以按 category 分组：

- 链接问题
- 品牌导流
- Brief 不符合
- 格式问题
- 内容质量
- 流程问题

#### 4.3.1 Prototype 交互决策

以下为 prototype 阶段已确认的前端交互规则，后续接入 Tiptap / ProseMirror 时需要保持一致：

1. **正文高亮与右侧卡片联动**
   - 点击正文中的编号 badge（如 `#1` / `B-1`）时，右侧自动切换到对应 tab，并展开对应 AI suggestion 或品牌 feedback。
   - 点击右侧卡片时，卡片自动展开，并可定位到正文锚点。
   - 鼠标 hover 到可点击的编号 badge、右侧卡片时显示 pointer 光标。

2. **可编辑正文中的高亮文本**
   - 在创作者可编辑状态下，点击高亮正文文本本身不触发右侧展开，避免打断编辑。
   - 高亮文本本身使用文本光标，点击后应把 caret 放到点击位置。
   - 只有编号 badge 作为联动热区。
   - 在品牌方只读审核详情中，整段高亮可以作为定位热区，因为该视图不承担正文编辑。

3. **品牌反馈优先展示**
   - 当品牌方打回并产生未处理 feedback 后，创作者从品牌方同步 / 切回创作者端时，默认打开“品牌反馈”tab，并选中第一条未处理 feedback。
   - Review Panel tab 上展示数量提示：AI tab 显示 pending AI suggestions 数量，品牌反馈 tab 显示未处理 feedback 数量。

4. **品牌确认后的发布态**
   - `approved` / `published` 阶段不再展示 AI Review 入口。
   - `approved` / `published` 阶段创作者正文只读。
   - `approved` / `published` 阶段右侧 Review / Feedback Panel 可以隐藏，避免出现 Apply / Reject / Undo 等不属于最终发布阶段的操作。
   - 最终发布不再被 pending AI suggestions 阻塞；品牌方确认后，发布流程以品牌 decision 为准。

5. **应用后的快捷键撤销**
   - Accept / Reject / Apply all / Reject all / 品牌建议文案 Apply 后，支持 `Ctrl+Z` / `Cmd+Z` 撤销最近一次应用级操作。
   - 即使焦点仍在正文编辑器中，刚执行完应用操作后的第一次 `Ctrl+Z` / `Cmd+Z` 应优先撤销应用级操作。
   - 如果用户在应用后继续手动输入，快捷键撤销应交还给编辑器原生 undo，避免误撤应用操作。

6. **批量处理与 toast**
   - AI suggestions 支持 `Apply all` / `Reject all`，只处理当前仍为 `pending` 的 suggestions。
   - 批量处理后需要生成单个应用级 undo snapshot，支持 toast Undo 与快捷键撤销。
   - 单条 Apply / Reject / 品牌建议文案 Apply 后，toast 中展示 Undo 操作。

7. **品牌反馈两种处理模式**
   - `direct_apply`：品牌方提供建议文案，创作者端展示 diff，可点击 Apply 直接替换正文并标记 resolved。
   - `manual_edit`：品牌方只提供评论方向，创作者需要先在正文中手动修改；系统通过 quotedText 是否仍存在来判断是否可点击“完成修改”。
   - `manual_edit` 未检测到正文变化时，“完成修改”按钮置灰，并提示先修改正文。
   - `Need clarification` 将 feedback 状态改为 `needs_clarification`。

8. **Revision 与 changes 对比**
   - 每次 Submit / Resubmit 记录一份 submission snapshot，包括 revision number、base revision 和 draft 内容。
   - 品牌方审核详情支持“对比 changes”，在当前 revision 与 base revision 之间展示 inline diff。
   - 默认展示当前稿；点击对比按钮后显示 `Revision N → Revision N+1` 的差异，再次点击回到当前稿。

9. **流程与日志反馈**
   - Prototype 顶部展示 workflow steps：写作 → 提交 → 品牌审核 → 反馈同步 → 修改 / 再提交 → 品牌方确认 → 发布。
   - 每次关键状态变化写入 activity timeline，便于演示两端状态同步。
   - Sidebar 展示 Draft 状态、pending AI suggestions 数量、pending brand feedback 数量。

### 4.4 状态流转

Draft 审核状态：

```text
drafting → submitted → in_review → approved
drafting → submitted → in_review → changes_requested → revised → submitted
drafting → submitted → in_review → rejected
```

Suggestion / feedback 状态：

```text
pending → accepted
pending → rejected
pending → resolved
pending → needs_clarification
```

具体规则：

- **replace / insert / delete**
  - Accept 后修改正文，并将状态改为 accepted
  - Reject 后不修改正文，并将状态改为 rejected
- **comment**
  - Accept 可以理解为"我知道了 / 已处理"，状态改为 accepted
  - Resolve 用于已经手动处理、或后续品牌方 comment thread 的关闭状态
- **brand feedback**
  - Mark as fixed 后状态改为 resolved
  - Need clarification 后状态改为 needs_clarification
  - 品牌方最终 decision 决定 draft 是否进入 approved / changes_requested / rejected
- **approved / published**
  - `approved` 表示品牌方已经确认内容可发布，创作者端进入最终发布前只读状态
  - `published` 表示创作者已完成最终发布
  - 这两个状态下不再运行 AI Review，也不再展示 AI suggestion / brand feedback 的处理操作

## 5. 数据与接口设计

### 5.1 Review Suggestion 分类

第一版建议把 AI 审稿问题分为以下类型：

```typescript
export type ReviewCategory =
  | "brand_cta" // 品牌导流 / 推荐缺失
  | "link_issue" // 链接错误 / 链接需要替换
  | "campaign_brief" // 不符合 campaign brief
  | "factual_error" // 产品名、规格、价格、活动信息错误
  | "format_issue" // 空格、大小写、排版、重复 bullet
  | "content_quality" // 内容太泛、太资讯、缺少真实体验
  | "similarity_risk" // 与本次 campaign 已有内容重复
  | "image_asset" // 图片问题，第一版只做文字提示
  | "publish_flow" // 未 approved 前发布等流程问题
  | "general_comment" // 其他建议
```

### 5.2 ReviewSuggestion 数据结构

```typescript
export type ReviewSuggestion = {
  id: string

  /**
   * 修改类型
   * comment: 只评论，不自动改正文
   * replace: 替换原文
   * insert: 插入新内容
   * delete: 删除内容
   */
  type: "comment" | "replace" | "insert" | "delete"

  /**
   * 问题分类
   */
  category: ReviewCategory

  /**
   * 严重程度
   */
  severity: "low" | "medium" | "high"

  /**
   * AI 置信度，0-1
   */
  confidence: number

  /**
   * 锚定信息
   */
  anchor: {
    blockId?: string
    from: number
    to: number
    quotedText: string
  }

  /**
   * 原文
   */
  originalText?: string

  /**
   * AI 建议修改后的文本
   */
  suggestedText?: string

  /**
   * 给创作者看的解释
   */
  reason: string

  /**
   * AI 依据
   */
  evidence?: {
    source: "campaign_brief" | "historical_feedback" | "system_rule"
    text: string
  }[]

  /**
   * 当前状态
   */
  status: "pending" | "accepted" | "rejected" | "resolved" | "needs_clarification"

  /**
   * 来源
   */
  source: "ai" | "brand"
}
```

### 5.3 BrandFeedback / ReviewDecision 数据结构

```typescript
export type DraftReviewStatus =
  | "drafting"
  | "submitted"
  | "in_review"
  | "changes_requested"
  | "revised"
  | "approved"
  | "published"
  | "rejected"

export type BrandFeedback = {
  id: string
  draftId: string
  campaignId: string

  category: ReviewCategory
  severity: "low" | "medium" | "high"

  /**
   * 品牌反馈处理方式
   * direct_apply: 品牌方提供建议文案，创作者可一键应用
   * manual_edit: 品牌方只给评论方向，创作者需要手动改正文
   */
  mode: "direct_apply" | "manual_edit"

  anchor?: {
    blockId?: string
    from: number
    to: number
    quotedText: string
  }

  comment: string
  suggestedText?: string

  status: "pending" | "resolved" | "rejected" | "needs_clarification"

  createdBy: {
    id: string
    name: string
    role: "brand_reviewer"
  }

  createdAt: string
}

export type DraftSubmission = {
  id: string
  draftId: string
  revision: number
  baseRevision?: number
  draftSnapshot: {
    docJson?: any
    plainText: string
    blocks: SerializedBlock[]
  }
  changes?: {
    blockId?: string
    label: string
    oldText: string
    newText: string
  }[]
  createdAt: string
}

export type ReviewDecision = {
  id: string
  draftId: string
  campaignId: string

  decision: "approved" | "changes_requested" | "rejected"

  summary?: string
  feedbackIds: string[]

  createdBy: {
    id: string
    name: string
    role: "brand_reviewer"
  }

  createdAt: string
}
```

### 5.4 锚点设计原则

第一版建议采用：

- `from / to + quotedText` 双重锚定

如果现有 Tiptap 文档中有稳定的 blockId，则升级为：

- `blockId + from / to + quotedText`

这样可以降低用户编辑后锚点漂移的问题。

对于 `insert` 类型，`quotedText` 可以表示插入位置，例如"文章结尾"、"第一段之后"，不一定是正文中已存在的原文片段。

### 5.5 ReviewDraftRequest

```typescript
export type ReviewDraftRequest = {
  draftId: string
  campaignId: string
  platform: "x" // 第一版先按 X / Twitter draft 场景设计，后续再扩展其他平台

  content: {
    docJson: any
    plainText: string
    blocks: SerializedBlock[]
  }

  campaignBrief?: {
    goal?: string
    mustMention?: string[]
    forbidden?: string[]
    links?: string[]
    cta?: string
    activityInfo?: string
    tone?: string
    examples?: string[]
  }

  historicalFeedback?: {
    quotedText: string
    brandFeedback: string
    creatorReply?: string
    status?: "open" | "resolved"
    campaignName?: string
  }[]
}
```

### 5.6 SerializedBlock

```typescript
export type SerializedBlock = {
  blockId?: string
  type: string
  text: string
  from: number
  to: number
  path?: number[]
}
```

### 5.7 ReviewDraftResponse

```typescript
export type ReviewDraftResponse = {
  reviewId: string

  overallStatus: "pass" | "needs_fix" | "needs_brand_review"

  score: number

  summary: string

  suggestions: ReviewSuggestion[]
}
```

### 5.8 Review Workflow Mock API

第一版两端 prototype 建议至少准备以下 mock API：

```typescript
POST /api/drafts
POST /api/drafts/:draftId/submit
GET /api/drafts/:draftId/submissions
GET /api/drafts/:draftId/submissions/:revision/diff
GET /api/brand/drafts?status=submitted
GET /api/brand/drafts/:draftId
POST /api/brand/drafts/:draftId/feedback
POST /api/brand/drafts/:draftId/decision
GET /api/creator/drafts/:draftId/feedback
POST /api/creator/feedback/:feedbackId/status
POST /api/creator/review-actions/:actionId/undo
```

### 5.9 Response 示例

```json
{
  "reviewId": "review_001",
  "overallStatus": "needs_fix",
  "score": 78,
  "summary": "Draft 基本可用，但缺少品牌导流，且活动信息需要根据最新 brief 更新。",
  "suggestions": [
    {
      "id": "sug_001",
      "type": "insert",
      "category": "brand_cta",
      "severity": "medium",
      "confidence": 0.88,
      "anchor": {
        "from": 520,
        "to": 520,
        "quotedText": "文章结尾"
      },
      "suggestedText": "感兴趣可以体验下：www.apodex.ai",
      "reason": "历史反馈中品牌方多次要求在结尾增加推荐导流。",
      "evidence": [
        {
          "source": "historical_feedback",
          "text": "最后加下推荐导流吧"
        }
      ],
      "status": "pending",
      "source": "ai"
    }
  ]
}
```

## 6. 实现方案

### 6.1 Prototype 模块

第一版建议拆成三个模块：

1. **Creator Draft Workspace**
   - Tiptap Editor
   - AI Review 入口
   - Review / Feedback Panel
   - Submit / Resubmit
   - Apply all / Reject all 批量处理
   - Toast Undo 与 `Ctrl+Z` / `Cmd+Z` 应用级撤销
   - 品牌方确认后的只读发布态
2. **Brand Review Console**
   - Draft 列表
   - Draft 审核详情
   - 添加 feedback
   - 反馈 mode：提供建议文案 / 仅评论建议
   - 反馈 severity：High / Medium / Low
   - Revision 对比 changes
   - Approved / Changes Requested / Rejected 判定
3. **Review Workflow Mock Service**
   - 保存 draft
   - 保存 AI suggestions
   - 保存 brand feedback
   - 保存 review decision
   - 保存 revision submission snapshot 和 revision diff
   - 保存 activity timeline / 操作日志
   - 模拟两端状态同步

### 6.2 Tiptap Extension 设计

Extension 名称：

```typescript
AIReviewExtension
```

使用方式：

```typescript
AIReviewExtension.configure({
  suggestions,
  onAccept,
  onReject,
  onResolve,
  onSelectSuggestion,
})
```

Commands：

```typescript
editor.commands.runAIReview()
editor.commands.setReviewSuggestions(suggestions)
editor.commands.acceptSuggestion(id)
editor.commands.rejectSuggestion(id)
editor.commands.acceptAllPendingSuggestions()
editor.commands.rejectAllPendingSuggestions()
editor.commands.resolveSuggestion(id)
editor.commands.setBrandFeedback(feedback)
editor.commands.applyBrandFeedback(id)
editor.commands.markFeedbackAsFixed(id)
editor.commands.clearReviewSuggestions()
editor.commands.scrollToSuggestion(id)
editor.commands.undoLastReviewAction()
editor.commands.setReviewReadonly(readonly)
```

快捷键约定：

- Extension 需要暴露应用级 undo 能力，用于撤销最近一次 Accept / Reject / Apply all / Reject all / 品牌建议文案 Apply。
- `Ctrl+Z` / `Cmd+Z` 在刚执行过应用级操作且用户尚未继续手动输入时，优先触发 `undoLastReviewAction()`。
- 用户继续编辑正文后，`Ctrl+Z` / `Cmd+Z` 回到 Tiptap / ProseMirror 原生 undo。
- `approved` / `published` 状态下调用 `setReviewReadonly(true)`，编辑区只读，并隐藏 AI Review 与 Review / Feedback Panel 操作。

### 6.3 渲染方式

第一版使用 ProseMirror Decoration 渲染 pending suggestions 和品牌方 feedback。

Decoration 交互约束：

- 可编辑状态下，高亮文本 Decoration 不应拦截正文点击和光标定位。
- 可编辑状态下，只有编号 badge 作为选择 / 定位 / 展开右侧卡片的交互热区。
- 只读审核详情中，可以允许整段高亮作为定位热区。

### 6.4 Editor Adapter

为了让该能力后续可以作为 SDK / 插件被接入，建议在 extension 内部先保留一层 Adapter 边界。

```typescript
export interface EditorReviewAdapter {
  getDocJSON(): any

  getPlainText(): string

  getTextWithPositions(): SerializedBlock[]

  applySuggestion(suggestion: ReviewSuggestion): void

  applySuggestions(suggestions: ReviewSuggestion[]): void

  applyBrandFeedback(feedback: BrandFeedback): void

  highlightFeedback(feedback: BrandFeedback): void

  highlightSuggestion(id: string): void

  clearSuggestion(id: string): void

  scrollToSuggestion(id: string): void

  setReadonly(readonly: boolean): void

  undoLastReviewAction(): void

  getRevisionDiff(base: SerializedBlock[], current: SerializedBlock[]): RevisionDiff[]
}
```

```typescript
export type RevisionDiff = {
  blockId?: string
  label: string
  oldText: string
  newText: string
}
```

第一版先提供：

1. `TiptapEditorAdapter`

P2 阶段再补充 `PlainTextAdapter`、拆分 core review logic，并将 adapter 作为正式 SDK 接口对外暴露。

### 6.5 AI Review 规则设计

第一版的 ReviewSuggestion 由 LLM 生成。系统侧负责把 draft 内容、campaign brief、历史反馈规则和输出 schema 组装成 prompt，LLM 按约定 schema 返回结构化 suggestions，前端再负责展示、定位、接受、拒绝和回写。

历史数据不直接进入模型训练，而是先沉淀为三类可控输入：

1. **Prompt rules**：从历史拒稿理由和品牌反馈中总结出的审核规则，例如必须补 CTA、链接需使用最新 brief、内容不能偏资讯。
2. **Few-shot examples**：选取典型历史 case，作为"原文 → 品牌反馈 → 建议修改"的示例，帮助 LLM 学习输出风格。
3. **Review skills**：把可复用审核能力封装成稳定检查项，例如链接检查、CTA 检查、活动信息检查、内容质量检查。

第一版 AI Review Prompt 应该包含：

1. 当前 draft 内容
2. 当前 campaign brief
3. 品牌必须提及的信息
4. 品牌禁止出现的信息
5. 正确链接 / CTA / 活动信息
6. 历史品牌反馈规则 / 样例 / review skills
7. 输出 schema

LLM 不直接输出自然语言长评，而是必须输出结构化 JSON。

LLM 输出要求：

1. 每条 suggestion 必须有 category
2. 每条 suggestion 必须有 quotedText
3. `replace / insert` 必须有 suggestedText
4. `delete / comment` 可以没有 suggestedText
5. 高风险问题不能直接自动修改，只能 comment
6. 不能凭空编造 brief 里没有的信息
7. 无法确定时降低 confidence

## 7. 验收标准与成功指标

### 7.1 功能验收

1. 创作者端能在 Tiptap 编辑器中读取和编辑 draft 内容
2. 能将 Tiptap docJson 序列化成 plainText / blocks
3. 点击 AI Review 后能生成结构化 suggestions
4. 能在编辑器内高亮 suggestion 对应片段
5. Review / Feedback Panel 能展示 AI suggestions 和品牌方 feedback
6. 点击右侧 suggestion / feedback 能定位到正文
7. AI suggestion 支持 Accept / Reject
8. Accept 后能正确修改 Tiptap 文档
9. Reject 后不修改正文，并移除/弱化高亮
10. 创作者能提交 draft 给品牌方
11. 品牌方管理端能展示待审核 draft 列表
12. 品牌方能进入审核详情查看正文、brief 和 AI Review 摘要
13. 品牌方能添加锚定正文片段的 feedback
14. 品牌方能判定 approved / changes_requested / rejected
15. 创作者端能收到品牌方 feedback 和审核判定
16. 创作者能标记 feedback 已处理，并修改后再次提交
17. 能记录每条 suggestion / feedback / decision 的处理状态
18. 品牌 feedback 卡片能展示严重程度，并按 High / Medium / Low 优先级排序
19. 品牌方打回后，创作者端默认打开品牌反馈 tab，并提示未处理反馈数量
20. 可编辑正文中的高亮文本可以正常点击放置光标，不被 Review Panel 联动打断
21. 点击正文编号 badge 能展开右侧对应 suggestion / feedback
22. Accept / Reject / Apply 后支持 `Ctrl+Z` / `Cmd+Z` 撤销最近一次应用级操作
23. 品牌方 approved 后，创作者端进入只读发布态，隐藏 AI Review 和 Review / Feedback Panel 操作
24. 品牌方 approved 后，最终发布不再被 pending AI suggestions 阻塞
25. AI suggestions 支持 Apply all / Reject all，并能整体撤销
26. 品牌方 feedback 支持 direct apply 建议文案和 manual edit 评论建议两种模式
27. manual edit feedback 只有在正文被修改后才能标记完成
28. 品牌方审核详情支持 revision changes 对比
29. 两端关键操作会写入 activity timeline
30. 能提供两端 prototype 使用说明

### 7.2 业务验收

使用现有反馈数据中的典型 case 测试，AI 至少能识别以下问题：

1. 缺少推荐导流
2. 链接需要替换
3. 活动信息过期
4. 产品规格 / 模型数量错误
5. 内容方向不符合 campaign brief
6. 内容太泛、太像资讯，不像真实测评
7. 格式问题，比如空格、大小写、重复 bullet
8. 已有多篇类似内容，需要品牌方判断
9. 未 approved 就发布的流程风险

### 7.3 测试用例

第一版建议准备一组固定测试 draft，用来验证 AI Review 结果、编辑器高亮、Review Panel 展示、品牌方 feedback、审核判定和创作者修改再提交是否符合预期。


| Case          | 输入场景                                      | 预期结果                                                            |
| ------------- | ----------------------------------------- | --------------------------------------------------------------- |
| 缺少品牌导流        | 文章正文完整，但结尾没有 CTA / 推荐链接                   | 生成 `brand_cta` suggestion，建议在结尾补充导流内容                           |
| 链接错误          | draft 中使用旧链接或非 brief 指定链接                 | 生成 `link_issue` suggestion，指出错误链接并建议替换为正确链接                     |
| 活动信息过期        | draft 中引用已结束活动或旧时间                        | 生成 `factual_error` suggestion，提示根据最新 brief 确认活动信息               |
| 产品信息错误        | 产品名、型号、规格、价格等与 brief 不一致                  | 生成 `factual_error` suggestion，并锚定错误片段                           |
| 内容方向不符合 brief | 内容偏资讯介绍，缺少测评体验或 campaign 要求重点             | 生成 `campaign_brief` 或 `content_quality` suggestion              |
| 格式问题          | 出现大小写错误、重复 bullet、异常空格或排版问题               | 生成 `format_issue` suggestion，可支持 replace / delete               |
| 相似内容风险        | draft 与同 campaign 下已有内容高度相似               | 生成 `similarity_risk` comment，提示需要品牌方判断                          |
| 发布流程风险        | draft 中出现未 approved 就发布、提前公开等表述           | 生成 `publish_flow` comment，提示流程风险                                |
| Accept 回写     | 用户接受 replace / insert / delete suggestion | 正文被正确修改，suggestion 状态改为 accepted，高亮移除或弱化                        |
| Reject 处理     | 用户拒绝 suggestion                           | 正文不变，suggestion 状态改为 rejected，高亮移除或弱化                           |
| 批量处理          | 用户点击 Apply all / Reject all                | 所有 pending suggestions 被批量处理，并可通过 toast 或快捷键整体撤销                 |
| 品牌方要求修改      | 品牌方在正文片段上添加 feedback 并选择 changes_requested | 创作者端收到 feedback，draft 状态变为 changes_requested，可定位到正文并修改         |
| 品牌建议文案        | 品牌方 feedback 选择 direct_apply 并填写 suggestedText | 创作者端展示 diff，可 Apply 后替换正文并标记 resolved                              |
| 品牌仅评论建议       | 品牌方 feedback 选择 manual_edit               | 创作者端必须先手动修改正文，之后才能点击完成修改并标记 resolved                         |
| 品牌方通过        | 品牌方选择 approved                           | draft 状态变为 approved，创作者端展示通过结果                                      |
| 品牌方不通过       | 品牌方选择 rejected                           | draft 状态变为 rejected，创作者端展示不通过原因                                    |
| 创作者再次提交      | 创作者修改后 resubmit                         | draft 状态重新变为 submitted / in_review，品牌方端可再次审核                       |
| Revision 对比    | Revision 2 进入品牌方审核详情后点击对比 changes       | 品牌方可看到 Revision 1 → Revision 2 的 inline diff，并能切回当前版本                 |
| 锚点漂移          | AI Review 后用户轻微编辑正文                       | 系统优先通过 `from / to + quotedText` 找回锚点，无法匹配时提示该 suggestion 需要重新定位 |
| LLM 输出异常      | LLM 返回非 JSON、缺字段或 schema 不合法              | 前端不崩溃，提示 review 失败或丢弃非法 suggestion，并记录错误                        |


### 7.4 成功指标

第一版上线前建议重点看以下指标：

1. 典型历史反馈 case 命中率
2. 创作者对 AI suggestion 的 Accept / Reject 比例
3. AI suggestion 被品牌方再次指出为错误或无效的比例
4. 品牌方重复低级批注数量是否下降
5. 创作者初稿一次通过率是否提升

### 7.5 依赖项

第一版落地前需要确认：

1. 当前 Tiptap 版本和 editor 初始化方式
2. draft 当前保存格式：ProseMirror JSON / HTML / Markdown / plain text
3. Campaign brief 的数据来源和字段完整度
4. 历史 feedback 数据的取样方式和脱敏要求
5. review result / suggestion status 的后端保存接口
6. 平台侧权限、审核流和发布状态由谁接入

## 8. 风险与后续规划

### 8.1 风险与处理方案

**锚点漂移**

用户编辑正文后，from / to 可能失效。

处理方案：

- 第一版：`from / to + quotedText` 双重匹配
- 后续：`blockId + offset + text fingerprint`

**AI 误判**

AI 可能给出错误建议。

处理方案：

- 第一版不自动应用修改，所有正文变更必须由用户点击 Accept 后触发
- 高风险建议只做 comment，不做自动 replace

**历史数据不够结构化**

历史数据适合作为 few-shot 和规则参考，但暂不适合直接训练模型。

处理方案：

- 第一版用 campaign brief + historical feedback 做 prompt grounding
- 后续再沉淀 accept / reject 数据

**相似内容判断依赖全量 campaign 数据**

"本次 campaign 已有多篇类似内容"这类问题，仅靠单篇 draft 判断不准确。

处理方案：

- 第一版作为 `similarity_risk` comment
- 后续如果后端能提供 campaign 下所有 draft，再做相似度检测

**图片问题暂不支持视觉识别**

数据中存在图片相关反馈，例如图片中文字不统一等。

处理方案：

- 第一版只支持 `image_asset` comment
- 不做图片 OCR / 图片内容分析

### 8.2 Roadmap

P0 先验证两端 prototype 协作闭环，P1 接入真实 LLM Review。P0 + P1 合起来构成可上线 MVP。生产级权限、移动端适配、视觉识别、SDK 化和模型训练放到后续阶段评估。

#### P0：两端 Prototype 核心闭环

- [ ] 确认 Tiptap 当前版本和现有 editor 初始化方式
- [ ] 确认 draft 当前保存格式：ProseMirror JSON / HTML / Markdown / plain text
- [ ] 定义 ReviewSuggestion schema
- [ ] 定义 BrandFeedback schema
- [ ] 定义 ReviewDecision / DraftReviewStatus schema
- [ ] 定义 ReviewCategory 分类
- [ ] 定义 ReviewDraftRequest / ReviewDraftResponse
- [ ] 定义 draft submit / feedback / decision mock API
- [ ] 实现 Tiptap docJson → plainText serializer
- [ ] 实现 Tiptap docJson → blocks serializer
- [ ] 实现 AI Review mock API，返回固定 ReviewSuggestion 测试数据
- [ ] 实现创作者端 Tiptap 写作页面
- [ ] 实现创作者端 Review / Feedback Panel
- [ ] 实现 AI suggestions 列表展示
- [ ] 实现 AI suggestions Apply all / Reject all 批量操作
- [ ] 实现品牌方 feedback 列表展示
- [ ] 实现品牌方 feedback 严重程度展示和 High / Medium / Low 排序
- [ ] 实现品牌方 feedback direct_apply / manual_edit 两种处理模式
- [ ] 实现点击 suggestion / feedback 定位正文
- [ ] 实现正文编号 badge 点击后展开右侧对应 suggestion / feedback
- [ ] 实现可编辑正文高亮文本的正常光标定位，避免点击高亮时误触发右侧展开
- [ ] 实现 ProseMirror Decoration 高亮
- [ ] 实现 TiptapEditorAdapter 内部接口
- [ ] 实现 Accept suggestion
- [ ] 实现 Reject suggestion
- [ ] 实现 Accept / Reject / Apply 后的 `Ctrl+Z` / `Cmd+Z` 应用级撤销
- [ ] 实现 Mark feedback as fixed
- [ ] 实现创作者 Submit / Resubmit
- [ ] 实现品牌方 draft 列表
- [ ] 实现品牌方审核详情页
- [ ] 实现品牌方添加 feedback
- [ ] 实现品牌方选择正文片段后添加锚定 feedback
- [ ] 实现 revision submission snapshot 和 changes 对比
- [ ] 实现品牌方 approved / changes_requested / rejected 判定
- [ ] 实现状态更新：drafting / submitted / in_review / changes_requested / revised / approved / rejected
- [ ] 实现 approved / published 阶段创作者端只读发布态
- [ ] 实现 approved / published 阶段隐藏 AI Review 和 Review / Feedback Panel 操作
- [ ] 实现 toast Undo、activity timeline 和侧边栏状态计数
- [ ] 覆盖 Accept / Reject / 品牌方反馈 / 审核判定 / 再提交 / 锚点漂移等基础测试用例
- [ ] 覆盖快捷键撤销、品牌反馈默认打开、发布只读态等交互测试用例
- [ ] 覆盖批量处理、品牌反馈两种 mode、revision diff 对比等交互测试用例
- [ ] 实现两端 prototype 页面

#### P1：接入真实 LLM Review

- [ ] 根据 campaign brief 拼接 AI Review prompt
- [ ] 从历史反馈中总结 prompt rules
- [ ] 整理典型 few-shot examples
- [ ] 配置基础 review skills：CTA、链接、活动信息、事实错误、格式、内容质量
- [ ] 要求 LLM 按 ReviewSuggestion JSON schema 输出
- [ ] 增加 JSON parse / schema validate
- [ ] 增加 LLM 输出异常兜底
- [ ] 增加 confidence / severity 展示
- [ ] 增加 evidence 展示
- [ ] 增加 category filter
- [ ] 用固定测试用例和真实反馈数据测试典型 case

#### P2：生产化审核能力

- [ ] 接入真实 draft 保存接口
- [ ] 接入真实 review result / feedback / decision 保存接口
- [ ] 接入平台权限
- [ ] 接入审核流状态
- [ ] 支持 comment thread
- [ ] 支持 creator reply
- [ ] 支持 resolve
- [ ] 支持品牌方 approve 前最终检查

#### P3：SDK / Adapter 化

- [ ] 将内部 TiptapEditorAdapter 整理为稳定接口
- [ ] 抽象正式 EditorReviewAdapter
- [ ] 实现 PlainTextAdapter
- [ ] 拆分 core review logic
- [ ] 拆分 react ReviewPanel component
- [ ] 拆分 tiptap extension
- [ ] 提供接入示例
- [ ] 写 README
- [ ] 写 API 文档
- [ ] 写接入注意事项

#### P4：后续增强 / 难点评估

- [ ] 支持 campaign 下相似内容检测
- [ ] 支持 brief 版本管理
- [ ] 支持图片问题 OCR / 视觉检查
- [ ] 支持将 accept / reject 结果沉淀为知识库
- [ ] 评估移动端或窄屏适配是否进入产品范围
- [ ] 评估模型训练 / Fine-tune 的数据量、成本和效果收益
