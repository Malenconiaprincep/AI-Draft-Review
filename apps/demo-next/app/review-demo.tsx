"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { AIAssistantPanel, type SuggestionStatus } from "@tutti/ai-assistant-react";
import {
  BrandReviewPanel,
  type BrandFeedbackDraftInput,
  type BrandRevisionDiff,
  type BrandReviewStatus
} from "@tutti/brand-review-react";
import { CreatorFeedbackPanel } from "@tutti/creator-feedback-react";
import {
  applyInlineSuggestionToDraftDoc,
  createDraftDocExtensions,
  sampleReviewInput,
  type DraftCommentThread,
  type DraftDocJSON,
  type DraftNodeJSON,
  type DraftReviewInput,
  type InlineSuggestionProposal,
  type ReviewProposal
} from "@tutti/draft-doc";
import {
  createCommentHighlightExtension,
  locateQuotedText,
  refreshCommentHighlights,
  remapAnchor,
  type EditorHighlight
} from "@tutti/editor-highlight-sdk";
import { applyBrandReplacement, getBrandCommentHighlights } from "./review-demo-logic";

const FLOW_STEPS = [
  { title: "写作", copy: "Creator draft" },
  { title: "提交", copy: "Submit draft" },
  { title: "品牌审核", copy: "Review console" },
  { title: "反馈同步", copy: "Comments", loop: true },
  { title: "修改 / 再提交", copy: "Creator fixes", loop: true },
  { title: "品牌方确认", copy: "Release OK" },
  { title: "发布", copy: "Publish" }
];

const REVIEW_EXAMPLES = [
  {
    id: "apodex",
    title: "高风险开发者测评",
    brief: [
      "Apodex Developer Review Campaign",
      "目标：突出 Apodex 对开发者 PR review 工作流的帮助，内容要像真实测评，不要写成泛泛的 AI 工具介绍。",
      "必须提及：CLI review、GitHub PR、campaign link。",
      "CTA：https://apodex.example.com/campaign",
      "避免：绝对化承诺、旧活动信息、没有具体使用场景。"
    ].join("\n"),
    proposal: [
      "Apodex 让 PR Review 更像一次结对检查",
      "",
      "我这次试用 Apodex，第一感觉是它把 code review 这件事从最后一步提前到了本地开发阶段。之前我通常是写完功能、整理 commit、开 GitHub PR，然后等同事在评论里指出测试遗漏、描述不清或者边界条件没覆盖。",
      "",
      "这次我在一个小功能分支里跑了它，改动包括一个接口参数校验、一个前端状态提示和两条单元测试。Apodex 会沿着 diff 逐段看问题，比如某个变量命名和现有 schema 不一致，PR 描述里没有解释为什么要改状态流转，还有一个错误态没有测试覆盖。",
      "",
      "我觉得它最大的价值是 100% 准确地替团队完成所有 review。只要跑过一次 Apodex，基本就不需要人工 reviewer 再看了，这一点对赶 deadline 的团队很有吸引力。",
      "",
      "它也支持 CLI review。我在本地执行 review 命令后，它先给一个整体风险摘要，再把建议分成需要补测试、命名不一致、上下文不充分几类。这个顺序挺有用，因为我可以先修高风险问题，再把一些设计取舍留给 PR discussion。",
      "",
      "GitHub PR 集成也还不错。它会把 PR description 和 diff 放在一起看，不过我这次还没有绑定最新的 campaign link，所以先用的是旧活动页 https://apodex.example.com/old-beta。等之后我再补上也行。",
      "",
      "不过我也感觉它还是另一个 AI 工具集合，主要就是帮忙提高效率。类似的工具应该也能做到差不多的事情，所以这段体验可能没有特别独特的地方。",
      "",
      "如果你感兴趣，可以先自己搜索 Apodex 了解更多。"
    ].join("\n")
  },
  {
    id: "creator",
    title: "创作者工具旧链路",
    brief: [
      "Acme AI 新品发布",
      "目标：推广 Acme AI 的草稿审阅、发布规划和内容协作能力。",
      "必须包含：真实 before / after 工作流、最新 launch URL、话题标签 #AcmeAI #内容创作。",
      "CTA：https://acme.example.com/launch",
      "避免：旧 beta 链接、夸大效果、把产品说成完全替代人工审核。"
    ].join("\n"),
    proposal: [
      "我为什么把内容初稿迁到 Acme AI",
      "",
      "我这两周实际用了 acme ai 来整理产品笔记，它能把零散想法更快整理成一条适合发布的 X thread。",
      "",
      "以前我写推广内容时，会先把产品卖点、截图说明、历史反馈分散放在不同文档里。写完一版之后，再手动检查有没有旧链接、有没有缺 CTA、语气是不是和 brief 对齐。这个过程不难，但非常容易漏掉小问题。",
      "",
      "这次我把一版草稿丢进 Acme AI，它先把内容拆成标题、正文、素材说明和发布前检查几部分。它指出我前面用了小写品牌名，也提醒我截图没有解释对应的功能点，这个提醒对我挺实用。",
      "",
      "但它可以完全替代人工审稿，基本不需要品牌方再看。只要 AI 判断通过，我觉得就可以直接发布，这样品牌方和创作者都省时间。",
      "",
      "不过我这里还提到了旧 beta 链接，产品现在已经适合更多团队使用。旧链接虽然不是最新的，但读者应该也能搜到新入口。",
      "",
      "我还想强调一个点：Acme AI 不只是改错字，它更像一个内容发布前的检查清单。比如它会提醒我在结尾补上推荐入口，也会建议我把“提高效率”改成更具体的 before / after 工作流。",
      "",
      "整体来说它就是另一个 AI 工具集合，能提高效率。之后我可能会在更多草稿里试试。"
    ].join("\n")
  },
  {
    id: "clean",
    title: "低风险通过稿",
    brief: [
      "Nova Notes Launch Review",
      "目标：展示 Nova Notes 如何帮助团队整理会议记录和行动项。",
      "必须包含：真实使用场景、最新链接、明确 CTA。",
      "CTA：https://nova.example.com/start",
      "避免：声称自动做决策、遗漏人工确认边界。"
    ].join("\n"),
    proposal: [
      "Nova Notes 帮我把会议纪要从整理任务变成确认任务",
      "",
      "过去我们开完会之后，通常需要一个人花二十分钟整理纪要，再把行动项发到群里确认。最近我用 Nova Notes 跑了一轮真实项目会，它能先把讨论主题、负责人和下一步整理出来，我只需要检查有没有遗漏。",
      "",
      "这次会议里有三个主题：下周发布节奏、客服反馈归类、以及设计稿验收时间。Nova Notes 会把每个主题下的结论和待办拆开，比如发布节奏归到产品负责人，客服反馈归到运营同事，设计验收则标给设计和前端一起确认。",
      "",
      "我比较喜欢的一点是，它不是替团队做决策，而是把原本分散的记录先变成一版可确认草稿。对经常开跨部门同步会的团队来说，这个变化很实际，也不会让人觉得 AI 越过了人的判断。",
      "",
      "实际使用里我还是会人工看一遍，尤其是负责人和日期这种容易影响协作的字段。Nova Notes 的价值更像是先把 80% 的整理工作完成，然后让团队集中确认剩下的 20%。",
      "",
      "如果你也想试试，可以从最新链接开始体验：https://nova.example.com/start"
    ].join("\n")
  }
];

const DEFAULT_EXAMPLE = REVIEW_EXAMPLES[0];

type DemoDesk = "creator" | "brand";
type DemoWorkflowStage = "drafting" | "submitted" | "brand_feedback" | "resubmitted" | "approved" | "published";
type BrandSelectionAnchor = { from: number; to: number };
type BrandReviewBaseline = { doc: DraftDocJSON; version: number };

