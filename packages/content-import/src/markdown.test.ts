import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDocumentToDraftDoc } from "./canonical.ts";
import { googleDocsMarkdownAdapter } from "./google-docs-markdown-adapter.ts";
import { parseMarkdownToCanonical } from "./markdown.ts";
import { notionMarkdownAdapter } from "./notion-markdown-adapter.ts";

test("parses markdown structure, marks, tables and images", () => {
  const parsed = parseMarkdownToCanonical(
    [
      "# Campaign draft",
      "",
      "Hello **bold** and [Tutti](https://tutti.example).",
      "",
      "- one",
      "- two",
      "",
      "| Key | Value |",
      "| --- | --- |",
      "| CTA | Join |",
      "",
      "![cover](https://cdn.example/cover.png)"
    ].join("\n"),
    "notion",
    notionMarkdownAdapter
  );

  const result = canonicalDocumentToDraftDoc({
    ref: { provider: "notion", id: "page", kind: "page" },
    title: "Campaign draft",
    content: parsed.content,
    assets: parsed.assets,
    warnings: parsed.warnings
  });

  assert.equal(result.doc.content?.[0]?.type, "heading");
  assert.equal(result.doc.content?.some((node) => node.type === "bulletList"), true);
  assert.equal(result.doc.content?.some((node) => node.type === "table"), true);
  assert.equal(result.doc.content?.at(-1)?.type, "image");
  assert.equal(result.assets.length, 1);
  assert.match(String(result.doc.content?.at(-1)?.attrs?.src), /^tutti-import:/);

  const paragraph = result.doc.content?.find((node) => node.type === "paragraph");
  const bold = paragraph?.content?.find((node) => node.text === "bold");
  assert.deepEqual(bold?.marks?.map((mark) => mark.type), ["bold"]);
});

test("clamps imported heading levels to the Tutti schema", () => {
  const parsed = parseMarkdownToCanonical("##### Deep heading", "notion", notionMarkdownAdapter);
  const result = canonicalDocumentToDraftDoc({
    ref: { provider: "notion", id: "page", kind: "page" },
    title: "Deep",
    content: parsed.content,
    assets: [],
    warnings: []
  });

  assert.equal(result.doc.content?.[0]?.attrs?.level, 3);
});

test("supports Notion enhanced markdown media and HTML tables", () => {
  const parsed = parseMarkdownToCanonical(
    [
      '<video src="https://files.notion.example/demo.mp4">Demo</video>',
      "",
      '<audio src="https://files.notion.example/demo.mp3">Podcast</audio>',
      "",
      '<file src="https://files.notion.example/brief.docx">Brief</file>',
      "",
      '<table header-row="true"><tr><td>Name</td><td>Value</td></tr><tr><td>CTA</td><td>Join</td></tr></table>'
    ].join("\n"),
    "notion",
    notionMarkdownAdapter
  );

  assert.deepEqual(parsed.content.map((node) => node.type), ["video", "audio", "paragraph", "table"]);
  assert.deepEqual(parsed.assets.map((asset) => asset.kind), ["video", "audio", "file"]);
  assert.equal(parsed.content[3].content?.[0]?.content?.[0]?.type, "tableHeader");
});

test("keeps platform-specific inline repair out of the shared parser", () => {
  const markdown = "- **姓名：**汪波";
  const shared = parseMarkdownToCanonical(markdown, "googledocs");
  const adapted = parseMarkdownToCanonical(markdown, "googledocs", googleDocsMarkdownAdapter);

  const sharedNodes = shared.content[0]?.content?.[0]?.content?.[0]?.content;
  const adaptedNodes = adapted.content[0]?.content?.[0]?.content?.[0]?.content;

  assert.equal(sharedNodes?.map((node) => node.text ?? "").join(""), "**姓名：**汪波");
  assert.equal(sharedNodes?.some((node) => node.marks?.some((mark) => mark.type === "bold")), false);
  assert.equal(adaptedNodes?.map((node) => node.text ?? "").join(""), "姓名：汪波");
  assert.deepEqual(adaptedNodes?.[0]?.marks?.map((mark) => mark.type), ["bold"]);
});
