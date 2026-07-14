import assert from "node:assert/strict";
import test from "node:test";
import { adaptNotionEnhancedMarkdown, notionMcpFetchResultToImport } from "./notion-mcp.ts";

test("converts a JSON notion-fetch response into a Tutti import", () => {
  const result = notionMcpFetchResultToImport(
    {
      content: [{
        type: "text",
        text: JSON.stringify({
          title: "MCP Campaign",
          url: "https://www.notion.so/MCP-Campaign-b55c9c91384d452b81dbd1ef79372b75",
          text: "# MCP Campaign\n\nHello **Tutti**.\n\n- One\n- Two"
        })
      }]
    },
    "https://www.notion.so/MCP-Campaign-b55c9c91384d452b81dbd1ef79372b75"
  );

  assert.equal(result.title, "MCP Campaign");
  assert.equal(result.source.id, "b55c9c91-384d-452b-81db-d1ef79372b75");
  assert.equal(result.doc.content?.[0]?.type, "heading");
  assert.equal(result.doc.content?.[2]?.type, "bulletList");
});

test("unwraps tagged Notion MCP content and extracts its title", () => {
  const result = notionMcpFetchResultToImport(
    {
      content: [{
        type: "text",
        text: '<page><properties>{"title":"Tagged page"}</properties><content>## Section\n\nBody</content></page>'
      }]
    },
    "b55c9c91384d452b81dbd1ef79372b75"
  );

  assert.equal(result.title, "Tagged page");
  assert.equal(result.doc.content?.[0]?.type, "heading");
});

test("converts the official structured notion-fetch payload", () => {
  const result = notionMcpFetchResultToImport(
    {
      structuredContent: {
        metadata: { type: "page" },
        title: "tutti 出海",
        url: "https://app.notion.com/p/393991efa9c880469903ff8408ba23cc",
        text: [
          '<page url="https://app.notion.com/p/393991efa9c880469903ff8408ba23cc">',
          '<properties>{"title":"tutti 出海"}</properties>',
          "<content>",
          "沟通细节：",
          "### 周一问题",
          "1. 第一版最优先解决的是什么？",
          "2. 现有编辑器是什么技术栈？",
          "</content>",
          "</page>"
        ].join("\n")
      }
    },
    "https://app.notion.com/p/393991efa9c880469903ff8408ba23cc"
  );

  assert.equal(result.title, "tutti 出海");
  assert.equal(result.source.id, "393991ef-a9c8-8046-9903-ff8408ba23cc");
  assert.equal(result.doc.content?.some((node) => node.type === "heading"), true);
  assert.equal(result.doc.content?.some((node) => node.type === "orderedList"), true);
});

test("adapts Notion enhanced markdown before generic parsing", () => {
  const adapted = adaptNotionEnhancedMarkdown([
    "# Project kickoff {toggle=\"true\" color=\"blue\"}",
    "\tChild paragraph",
    "- [x] Write spec {color=\"green\"}",
    "- [ ] Build prototype",
    '<mention-date start="2026-07-13" startTime="10:00"/>',
    '<unknown url="https://notion.so/block" alt="bookmark"/>',
    "<empty-block/>"
  ].join("\n"));

  assert.equal(adapted.markdown.includes("{toggle="), false);
  assert.equal(adapted.markdown.includes("{color="), false);
  assert.equal(adapted.markdown.includes("☑ Write spec"), true);
  assert.equal(adapted.markdown.includes("☐ Build prototype"), true);
  assert.equal(adapted.markdown.includes("2026-07-13 10:00"), true);
  assert.equal(adapted.markdown.includes("[Notion bookmark](https://notion.so/block)"), true);
  assert.equal(adapted.warnings[0]?.code, "unsupported_block");
});

test("preserves Notion soft line breaks as hard breaks", () => {
  const result = notionMcpFetchResultToImport(
    {
      structuredContent: {
        title: "Line breaks",
        url: "https://app.notion.com/p/b55c9c91384d452b81dbd1ef79372b75",
        text: "<content>first block\nsecond block</content>"
      }
    },
    "b55c9c91384d452b81dbd1ef79372b75"
  );

  const paragraph = result.doc.content?.[0];
  assert.equal(paragraph?.type, "paragraph");
  assert.equal(paragraph?.content?.some((node) => node.type === "hardBreak"), true);
});