type UndoSnapshot = {
  input: DraftReviewInput;
  suggestionStatuses: Record<string, SuggestionStatus>;
  selectedSuggestionId: string | null;
  workflowStage: DemoWorkflowStage;
  activeDesk: DemoDesk;
  brandSelectionText: string;
  brandSelectionAnchor: BrandSelectionAnchor | null;
  manualDraftEdited: boolean;
  brandReviewBaseline: BrandReviewBaseline | null;
  revisionDiff: BrandRevisionDiff | null;
  compareChanges: boolean;
};

function createDemoInitialInput(): DraftReviewInput {
  return createDemoReviewInput(DEFAULT_EXAMPLE.brief, DEFAULT_EXAMPLE.proposal, sampleReviewInput.draft.docVersion);
}

function createDemoReviewInput(briefText: string, proposalText: string, docVersion: number): DraftReviewInput {
  return {
    ...sampleReviewInput,
    draft: {
      ...sampleReviewInput.draft,
      docJson: textToDraftDoc(proposalText),
      docVersion
    },
    campaignBrief: briefTextToCampaignBrief(briefText),
    campaignContext: campaignTextToContext(briefText),
    openComments: []
  };
}

function selectClosestAnchor(
  matches: BrandSelectionAnchor[],
  preferredFrom?: number
): BrandSelectionAnchor | null {
  if (matches.length === 0) return null;
  if (preferredFrom == null) return matches[0];
  return matches.reduce((closest, current) =>
    Math.abs(current.from - preferredFrom) < Math.abs(closest.from - preferredFrom) ? current : closest
  );
}

function briefTextToCampaignBrief(briefText: string): DraftReviewInput["campaignBrief"] {
  const lines = briefText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const url = briefText.match(/https?:\/\/\S+/)?.[0]?.replace(/[)，。；;,.)]+$/, "");
  const hashtags = Array.from(new Set(briefText.match(/#[^\s#，。,.;；]+/g) ?? []));

  return {
    campaignId: "campaign_llm_playground",
    name: lines[0] ?? "LLM Review Campaign",
    description: briefText,
    contentUrl: url,
    hashtags,
    ideaStarters: lines.slice(1)
  };
}

function campaignTextToContext(text: string): DraftReviewInput["campaignContext"] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const title = trimmed.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return [
    {
      id: "campaign_context_input",
      title: title ?? "Campaign context",
      sourceType: "proposal",
      text: trimmed
    }
  ];
}

function textToDraftDoc(text: string): DraftDocJSON {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return {
    type: "doc",
    content: blocks.map((block, index) => ({
      type: index === 0 && block.length <= 80 ? "heading" : "paragraph",
      attrs: index === 0 && block.length <= 80 ? { level: 1 } : undefined,
      content: [{ type: "text", text: block.replace(/\n+/g, " ") }]
    }))
  };
}

function draftDocToEditableText(doc: DraftDocJSON): string {
  return (
    doc.content
      ?.map((node) => nodeText(node))
      .filter(Boolean)
      .join("\n\n") ?? ""
  );
}

function nodeText(node: DraftDocJSON | DraftNodeJSON): string {
  if ("text" in node && node.text) return node.text;
  return node.content?.map((child) => nodeText(child)).join("") ?? "";
}

function cloneDraftDoc(doc: DraftDocJSON): DraftDocJSON {
  return JSON.parse(JSON.stringify(doc)) as DraftDocJSON;
}

function normalizeFeedbackText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function draftDocToDiffBlocks(doc: DraftDocJSON | undefined): Array<{ label: string; text: string }> {
  return (
    doc?.content?.map((node, index) => ({
      label: index === 0 && node.type === "heading" ? "标题" : `段落 ${index}`,
      text: normalizeFeedbackText(nodeText(node))
    })) ?? []
  );
}

function computeRevisionDiff(params: {
  baseline: BrandReviewBaseline | null;
  currentDoc: DraftDocJSON | undefined;
  currentVersion: number;
}): BrandRevisionDiff | null {
  if (!params.currentDoc) return null;
  if (!params.baseline) {
    return {
      baseVersion: null,
      revision: params.currentVersion,
      changes: []
    };
  }

  const previousBlocks = draftDocToDiffBlocks(params.baseline.doc);
  const currentBlocks = draftDocToDiffBlocks(params.currentDoc);
  const max = Math.max(previousBlocks.length, currentBlocks.length);
  const changes: BrandRevisionDiff["changes"] = [];

  for (let index = 0; index < max; index += 1) {
    const previous = previousBlocks[index] ?? { label: `段落 ${index}`, text: "" };
    const current = currentBlocks[index] ?? { label: previous.label, text: "" };
    if (previous.text === current.text) continue;
    changes.push({
      id: `change_${index}`,
      label: current.text ? current.label : previous.label,
      oldText: previous.text,
      newText: current.text
    });
  }

  return {
    baseVersion: params.baseline.version,
    revision: params.currentVersion,
    changes
  };
}

function getChangedSegments(oldText: string, newText: string) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
    start += 1;
  }

  let oldEnd = oldText.length - 1;
  let newEnd = newText.length - 1;
  while (oldEnd >= start && newEnd >= start && oldText[oldEnd] === newText[newEnd]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return {
    prefix: newText.slice(0, start) || oldText.slice(0, start),
    oldChange: oldText.slice(start, oldEnd + 1),
    newChange: newText.slice(start, newEnd + 1),
    suffix: newText.slice(newEnd + 1) || oldText.slice(oldEnd + 1)
  };
}

function createBrandFeedbackThread(
  input: DraftReviewInput,
  feedback: BrandFeedbackDraftInput,
  index: number,
  anchor: BrandSelectionAnchor | null
): DraftCommentThread {
  const body =
    feedback.action === "replace"
      ? feedback.body.trim() || "请按替换建议调整选中内容。"
      : feedback.body;

  return {
    id: `brand_feedback_${input.draft.docVersion}_${index}_${Date.now().toString(36)}`,
    anchorFrom: anchor?.from ?? null,
    anchorTo: anchor?.to ?? null,
    quotedText: feedback.quotedText,
    status: "open",
    action: feedback.action,
    suggestedText: feedback.suggestedText,
    messages: [
      {
        id: `brand_feedback_${input.draft.docVersion}_${index}_msg`,
        body,
        authorKind: "brand",
        authorHandle: "brand-reviewer",
        createdAt: new Date().toISOString()
      }
    ]
  };
}

