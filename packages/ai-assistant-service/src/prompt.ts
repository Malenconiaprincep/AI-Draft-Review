import { docJsonToPlainText, type DraftReviewInput } from "@tutti/draft-doc";

export function buildReviewPrompt(input: DraftReviewInput): string {
  const draftText =
    input.draft.draftKind === "doc"
      ? docJsonToPlainText(input.draft.docJson)
      : input.draft.draftUrl ?? "";

  const history = input.reviewHistory
    .filter((event) => event.note?.trim())
    .map((event) => `- ${event.createdAt} ${event.authorKind}: ${event.note}`)
    .join("\n");

  const comments = input.openComments
    .filter((comment) => comment.status === "open")
    .map((comment) => {
      const messages = comment.messages.map((message) => `${message.authorKind}: ${message.body}`).join(" | ");
      return `- quotedText=${comment.quotedText ?? "(orphaned)"} messages=${messages}`;
    })
    .join("\n");
  const campaignContext = formatCampaignContext(input);
  const maxSuggestions = input.options?.maxInlineSuggestions ?? 6;

  return [
    "你是 Tutti 的品牌草稿 AI review assistant。",
    "请只返回 JSON，不要返回 Markdown。",
    "",
    "输入说明：",
    "- Draft 是创作者提交的待审内容，所有 inlineSuggestions 的 quotedText 必须来自 Draft 原文。",
    "- Campaign context 是动态资料源，可能是一整份 campaign proposal、品牌方工具包、发布规范、参考素材或混合文档。",
    "- Campaign brief 是可选结构化摘要；如果 brief 缺失或很短，请主要依据 Campaign context。",
    "- 如果 brief 和 Campaign context 冲突，以 Campaign context 中更具体、更新、可执行的要求为准。",
    "- 不要求宿主提前把 proposal 摘成固定字段；你需要从动态资料里抽取品牌事实、目标受众、必提信息、禁用表述、CTA、链接、账号、时间节点和审核流程。",
    "",
    "核心规则：",
    "- 不要编造 Campaign context / brief 中没有的信息。",
    "- 高风险和不确定的问题只提出建议，不要自动改正文。",
    "- inlineSuggestions 用 quotedText 定位，不要输出 ProseMirror position。",
    "- 如果 open comments 已经覆盖同一问题，避免重复提出。",
    "- 高频拒稿原因：缺真实使用场景或实测、品牌名写错、事实性错误、案例太弱、泛泛而谈、缺少 CTA、链接/账号/话题不是资料中的最新要求、夸大自动化或替代人工、隐私/安全承诺超出资料。",
    "- action 可选值：comment 表示只指出问题、不自动改正文；replace 表示用 suggestedText 替换 quotedText；insert_after 表示在 quotedText 后插入 suggestedText；delete 表示删除 quotedText。",
    "- 只有文本修改足够确定时才使用 replace / insert_after / delete；否则使用 comment。",
    `- 最多返回 ${maxSuggestions} 条 inlineSuggestions，优先返回会影响品牌审核通过的具体问题。`,
    "- summary 用 1-2 句概括是否可过审和最关键风险，不要输出长段审稿意见。",
    "- evidence 尽量引用 Campaign context / brief / open comments 中的短句，不要长篇复制资料。",
    "",
    "输出 JSON schema：",
    JSON.stringify(
      {
        reviewId: "string",
        analyzedDocVersion: input.draft.docVersion,
        verdict: "approve | request_changes | reject",
        summary: "string",
        inlineSuggestions: [
          {
            id: "string",
            quotedText: "string",
            body: "string",
            severity: "blocker | suggestion",
            category:
              "brand_cta | link_issue | campaign_brief | factual_error | format_issue | content_quality | similarity_risk | image_asset | publish_flow | general_comment",
            action: "comment | replace | insert_after | delete",
            suggestedText: "string, required for replace or insert_after",
            evidence: [{ source: "campaign_brief | campaign_context | review_history | open_comment | system_rule", text: "string" }]
          }
        ],
        risks: [{ category: "string", severity: "blocker | suggestion", body: "string" }]
      },
      null,
      2
    ),
    "",
    "Campaign brief:",
    formatCampaignBrief(input),
    "",
    "Campaign context:",
    campaignContext,
    "",
    "Review history:",
    history || "(none)",
    "",
    "Open comments:",
    comments || "(none)",
    "",
    "Draft:",
    draftText || "(empty)"
  ].join("\n");
}

function formatCampaignBrief(input: DraftReviewInput): string {
  const brief = input.campaignBrief;
  const hasBrief =
    Boolean(brief.name?.trim()) ||
    Boolean(brief.description?.trim()) ||
    Boolean(brief.slogan?.trim()) ||
    Boolean(brief.contentUrl?.trim()) ||
    Boolean(brief.hashtags?.length) ||
    Boolean(brief.officialPost?.length) ||
    Boolean(brief.ideaStarters?.length);

  if (!hasBrief) return "(none; use Campaign context)";
  return JSON.stringify(brief, null, 2);
}

function formatCampaignContext(input: DraftReviewInput): string {
  const docs = input.campaignContext?.filter((doc) => doc.text.trim()) ?? [];
  if (docs.length === 0) return "(none)";

  return docs
    .map((doc, index) =>
      [
        `--- context ${index + 1} ---`,
        `title: ${doc.title ?? "(untitled)"}`,
        `sourceType: ${doc.sourceType ?? "other"}`,
        doc.url ? `url: ${doc.url}` : undefined,
        "text:",
        doc.text.trim()
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}