test("preserves fenced code language, indentation and blank lines", () => {
  const code = [
    "type User = { id: string; name: string }",
    "",
    "function greet(u: User) {",
    "  // TODO: preserve language, indentation and blank lines",
    "  console.log(`hello, ${u.name}`)",
    "}",
    "",
    'greet({ id: "1", name: "Alice" })'
  ].join("\n");
  const result = notionMcpFetchResultToImport(
    {
      structuredContent: {
        title: "Code blocks",
        text: `<content>## Code\n\n\`\`\`typescript\n${code}\n\`\`\`</content>`
      }
    },
    "b55c9c91384d452b81dbd1ef79372b75"
  );

  const codeBlock = result.doc.content?.find((node) => node.type === "codeBlock");
  assert.equal(codeBlock?.attrs?.language, "typescript");
  assert.equal(codeBlock?.content?.[0]?.text, code);
});

test("repairs Markdown structure escaped inside Notion text blocks", () => {
  const result = notionMcpFetchResultToImport(
    {
      structuredContent: {
        title: "Escaped article",
        url: "https://app.notion.com/p/b55c9c91384d452b81dbd1ef79372b75",
        text: [
          "<content>",
          "Mirror版：",
          "\\---",
          "正文介绍。",
          "\\# 1. 明确你的处境与目标",
          "第一节正文。",
          "\\## 2.1 词汇量",
          "第二节正文。",
          "\\- 列表项",
          "\\> 引用内容",
          "\\!\\[配图\\]\\(https://files.notion.example/preview.png\\)",
          "</content>"
        ].join("\n")
      }
    },
    "b55c9c91384d452b81dbd1ef79372b75"
  );

  const nodes = result.doc.content ?? [];
  assert.equal(nodes.some((node) => node.type === "horizontalRule"), true);
  assert.equal(nodes.some((node) => node.type === "heading" && node.attrs?.level === 1), true);
  assert.equal(nodes.some((node) => node.type === "heading" && node.attrs?.level === 2), true);
  assert.equal(nodes.some((node) => node.type === "bulletList"), true);
  assert.equal(nodes.some((node) => node.type === "blockquote"), true);
  assert.equal(nodes.some((node) => node.type === "image"), true);
  assert.equal(result.assets[0]?.sourceUrl, "https://files.notion.example/preview.png");
  assert.equal(JSON.stringify(result.doc).includes('"text":"# 1.'), false);
});

test("repairs HTML-escaped Notion quote markers", () => {
  const result = notionMcpFetchResultToImport(
    {
      structuredContent: {
        title: "Quote",
        text: "<content>正文\n&gt; 本文面向需要提升英语的人。\n下一段</content>"
      }
    },
    "b55c9c91384d452b81dbd1ef79372b75"
  );

  assert.equal(result.doc.content?.some((node) => node.type === "blockquote"), true);
});

test("keeps content after HTML tables and preserves Notion list indentation", () => {
  const result = notionMcpFetchResultToImport(
    {
      structuredContent: {
        title: "Nested content",
        text: [
          "<content>",
          "<table>",
          "<tr><td>Cell</td></tr>",
          "</table>",
          "<empty-block/>",
          "- Goal",
          "\t-",
          "\t\t1. First action",
          "\t-",
          "\t\t1. Second action",
          "Tail paragraph",
          "</content>"
        ].join("\n")
      }
    },
    "04cd4992105f414b8680c2f1b03a0798"
  );

  const nodes = result.doc.content ?? [];
  const tableIndex = nodes.findIndex((node) => node.type === "table");
  const listIndex = nodes.findIndex((node) => node.type === "bulletList");
  assert.equal(tableIndex >= 0, true);
  assert.equal(listIndex > tableIndex, true);
  assert.equal(JSON.stringify(nodes[listIndex]).includes('"type":"orderedList"'), true);
  assert.equal(JSON.stringify(result.doc).includes("First action"), true);
  assert.equal(JSON.stringify(result.doc).includes("Second action"), true);
  assert.equal(JSON.stringify(result.doc).includes("Tail paragraph"), true);
});

test("preserves Notion columns and parses indented column images", () => {
  const result = notionMcpFetchResultToImport(
    {
      structuredContent: {
        title: "Column report",
        text: [
          "<content>",
          "<columns>",
          "\t<column>",
          "\t\tLeft summary",
          "\t\t![Left chart](https://files.example/left.png)",
          "\t\t<empty-block/>",
          "\t</column>",
          "\t<column>",
          "\t\tRight summary",
          "\t\t![](https://files.example/right.png)",
          "\t\t<empty-block/>",
          "\t</column>",
          "</columns>",
          "</content>"
        ].join("\n")
      }
    },
    "27e30d7653af42228c3f016b0b78b1a3"
  );

  const columns = result.doc.content?.find((node) => node.type === "columns");
  assert.equal(columns?.attrs?.count, 2);
  assert.deepEqual(columns?.content?.map((node) => node.type), ["column", "column"]);
  assert.equal(result.assets.length, 2);
  assert.equal(JSON.stringify(columns).includes('"type":"image"'), true);
  assert.equal(JSON.stringify(columns).includes("![]("), false);
});