export function DraftReviewDemo() {
  const [input, setInput] = useState<DraftReviewInput>(() => createDemoInitialInput());
  const [briefText, setBriefText] = useState(DEFAULT_EXAMPLE.brief);
  const [proposalText, setProposalText] = useState(DEFAULT_EXAMPLE.proposal);
  const [activeExampleId, setActiveExampleId] = useState<string | null>(DEFAULT_EXAMPLE.id);
  const [proposal, setProposal] = useState<ReviewProposal | undefined>();
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [suggestionStatuses, setSuggestionStatuses] = useState<Record<string, SuggestionStatus>>({});
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);
  const [editorReviewing, setEditorReviewing] = useState(false);
  const [workflowStage, setWorkflowStage] = useState<DemoWorkflowStage>("drafting");
  const [activeDesk, setActiveDesk] = useState<DemoDesk>("creator");
  const [brandSelectionText, setBrandSelectionText] = useState("");
  const [brandSelectionAnchor, setBrandSelectionAnchor] = useState<BrandSelectionAnchor | null>(null);
  const [brandSelectionActivated, setBrandSelectionActivated] = useState(false);
  const brandSelectionStartRef = useRef<number | null>(null);
  const canEditDraft = activeDesk === "creator" && workflowStage === "brand_feedback";
  const canEditDraftRef = useRef(canEditDraft);
  const highlightsRef = useRef<EditorHighlight[]>([]);
  const selectedHighlightIdRef = useRef<string | null>(null);
  const [manualDraftEdited, setManualDraftEdited] = useState(false);
  const [brandReviewBaseline, setBrandReviewBaseline] = useState<BrandReviewBaseline | null>(null);
  const [revisionDiff, setRevisionDiff] = useState<BrandRevisionDiff | null>(null);
  const [compareChanges, setCompareChanges] = useState(false);

  const highlights = useMemo<EditorHighlight[]>(() => {
    const commentHighlights: EditorHighlight[] = getBrandCommentHighlights(input.openComments, canEditDraft);

    const aiHighlights: EditorHighlight[] =
      proposal?.inlineSuggestions
        .map((suggestion, index): EditorHighlight => ({
          id: suggestion.id,
          source: "ai",
          status:
            proposal.analyzedDocVersion === input.draft.docVersion
              ? "open"
              : "stale",
          severity: suggestion.severity,
          quotedText: suggestion.quotedText,
          anchorFrom: suggestion.resolvedAnchor?.from,
          anchorTo: suggestion.resolvedAnchor?.to,
          label: `A${index + 1}`
        }))
        .filter((highlight) => (suggestionStatuses[highlight.id] ?? "pending") === "pending") ?? [];

    const activeBrandSelection: EditorHighlight[] =
      activeDesk === "brand" &&
      (workflowStage === "submitted" || workflowStage === "resubmitted") &&
      brandSelectionActivated &&
      brandSelectionText &&
      brandSelectionAnchor
        ? [
            {
              id: "brand-active-selection",
              source: "brand-selection",
              status: "focused",
              anchorFrom: brandSelectionAnchor.from,
              anchorTo: brandSelectionAnchor.to,
              quotedText: brandSelectionText,
              showBadge: false
            }
          ]
        : [];

    return [...commentHighlights, ...activeBrandSelection, ...aiHighlights];
  }, [
    activeDesk,
    brandSelectionAnchor,
    brandSelectionActivated,
    brandSelectionText,
    canEditDraft,
    input.openComments,
    proposal,
    suggestionStatuses,
    workflowStage
  ]);

  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: false,
      onUpdate: ({ editor: currentEditor, transaction }) => {
        if (!transaction.docChanged) return;
        if (!canEditDraftRef.current) return;
        const nextDoc = currentEditor.getJSON() as DraftDocJSON;
        setManualDraftEdited(true);
        setProposalText(draftDocToEditableText(nextDoc));
        setInput((current) => ({
          ...current,
          draft: {
            ...current.draft,
            docJson: nextDoc
          },
          openComments: current.openComments.map((comment) => {
            const nextAnchor = remapAnchor(transaction.mapping, {
              from: comment.anchorFrom ?? null,
              to: comment.anchorTo ?? null
            });
            return {
              ...comment,
              anchorFrom: nextAnchor.from,
              anchorTo: nextAnchor.to
            };
          })
        }));
      },
      extensions: [
        ...createDraftDocExtensions(),
        createCommentHighlightExtension({
          editable: canEditDraft,
          getHighlights: () => highlightsRef.current,
          getSelectedId: () => selectedHighlightIdRef.current,
          onSelectHighlight: setSelectedSuggestionId
        })
      ],
      content: input.draft.docJson
    },
    [canEditDraft, input.draft.docVersion]
  );

  useEffect(() => {
    highlightsRef.current = highlights;
    selectedHighlightIdRef.current = selectedSuggestionId;
    if (!editor || editor.isDestroyed) return;
    refreshCommentHighlights(editor.view);
  }, [editor, highlights, selectedSuggestionId]);

  useEffect(() => {
    canEditDraftRef.current = canEditDraft;
    editor?.setEditable(canEditDraft);
  }, [canEditDraft, editor]);

  useEffect(() => {
    if (!editor || activeDesk !== "brand" || (workflowStage !== "submitted" && workflowStage !== "resubmitted")) return;

    const clearSelection = () => {
      setBrandSelectionText("");
      setBrandSelectionAnchor(null);
      setBrandSelectionActivated(false);
    };

    const resolveDocPosFromPoint = (clientX: number, clientY: number): number | null => {
      const coordsPos = editor.view.posAtCoords({ left: clientX, top: clientY });
      if (coordsPos) return coordsPos.pos;

      const ownerDocument = editor.view.dom.ownerDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };

      const caretPosition = ownerDocument.caretPositionFromPoint?.(clientX, clientY);
      if (caretPosition && editor.view.dom.contains(caretPosition.offsetNode)) {
        return editor.view.posAtDOM(caretPosition.offsetNode, caretPosition.offset);
      }

      const range = ownerDocument.caretRangeFromPoint?.(clientX, clientY);
      if (range && editor.view.dom.contains(range.startContainer)) {
        return editor.view.posAtDOM(range.startContainer, range.startOffset);
      }

      return null;
    };

    const anchorFromPositions = (start: number, end: number): BrandSelectionAnchor | null => {
      const from = Math.max(0, Math.min(start, end));
      const to = Math.min(editor.state.doc.content.size, Math.max(start, end));
      return to > from ? { from, to } : null;
    };

    const applyAnchor = (anchor: BrandSelectionAnchor | null) => {
      if (!anchor) {
        clearSelection();
        return;
      }
      const text = editor.state.doc.textBetween(anchor.from, anchor.to, " ", " ").replace(/\s+/g, " ").trim();
      if (!text) {
        clearSelection();
        return;
      }
      setBrandSelectionText(text);
      setBrandSelectionAnchor(anchor);
      // A drag only records the target. The visual highlight appears after the
      // reviewer starts an action in the feedback panel.
      setBrandSelectionActivated(false);
    };

    const updateNativeSelection = (preferredFrom?: number) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const startsInEditor = editor.view.dom.contains(range.startContainer);
      const endsInEditor = editor.view.dom.contains(range.endContainer);
      if (!startsInEditor || !endsInEditor) return;

      if (selection.isCollapsed) {
        clearSelection();
        return;
      }

      const selectedText = selection.toString().replace(/\s+/g, " ").trim();
      if (!selectedText) return;

      let preferredAnchor: BrandSelectionAnchor | null = null;
      try {
        const start = editor.view.posAtDOM(range.startContainer, range.startOffset);
        const end = editor.view.posAtDOM(range.endContainer, range.endOffset);
        const anchor = anchorFromPositions(start, end);
        if (anchor) {
          const rangeText = editor.state.doc.textBetween(anchor.from, anchor.to, " ", " ").replace(/\s+/g, " ").trim();
          if (rangeText === selectedText) {
            preferredAnchor = anchor;
          }
        }
      } catch {
        preferredAnchor = null;
      }

      const located = locateQuotedText({
        doc: editor.state.doc,
        quotedText: selectedText,
        preferredFrom: preferredAnchor?.from,
        preferredTo: preferredAnchor?.to
      });
      const anchor =
        located.status === "located" || located.status === "recovered"
          ? { from: located.from, to: located.to }
          : located.status === "ambiguous"
            ? selectClosestAnchor(located.matches, preferredAnchor?.from ?? preferredFrom)
            : null;

      applyAnchor(anchor);
    };

    let animationFrame: number | null = null;
    const scheduleSelectionUpdate = (callback: () => void) => {
      if (animationFrame != null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        callback();
      });
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !editor.view.dom.contains(event.target)) {
        brandSelectionStartRef.current = null;
        return;
      }
      brandSelectionStartRef.current = resolveDocPosFromPoint(event.clientX, event.clientY);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const start = brandSelectionStartRef.current;
      if (start == null) return;
      brandSelectionStartRef.current = null;
      scheduleSelectionUpdate(() => {
        const selection = window.getSelection();
        if (selection?.isCollapsed && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (editor.view.dom.contains(range.startContainer)) {
            clearSelection();
            return;
          }
        }
        const end = resolveDocPosFromPoint(event.clientX, event.clientY);
        if (end == null) {
          updateNativeSelection(start);
          return;
        }
        applyAnchor(anchorFromPositions(start, end));
      });
    };

    const handleKeyUp = () => {
      scheduleSelectionUpdate(() => updateNativeSelection());
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      if (animationFrame != null) {
        window.cancelAnimationFrame(animationFrame);
      }
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [activeDesk, editor, workflowStage]);

  const syncReviewInput = useCallback(
    (nextBriefText: string, nextProposalText: string, nextExampleId: string | null = null) => {
      const nextInput = createDemoReviewInput(nextBriefText, nextProposalText, input.draft.docVersion + 1);
      setBriefText(nextBriefText);
      setProposalText(nextProposalText);
      setActiveExampleId(nextExampleId);
      setInput(nextInput);
      setProposal(undefined);
      setSelectedSuggestionId(null);
      setSuggestionStatuses({});
      setUndoSnapshot(null);
      setLastActionMessage(null);
      setWorkflowStage("drafting");
      setActiveDesk("creator");
      setBrandSelectionText("");
      setBrandSelectionAnchor(null);
      setBrandSelectionActivated(false);
      setManualDraftEdited(false);
      setBrandReviewBaseline(null);
      setRevisionDiff(null);
      setCompareChanges(false);
      editor?.commands.setContent(nextInput.draft.docJson ?? { type: "doc", content: [{ type: "paragraph" }] });
    },
    [editor, input.draft.docVersion]
  );

  const runReview = useCallback(async (reviewInput: DraftReviewInput) => {
    const response = await fetch("/api/ai-assistant/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reviewInput)
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "AI review failed.");
    }
    const nextProposal = (await response.json()) as ReviewProposal;
    setProposal(nextProposal);
    setSelectedSuggestionId(nextProposal.inlineSuggestions[0]?.id ?? null);
    setSuggestionStatuses(
      Object.fromEntries(nextProposal.inlineSuggestions.map((suggestion) => [suggestion.id, "pending"]))
    );
    setUndoSnapshot(null);
    setLastActionMessage(null);
    setWorkflowStage("drafting");
    setActiveDesk("creator");
    setBrandSelectionText("");
    setBrandSelectionAnchor(null);
    setBrandSelectionActivated(false);
    setManualDraftEdited(false);
    setBrandReviewBaseline(null);
    setRevisionDiff(null);
    setCompareChanges(false);
    return nextProposal;
  }, []);

  const captureUndo = useCallback(() => {
    setUndoSnapshot({
      input,
      suggestionStatuses,
      selectedSuggestionId,
      workflowStage,
      activeDesk,
      brandSelectionText,
      brandSelectionAnchor,
      manualDraftEdited,
      brandReviewBaseline,
      revisionDiff,
      compareChanges
    });
  }, [
    activeDesk,
    brandSelectionAnchor,
    brandSelectionText,
    brandReviewBaseline,
    compareChanges,
    input,
    manualDraftEdited,
    revisionDiff,
    selectedSuggestionId,
    suggestionStatuses,
    workflowStage
  ]);

  const applySuggestion = useCallback(
    (suggestion: InlineSuggestionProposal) => {
      captureUndo();

      const docJson = input.draft.docJson;
      const result = docJson ? applyInlineSuggestionToDraftDoc(docJson, suggestion) : undefined;

      if (result?.applied) {
        const nextInput = {
          ...input,
          draft: {
            ...input.draft,
            docJson: result.doc,
            docVersion: input.draft.docVersion + 1
          }
        };
        setInput(nextInput);
        setProposalText(draftDocToEditableText(result.doc));
        editor?.commands.setContent(result.doc);
        setLastActionMessage("已应用建议并生成新的文档版本。");
      } else {
        setLastActionMessage("这条建议不适合自动改文，已标记为已处理；宿主接入时可在这里落库为评论。");
      }

      setSuggestionStatuses((current) => ({ ...current, [suggestion.id]: "accepted" }));
    },
    [captureUndo, editor, input]
  );

  const rejectSuggestion = useCallback(
    (suggestion: InlineSuggestionProposal) => {
      captureUndo();
      setSuggestionStatuses((current) => ({ ...current, [suggestion.id]: "rejected" }));
      setLastActionMessage("已拒绝这条 AI 建议。");
    },
    [captureUndo]
  );

  const applyAllSuggestions = useCallback(
    (suggestions: InlineSuggestionProposal[]) => {
      if (suggestions.length === 0) return;
      captureUndo();

      let nextDoc = input.draft.docJson;
      let changedDoc = false;
      let commentOnlyCount = 0;

      suggestions.forEach((suggestion) => {
        if (!nextDoc) {
          commentOnlyCount += 1;
          return;
        }
        const result = applyInlineSuggestionToDraftDoc(nextDoc, suggestion);
        if (result.applied) {
          nextDoc = result.doc;
          changedDoc = true;
        } else {
          commentOnlyCount += 1;
        }
      });

      if (nextDoc && changedDoc) {
        const nextInput = {
          ...input,
          draft: {
            ...input.draft,
            docJson: nextDoc,
            docVersion: input.draft.docVersion + 1
          }
        };
        setInput(nextInput);
        setProposalText(draftDocToEditableText(nextDoc));
        editor?.commands.setContent(nextDoc);
      }

      setSuggestionStatuses((current) => ({
        ...current,
        ...Object.fromEntries(suggestions.map((suggestion) => [suggestion.id, "accepted"]))
      }));
      setLastActionMessage(
        commentOnlyCount > 0
          ? "已批量处理 AI 建议；无法安全自动改文的项已标记为已处理。"
          : "已批量应用 AI 建议。"
      );
    },
    [captureUndo, editor, input]
  );

  const rejectAllSuggestions = useCallback(
    (suggestions: InlineSuggestionProposal[]) => {
      if (suggestions.length === 0) return;
      captureUndo();
      setSuggestionStatuses((current) => ({
        ...current,
        ...Object.fromEntries(suggestions.map((suggestion) => [suggestion.id, "rejected"]))
      }));
      setLastActionMessage("已批量拒绝待处理 AI 建议。");
    },
    [captureUndo]
  );

  const submitDraft = useCallback(() => {
    captureUndo();
    setWorkflowStage("submitted");
    setActiveDesk("brand");
    setSelectedSuggestionId(null);
    setBrandSelectionText("");
    setBrandSelectionAnchor(null);
    setBrandSelectionActivated(false);
    setManualDraftEdited(false);
    setBrandReviewBaseline(input.draft.docJson ? { doc: cloneDraftDoc(input.draft.docJson), version: input.draft.docVersion } : null);
    setRevisionDiff(null);
    setCompareChanges(false);
    setLastActionMessage("已提交给品牌方，进入品牌审核台。");
  }, [captureUndo, input.draft.docJson, input.draft.docVersion]);

  const createBrandFeedback = useCallback((feedback: BrandFeedbackDraftInput) => {
    const nextComment = createBrandFeedbackThread(input, feedback, input.openComments.length + 1, brandSelectionAnchor);
    captureUndo();
    setInput((current) => ({
      ...current,
      openComments: [...current.openComments, nextComment]
    }));
    setSelectedSuggestionId(nextComment.id);
    setBrandSelectionText("");
    setBrandSelectionAnchor(null);
    setBrandSelectionActivated(false);
    setLastActionMessage("已添加一条品牌反馈，尚未发送给创作者。");
  }, [brandSelectionAnchor, captureUndo, input]);

  const removeBrandFeedback = useCallback(
    (comment: DraftCommentThread) => {
      captureUndo();
      setInput((current) => {
        const nextComments = current.openComments.filter((item) => item.id !== comment.id);
        if (selectedSuggestionId === comment.id) {
          setSelectedSuggestionId(nextComments[0]?.id ?? null);
        }
        return {
          ...current,
          openComments: nextComments
        };
      });
      setLastActionMessage("已删除一条尚未发送的品牌反馈。");
    },
    [captureUndo, selectedSuggestionId]
  );

  const sendBrandFeedback = useCallback(
    (comments: DraftCommentThread[]) => {
      if (comments.length === 0) return;
      captureUndo();
      setWorkflowStage("brand_feedback");
      setActiveDesk("creator");
      setSelectedSuggestionId(comments[0]?.id ?? null);
      setBrandSelectionText("");
      setBrandSelectionAnchor(null);
      setBrandSelectionActivated(false);
      setManualDraftEdited(false);
      setBrandReviewBaseline(input.draft.docJson ? { doc: cloneDraftDoc(input.draft.docJson), version: input.draft.docVersion } : null);
      setRevisionDiff(null);
      setCompareChanges(false);
      setLastActionMessage("品牌反馈已发送给创作者。");
    },
    [captureUndo, input.draft.docJson, input.draft.docVersion]
  );

  const clearBrandSelection = useCallback(() => {
    setBrandSelectionText("");
    setBrandSelectionAnchor(null);
    setBrandSelectionActivated(false);
    window.getSelection()?.removeAllRanges();
  }, []);

  const activateBrandSelection = useCallback(() => {
    // Run before the browser focuses the right-side control. Clearing the
    // editor selection after focus would also interrupt the textarea caret.
    window.getSelection()?.removeAllRanges();
    setBrandSelectionActivated(true);
  }, []);

  const resolveBrandComment = useCallback(
    (comment: DraftCommentThread) => {
      captureUndo();
      const resolvedText =
        comment.anchorFrom != null && comment.anchorTo != null && comment.anchorTo > comment.anchorFrom
          ? normalizeFeedbackText(editor?.state.doc.textBetween(comment.anchorFrom, comment.anchorTo, " ", " ") ?? "")
          : "";
      setInput((current) => {
        const nextComments = current.openComments.map((item) =>
          item.id === comment.id
            ? {
                ...item,
                status: "resolved" as const,
                resolvedText: resolvedText || item.resolvedText
              }
            : item
        );
        const nextOpenComment = nextComments.find((item) => item.status === "open");
        setSelectedSuggestionId(nextOpenComment?.id ?? null);
        return {
          ...current,
          openComments: nextComments
        };
      });
      setLastActionMessage("已标记一条品牌反馈为已处理。");
    },
    [captureUndo, editor]
  );

  const applyBrandComment = useCallback(
    (comment: DraftCommentThread) => {
      captureUndo();

      let nextDoc = input.draft.docJson;
      let appliedToDraft = false;
      let appliedViaEditor = false;
      const result = applyBrandReplacement({ comment, docJson: nextDoc, editor });
      nextDoc = result.doc;
      appliedToDraft = result.applied;
      appliedViaEditor = result.appliedViaEditor;

      setInput((current) => {
        const nextComments = current.openComments.map((item) =>
          item.id === comment.id
            ? {
                ...item,
                status: "resolved" as const,
                resolvedText: appliedToDraft && comment.suggestedText ? comment.suggestedText : item.resolvedText
              }
            : item
        );
        const nextOpenComment = nextComments.find((item) => item.status === "open");
        setSelectedSuggestionId(nextOpenComment?.id ?? null);
        return {
          ...current,
          draft:
            appliedToDraft && nextDoc
              ? {
                  ...current.draft,
                  docJson: nextDoc,
                  docVersion: current.draft.docVersion + 1
                }
              : current.draft,
          openComments: nextComments
        };
      });

      if (appliedToDraft && nextDoc) {
        setProposalText(draftDocToEditableText(nextDoc));
        if (!appliedViaEditor) {
          editor?.commands.setContent(nextDoc);
        }
        editor?.commands.blur();
        window.getSelection()?.removeAllRanges();
        setLastActionMessage("已应用品牌替换建议，并生成新的文档版本。");
      } else {
        setLastActionMessage(comment.action === "replace" ? "未能自动应用替换，已标记为已处理。" : "已接受这条品牌反馈。");
      }
    },
    [captureUndo, editor, input.draft.docJson]
  );

  const rejectBrandComment = useCallback(
    (comment: DraftCommentThread) => {
      captureUndo();
      setInput((current) => {
        const nextComments = current.openComments.map((item) =>
          item.id === comment.id ? { ...item, status: "resolved" as const } : item
        );
        const nextOpenComment = nextComments.find((item) => item.status === "open");
        setSelectedSuggestionId(nextOpenComment?.id ?? null);
        return {
          ...current,
          openComments: nextComments
        };
      });
      setLastActionMessage("已拒绝这条品牌反馈。");
    },
    [captureUndo]
  );

  const reopenBrandComment = useCallback(
    (comment: DraftCommentThread) => {
      captureUndo();
      setInput((current) => ({
        ...current,
        openComments: current.openComments.map((item) =>
          item.id === comment.id ? { ...item, status: "open" as const, resolvedText: undefined } : item
        )
      }));
      setSelectedSuggestionId(comment.id);
      setWorkflowStage("brand_feedback");
      setLastActionMessage("已重新打开这条品牌反馈。");
    },
    [captureUndo]
  );

  const resubmitDraft = useCallback(() => {
    captureUndo();
    const nextVersion = manualDraftEdited ? input.draft.docVersion + 1 : input.draft.docVersion;
    const nextRevisionDiff = computeRevisionDiff({
      baseline: brandReviewBaseline,
      currentDoc: input.draft.docJson,
      currentVersion: nextVersion
    });
    setInput((current) => ({
      ...current,
      draft: manualDraftEdited
        ? {
            ...current.draft,
            docVersion: nextVersion
          }
        : current.draft,
      openComments: []
    }));
    setRevisionDiff(nextRevisionDiff);
    setWorkflowStage("resubmitted");
    setActiveDesk("brand");
    setSelectedSuggestionId(null);
    setBrandSelectionText("");
    setBrandSelectionAnchor(null);
    setBrandSelectionActivated(false);
    setManualDraftEdited(false);
    setCompareChanges(false);
    setLastActionMessage("已再次提交给品牌方复审。");
  }, [brandReviewBaseline, captureUndo, input.draft.docJson, input.draft.docVersion, manualDraftEdited]);

  const approveDraft = useCallback(() => {
    captureUndo();
    setWorkflowStage("approved");
    setActiveDesk("brand");
    setLastActionMessage("品牌方已确认通过，等待发布。");
  }, [captureUndo]);

  const publishDraft = useCallback(() => {
    captureUndo();
    setWorkflowStage("published");
    setLastActionMessage("内容已发布，演示流程完成。");
  }, [captureUndo]);

  const undoLastAction = useCallback(() => {
    if (!undoSnapshot) return;
    setInput(undoSnapshot.input);
    setSuggestionStatuses(undoSnapshot.suggestionStatuses);
    setSelectedSuggestionId(undoSnapshot.selectedSuggestionId);
    setWorkflowStage(undoSnapshot.workflowStage);
    setActiveDesk(undoSnapshot.activeDesk);
    setBrandSelectionText(undoSnapshot.brandSelectionText);
    setBrandSelectionAnchor(undoSnapshot.brandSelectionAnchor);
    setBrandSelectionActivated(false);
    setManualDraftEdited(undoSnapshot.manualDraftEdited);
    setBrandReviewBaseline(undoSnapshot.brandReviewBaseline);
    setRevisionDiff(undoSnapshot.revisionDiff);
    setCompareChanges(undoSnapshot.compareChanges);
    editor?.commands.setContent(undoSnapshot.input.draft.docJson ?? { type: "doc", content: [{ type: "paragraph" }] });
    setUndoSnapshot(null);
    setLastActionMessage("已撤销上一步操作。");
  }, [editor, undoSnapshot]);

  const bumpDocVersion = useCallback(() => {
    setInput((current) => ({
      ...current,
      draft: {
        ...current.draft,
        docVersion: current.draft.docVersion + 1
      }
    }));
  }, []);

  const resetDemo = useCallback(() => {
    const nextInput = createDemoInitialInput();
    setBriefText(DEFAULT_EXAMPLE.brief);
    setProposalText(DEFAULT_EXAMPLE.proposal);
    setActiveExampleId(DEFAULT_EXAMPLE.id);
    setInput(nextInput);
    setProposal(undefined);
    setSelectedSuggestionId(null);
    setSuggestionStatuses({});
    setUndoSnapshot(null);
    setLastActionMessage(null);
    setWorkflowStage("drafting");
    setActiveDesk("creator");
    setBrandSelectionText("");
    setBrandSelectionAnchor(null);
    setBrandSelectionActivated(false);
    setManualDraftEdited(false);
    setBrandReviewBaseline(null);
    setRevisionDiff(null);
    setCompareChanges(false);
    editor?.commands.setContent(nextInput.draft.docJson ?? { type: "doc", content: [{ type: "paragraph" }] });
  }, [editor]);

  const runEditorReview = useCallback(async () => {
    setEditorReviewing(true);
    try {
      await runReview(input);
    } catch (error) {
      setLastActionMessage(error instanceof Error ? error.message : "AI 审阅失败。");
    } finally {
      setEditorReviewing(false);
    }
  }, [input, runReview]);

  const pendingAiCount = useMemo(
    () =>
      proposal?.inlineSuggestions.filter(
        (suggestion) => (suggestionStatuses[suggestion.id] ?? "pending") === "pending"
      ).length ?? 0,
    [proposal, suggestionStatuses]
  );
  const totalAiCount = proposal?.inlineSuggestions.length ?? 0;
  const openBrandFeedbackCount = input.openComments.filter((comment) => comment.status === "open").length;
  const isBrandReviewStage = workflowStage === "submitted" || workflowStage === "resubmitted";
  const canSubmitDraft = Boolean(proposal) && pendingAiCount === 0 && workflowStage === "drafting";
  const canResubmitDraft = workflowStage === "brand_feedback" && input.openComments.length > 0 && openBrandFeedbackCount === 0;
  const canSendBrandFeedback = isBrandReviewStage && input.openComments.length > 0;
  const canApproveBrandReview = isBrandReviewStage && input.openComments.length === 0;
  const brandReviewStatus = getBrandReviewStatus(workflowStage);
  const reviewStateLabel = getReviewStateLabel({ pendingAiCount, proposal, workflowStage, openBrandFeedbackCount });
  const reviewStateClass = getReviewStateClass(workflowStage, proposal, pendingAiCount, openBrandFeedbackCount);
  const activeFlowIndex = getActiveFlowIndex({ pendingAiCount, proposal, workflowStage, openBrandFeedbackCount });
  const stageProgress = getStageProgress(activeFlowIndex);
  const showScenarioSetup = activeDesk === "creator" && workflowStage === "drafting";
  const showRevisionCompare =
    activeDesk === "brand" &&
    workflowStage === "resubmitted" &&
    compareChanges &&
    Boolean(revisionDiff?.changes.length);
  const { stageTitle, stageCopy } = getStageContent({
    pendingAiCount,
    proposal,
    workflowStage,
    openBrandFeedbackCount
  });

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="logo">T</div>
          <div>
            <div className="brand-name">Tutti Review</div>
            <div className="brand-sub">Two-sided prototype</div>
          </div>
        </div>

        <nav className="nav" aria-label="Demo views">
          <button className={`nav-btn ${activeDesk === "creator" ? "active" : ""}`} type="button" onClick={() => setActiveDesk("creator")}>
            <Icon name="folder" />
            创作者端
          </button>
          <button className={`nav-btn ${activeDesk === "brand" ? "active" : ""}`} type="button" onClick={() => setActiveDesk("brand")}>
            <Icon name="document" />
            品牌方端
          </button>
        </nav>

        <section className="sidebar-section">
          <div className="small-label">当前状态</div>
          <Metric label="Draft" value={reviewStateLabel} />
          <Metric label="AI 建议" value={proposal ? `${pendingAiCount} pending` : "not run"} />
          <Metric label="品牌反馈" value={`${openBrandFeedbackCount} pending`} />
        </section>

        <section className="sidebar-section">
          <div className="small-label">演示链路</div>
          <Metric label="自查" value="AI Review" />
          <Metric label="审核" value="Brand Decision" />
          <Metric label="迭代" value="Resubmit" />
        </section>

        <section className="sidebar-section">
          <div className="small-label">操作日志</div>
          <div className="activity-log">
            {lastActionMessage ? (
              <div className="activity-item">
                <strong>Latest action</strong>
                {lastActionMessage}
              </div>
            ) : null}
            {proposal ? (
              <div className="activity-item">
                <strong>AI Review generated</strong>
                {totalAiCount} suggestions for doc v{proposal.analyzedDocVersion}
              </div>
            ) : (
              <div className="activity-item">
                <strong>Waiting for AI Review</strong>
                写完后点击 AI Review 生成自查建议
              </div>
            )}
            <div className="activity-item">
              <strong>Revision loaded</strong>
              当前文档版本 doc v{input.draft.docVersion}
            </div>
          </div>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="title-group">
            <h1 className="title">{activeDesk === "brand" ? "品牌方审核台" : "创作者工作台"}</h1>
            <div className="subtitle">{input.campaignBrief.name} · X / Twitter draft</div>
          </div>
          <div className="actions">
            <button className="btn ghost" type="button" onClick={bumpDocVersion}>
              <Icon name="rotate" />
              模拟版本变化
            </button>
            <button className="btn danger" type="button" onClick={resetDemo}>
              重置演示
            </button>
          </div>
        </header>

        <section className="flow-strip">
          <div className="flow-steps">
            {FLOW_STEPS.map((step, index) => (
              <div
                className={`step ${index < activeFlowIndex ? "done" : ""} ${
                  index === activeFlowIndex ? "active" : ""
                } ${step.loop ? "loop" : ""}`}
                key={step.title}
              >
                <div className="step-top">
                  <span className="step-dot" />
                  <span className="step-title">{step.title}</span>
                  {step.loop ? <span className="step-loop-badge">Round 1</span> : null}
                </div>
                <div className="step-copy">{step.copy}</div>
              </div>
            ))}
          </div>
          <div className="live-stage">
            <div>
              <div className="stage-kicker">Live interaction state</div>
              <div className="stage-title">{stageTitle}</div>
              <div className="stage-copy">{stageCopy}</div>
            </div>
            <div className="progress-shell" aria-label="Current flow progress">
              <div className="progress-fill" style={{ width: `${stageProgress}%` }} />
            </div>
          </div>
        </section>

        <section className="workspace">
          {showScenarioSetup ? (
            <section className="panel setup-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">测试数据</div>
                  <div className="subtitle">Campaign context 与 Creator draft</div>
                </div>
              </div>
              <div className="panel-body">
                <section className="llm-input-panel">
                  <div className="example-strip">
                    <span className="small-label">测试场景</span>
                    <div className="example-buttons">
                      {REVIEW_EXAMPLES.map((example) => (
                        <button
                          className={`example-btn ${activeExampleId === example.id ? "active" : ""}`}
                          key={example.id}
                          type="button"
                          onClick={() => syncReviewInput(example.brief, example.proposal, example.id)}
                        >
                          {example.title}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="review-input-grid">
                    <label className="review-field">
                      <span>Campaign context / proposal</span>
                      <textarea
                        value={briefText}
                        onChange={(event) => syncReviewInput(event.target.value, proposalText)}
                      />
                    </label>
                    <label className="review-field">
                      <span>Creator draft</span>
                      <textarea
                        value={proposalText}
                        onChange={(event) => syncReviewInput(briefText, event.target.value)}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          <div className="creator-grid">
            <section className="panel draft-pane">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Draft Editor</div>
                  <div className="subtitle">状态：{reviewStateLabel}</div>
                </div>
                <span className={`status-pill ${reviewStateClass}`}>{reviewStateLabel}</span>
              </div>

              <div className="panel-body">
                <div className="editor-shell">
                  <div className="editor-meta">
                    <div className="editor-meta-left">
                      <span>Creator: Demo User</span>
                      <span>Revision {input.draft.docVersion}</span>
                      {showRevisionCompare && revisionDiff ? (
                        <span>
                          Changes v{revisionDiff.baseVersion ?? "?"} → v{revisionDiff.revision ?? input.draft.docVersion}
                        </span>
                      ) : null}
                    </div>
                    <div className="editor-meta-right">
                      {workflowStage === "drafting" ? (
                        <>
                          <button className="editor-tool-btn" type="button" disabled={editorReviewing} onClick={runEditorReview}>
                            <Icon name="spark" />
                            <span>{editorReviewing ? "Reviewing..." : proposal ? "重新审阅" : "AI Review"}</span>
                          </button>
                          <button className="editor-tool-btn primary" type="button" disabled={!canSubmitDraft} onClick={submitDraft}>
                            提交品牌方
                          </button>
                        </>
                      ) : isBrandReviewStage ? (
                        <>
                          <button className="editor-tool-btn primary" type="button" disabled={!canSendBrandFeedback} onClick={() => sendBrandFeedback(input.openComments)}>
                            发送反馈给创作者
                          </button>
                          <button className="editor-tool-btn approve" type="button" disabled={!canApproveBrandReview} onClick={approveDraft}>
                            通过
                          </button>
                        </>
                      ) : workflowStage === "brand_feedback" ? (
                        <button className="editor-tool-btn primary" type="button" disabled={!canResubmitDraft} onClick={resubmitDraft}>
                          再次提交
                        </button>
                      ) : workflowStage === "approved" ? (
                        <button className="editor-tool-btn primary" type="button" onClick={publishDraft}>
                          发布内容
                        </button>
                      ) : (
                        <button className="editor-tool-btn" type="button" disabled>
                          已发布
                        </button>
                      )}
                    </div>
                  </div>
                  {showRevisionCompare ? (
                    <DraftCompareView baseline={brandReviewBaseline} currentDoc={input.draft.docJson} />
                  ) : (
                    <EditorContent editor={editor} className="draft-viewer editor" />
                  )}
                </div>

                {lastActionMessage ? (
                  <div className="demo-action-status">
                    <span>{lastActionMessage}</span>
                    <button type="button" disabled={!undoSnapshot} onClick={undoLastAction}>
                      Undo
                    </button>
                  </div>
                ) : null}
              </div>
            </section>

            <aside className="split">
              {activeDesk === "brand" ? (
                <BrandReviewPanel
                  status={brandReviewStatus}
                  campaignName={input.campaignBrief.name}
                  draftVersion={input.draft.docVersion}
                  revisionDiff={workflowStage === "resubmitted" ? revisionDiff : null}
                  compareChanges={compareChanges}
                  feedbackDrafts={isBrandReviewStage ? input.openComments : []}
                  selectedText={isBrandReviewStage ? brandSelectionText : ""}
                  selectedFeedbackId={selectedSuggestionId}
                  onSelectFeedback={setSelectedSuggestionId}
                  onClearSelection={clearBrandSelection}
                  onFeedbackInteraction={activateBrandSelection}
                  onToggleCompareChanges={() => setCompareChanges((current) => !current)}
                  onCreateFeedback={createBrandFeedback}
                  onRemoveFeedback={removeBrandFeedback}
                />
              ) : workflowStage === "drafting" ? (
                <AIAssistantPanel
                  input={input}
                  proposal={proposal}
                  showRunReviewAction={false}
                  selectedSuggestionId={selectedSuggestionId}
                  suggestionStatuses={suggestionStatuses}
                  canUndo={Boolean(undoSnapshot)}
                  onRunReview={runReview}
                  onSelectSuggestion={setSelectedSuggestionId}
                  onApplySuggestion={applySuggestion}
                  onRejectSuggestion={rejectSuggestion}
                  onApplyAllSuggestions={applyAllSuggestions}
                  onRejectAllSuggestions={rejectAllSuggestions}
                  onUndoLastAction={undoLastAction}
                />
              ) : workflowStage === "brand_feedback" ? (
                <CreatorFeedbackPanel
                  comments={input.openComments}
                  selectedCommentId={selectedSuggestionId}
                  canResolveManualComments={manualDraftEdited}
                  onSelectComment={setSelectedSuggestionId}
                  onApplyComment={applyBrandComment}
                  onRejectComment={rejectBrandComment}
                  onResolveComment={resolveBrandComment}
                  onReopenComment={reopenBrandComment}
                />
              ) : (
                <WorkflowStatusPanel
                  workflowStage={workflowStage}
                  onPublishDraft={publishDraft}
                />
              )}

              <section className="panel">
                <div className="panel-header">
                  <div className="panel-title">Campaign Brief</div>
                </div>
                <div className="panel-body brief">
                  <BriefRow label="目标" value={input.campaignBrief.description ?? "推广产品核心体验。"} />
                  <BriefRow label="Slogan" value={input.campaignBrief.slogan ?? "—"} />
                  <BriefRow label="CTA" value={input.campaignBrief.contentUrl ?? "—"} />
                  <BriefRow label="Hashtags" value={input.campaignBrief.hashtags?.join(" ") ?? "—"} />
                  <BriefRow label="避免" value={input.campaignBrief.ideaStarters?.join("；") ?? "不要写成泛泛的 AI 工具资讯。"} />
                </div>
              </section>

            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}

function DraftCompareView({
  baseline,
  currentDoc
}: {
  baseline: BrandReviewBaseline | null;
  currentDoc?: DraftDocJSON;
}) {
  const previousBlocks = draftDocToDiffBlocks(baseline?.doc);
  const currentBlocks = draftDocToDiffBlocks(currentDoc);
  const max = Math.max(previousBlocks.length, currentBlocks.length);

  if (max === 0) {
    return (
      <div className="draft-viewer editor draft-compare-view" aria-label="稿件版本对比">
        <div className="ProseMirror">
          <p className="muted">暂无可对比内容。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-viewer editor draft-compare-view" aria-label="稿件版本对比">
      <div className="ProseMirror">
        {Array.from({ length: max }, (_, index) => {
          const previous = previousBlocks[index] ?? { label: `段落 ${index}`, text: "" };
          const current = currentBlocks[index] ?? { label: previous.label, text: "" };
          if (!previous.text && !current.text) return null;
          const content =
            previous.text === current.text ? (
              current.text
            ) : (
              <InlineArticleDiff oldText={previous.text} newText={current.text} />
            );

          return index === 0 ? <h1 key={index}>{content}</h1> : <p key={index}>{content}</p>;
        })}
      </div>
    </div>
  );
}

function InlineArticleDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const segments = getChangedSegments(oldText, newText);

  return (
    <>
      {segments.prefix}
      {segments.oldChange ? <span className="article-diff-token remove">{segments.oldChange}</span> : null}
      {segments.newChange ? <span className="article-diff-token add">{segments.newChange}</span> : null}
      {segments.suffix}
    </>
  );
}

function WorkflowStatusPanel({
  workflowStage,
  onPublishDraft
}: {
  workflowStage: DemoWorkflowStage;
  onPublishDraft: () => void;
}) {
  const content = getWorkflowActionContent(workflowStage);

  return (
    <section className="panel workflow-action-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">{content.title}</div>
          <div className="subtitle">{content.subtitle}</div>
        </div>
        <span className={`status-pill ${content.statusClass}`}>{content.status}</span>
      </div>
      <div className="panel-body workflow-action-body">
        <p>{content.copy}</p>
        <div className="workflow-action-buttons">
          {workflowStage === "approved" ? (
            <button className="btn primary" type="button" onClick={onPublishDraft}>
              发布内容
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function getWorkflowActionContent(workflowStage: DemoWorkflowStage) {
  if (workflowStage === "submitted") {
    return {
      title: "品牌审核队列",
      subtitle: "Submitted draft",
      status: "审核中",
      statusClass: "amber",
      copy: "Draft 已提交给品牌方。请切到品牌方审核台添加反馈、发送给创作者，或直接通过。"
    };
  }
  if (workflowStage === "resubmitted") {
    return {
      title: "品牌复审",
      subtitle: "Resubmitted draft",
      status: "复审中",
      statusClass: "amber",
      copy: "创作者已处理反馈并再次提交。请在品牌方审核台完成复审。"
    };
  }
  if (workflowStage === "approved") {
    return {
      title: "品牌方确认",
      subtitle: "Approved by brand",
      status: "可发布",
      statusClass: "green",
      copy: "品牌方已经确认这版内容可以发布。"
    };
  }
  return {
    title: "发布完成",
    subtitle: "Published",
    status: "已发布",
    statusClass: "green",
    copy: "内容已经发布，提交后的审核闭环完成。"
  };
}

function getBrandReviewStatus(workflowStage: DemoWorkflowStage): BrandReviewStatus {
  if (workflowStage === "submitted") return "reviewing";
  if (workflowStage === "resubmitted") return "resubmitted";
  if (workflowStage === "approved") return "approved";
  if (workflowStage === "published") return "published";
  return "waiting";
}

function getReviewStateLabel({
  pendingAiCount,
  proposal,
  workflowStage,
  openBrandFeedbackCount
}: {
  pendingAiCount: number;
  proposal?: ReviewProposal;
  workflowStage: DemoWorkflowStage;
  openBrandFeedbackCount: number;
}) {
  if (workflowStage === "published") return "Published";
  if (workflowStage === "approved") return "Approved";
  if (workflowStage === "resubmitted") return "Resubmitted";
  if (workflowStage === "brand_feedback") {
    return openBrandFeedbackCount > 0 ? "Feedback" : "Ready to Resubmit";
  }
  if (workflowStage === "submitted") return "Submitted";
  if (!proposal) return "Drafting";
  return pendingAiCount > 0 ? "AI Ready" : "Ready to Submit";
}

function getReviewStateClass(
  workflowStage: DemoWorkflowStage,
  proposal: ReviewProposal | undefined,
  pendingAiCount: number,
  openBrandFeedbackCount: number
) {
  if (workflowStage === "published" || workflowStage === "approved") return "green";
  if (workflowStage === "brand_feedback") return openBrandFeedbackCount > 0 ? "amber" : "green";
  if (workflowStage === "submitted" || workflowStage === "resubmitted") return "amber";
  return proposal ? (pendingAiCount > 0 ? "amber" : "green") : "";
}

function getActiveFlowIndex({
  pendingAiCount,
  proposal,
  workflowStage,
  openBrandFeedbackCount
}: {
  pendingAiCount: number;
  proposal?: ReviewProposal;
  workflowStage: DemoWorkflowStage;
  openBrandFeedbackCount: number;
}) {
  if (!proposal || pendingAiCount > 0) return 0;
  if (workflowStage === "drafting") return 1;
  if (workflowStage === "submitted") return 2;
  if (workflowStage === "brand_feedback") return openBrandFeedbackCount > 0 ? 3 : 4;
  if (workflowStage === "resubmitted") return 5;
  if (workflowStage === "approved") return 5;
  return 6;
}

function getStageProgress(activeFlowIndex: number) {
  const progressByStep = [8, 30, 45, 58, 70, 86, 100];
  return progressByStep[activeFlowIndex] ?? 8;
}

function getStageContent({
  pendingAiCount,
  proposal,
  workflowStage,
  openBrandFeedbackCount
}: {
  pendingAiCount: number;
  proposal?: ReviewProposal;
  workflowStage: DemoWorkflowStage;
  openBrandFeedbackCount: number;
}) {
  if (!proposal) {
    return {
      stageTitle: "创作者正在编辑 Draft",
      stageCopy: "当前处于起草阶段，可以先运行 AI Review，再提交给品牌方审核。"
    };
  }
  if (pendingAiCount > 0 && workflowStage === "drafting") {
    return {
      stageTitle: "AI 建议已生成",
      stageCopy: "右侧 Review Panel 已出现建议，创作者可以逐条处理或忽略后再提交。"
    };
  }
  if (workflowStage === "drafting") {
    return {
      stageTitle: "Draft 可提交品牌方",
      stageCopy: "AI 待处理项已清空，可以进入品牌审核队列。"
    };
  }
  if (workflowStage === "submitted") {
    return {
      stageTitle: "Draft 已提交品牌方",
      stageCopy: "品牌方正在审核。Demo 可模拟返回反馈或直接通过。"
    };
  }
  if (workflowStage === "brand_feedback") {
    return openBrandFeedbackCount > 0
      ? {
          stageTitle: "品牌反馈已同步给创作者",
          stageCopy: "右侧创作者反馈组件会展示品牌 comments，处理完后可以再次提交。"
        }
      : {
          stageTitle: "品牌反馈已处理完",
          stageCopy: "所有品牌反馈都已标记处理，可以再次提交给品牌方复审。"
        };
  }
  if (workflowStage === "resubmitted") {
    return {
      stageTitle: "Draft 已再次提交",
      stageCopy: "品牌方复审中，请在品牌方审核台完成通过或继续反馈。"
    };
  }
  if (workflowStage === "approved") {
    return {
      stageTitle: "品牌方已确认",
      stageCopy: "内容已通过品牌方确认，可以发布。"
    };
  }
  return {
    stageTitle: "内容已发布",
    stageCopy: "提交后的审核闭环已完成。"
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="brief-row">
      <div className="brief-key">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function Icon({ name }: { name: "folder" | "document" | "rotate" | "spark" }) {
  if (name === "folder") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 19.5V6.2c0-.7.5-1.2 1.2-1.2H12c.7 0 1.4.3 1.9.8l.3.3c.5.5 1.2.8 1.9.8h2.7c.7 0 1.2.5 1.2 1.2v11.4H4Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path d="M8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "document") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 5h12v14H6V5Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 9h6M9 13h6M9 17h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "rotate") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m12 3 1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8L12 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
