import type { DraftReviewInput } from "./types";

export const sampleReviewInput: DraftReviewInput = {
  draft: {
    postStateId: "post_state_demo_001",
    draftKind: "doc",
    docVersion: 7,
    docJson: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "我为什么把内容初稿迁到 Acme AI" }]
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "我这两周实际用了 acme ai 来整理产品笔记，它能把零散想法更快整理成一条适合发布的 X thread。"
            }
          ]
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "它可以 100% 准确地替你完成所有审稿，基本不需要人工看。"
            }
          ]
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "最有用的是审稿流程：我可以先写草稿，再根据反馈调整表达，最后把语气保持在同一个方向。"
            }
          ]
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "不过我这里还提到了旧 beta 链接，产品现在已经适合更多团队使用。"
            }
          ]
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "我准备今天就直接发出去，之后再补审核意见也可以。"
            }
          ]
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "整体来说它就是另一个 AI 工具集合，能提高效率。"
            }
          ]
        },
        {
          type: "image",
          attrs: {
            src: "/api/demo-assets/acme-control.png",
            alt: "Acme AI 审稿 demo 截图",
            title: "Acme AI 审稿 demo 截图"
          }
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "下面两个本地视频素材也会通过 demo service 读取，验证编辑器里的视频内容块。"
            }
          ]
        },
        {
          type: "video",
          attrs: {
            src: "/api/demo-assets/review-flow-2026-07-06.mov",
            title: "2026-07-06 审稿流程录屏"
          }
        },
        {
          type: "video",
          attrs: {
            src: "/api/demo-assets/review-flow-2026-07-08.mov",
            title: "2026-07-08 审稿流程录屏"
          }
        }
      ]
    }
  },
  campaignBrief: {
    campaignId: "campaign_demo_001",
    name: "Acme AI 新品发布",
    description:
      "推广 Acme AI：一个帮助创作者做草稿审阅、发布规划和内容协作的实用产品。",
    slogan: "更聪明地写草稿，更干净地发布。",
    hashtags: ["#AcmeAI", "#内容创作"],
    officialPost: ["https://x.com/acme/status/123"],
    contentUrl: "https://acme.example.com/launch",
    ideaStarters: [
      "展示真实 before / after 工作流。",
      "强调实际使用体验，而不是泛泛而谈 AI 概念。",
      "使用最新 launch URL。"
    ]
  },
  reviewHistory: [
    {
      id: "evt_001",
      prevStatus: "PENDING",
      newStatus: "REJECTED",
      note: "内容有点泛，缺少实际使用场景和最后的推荐导流。",
      authorKind: "brand",
      authorHandle: "brand-reviewer",
      createdAt: "2026-07-01T10:00:00.000Z"
    },
    {
      id: "evt_002",
      prevStatus: "PENDING",
      newStatus: "REVISED",
      note: "链接需要换成最新 launch URL，旧 beta 链接不要再出现。",
      authorKind: "brand",
      authorHandle: "brand-reviewer",
      createdAt: "2026-07-03T10:00:00.000Z"
    }
  ],
  openComments: [
    {
      id: "comment_001",
      anchorFrom: null,
      anchorTo: null,
      quotedText: "语气保持在同一个方向",
      status: "open",
      messages: [
        {
          id: "msg_001",
          body: "这里可以再说明一下具体如何保持语气一致。",
          authorKind: "brand",
          authorHandle: "brand-reviewer",
          createdAt: "2026-07-04T10:00:00.000Z"
        }
      ]
    }
  ],
  options: {
    language: "zh",
    maxInlineSuggestions: 4
  }
};
