import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImportSource, detectImportProvider } from "./content-import-ui.ts";

test("detects supported document providers from links", () => {
  assert.equal(detectImportProvider("https://www.notion.so/team/Page-123"), "notion");
  assert.equal(
    detectImportProvider("https://app.notion.com/p/1ac3d509366b401d935995cdbf98c4b3?source=copy_link"),
    "notion"
  );
  assert.equal(detectImportProvider("docs.feishu.cn/docx/abc"), "feishu");
  assert.equal(detectImportProvider("https://app.youmind.com/boards/board/files/file"), "youmind");
  assert.equal(detectImportProvider("https://docs.google.com/document/d/abc/edit"), "googledocs");
});

test("does not match lookalike or unsupported links", () => {
  assert.equal(detectImportProvider("https://notion.so.example.com/page"), null);
  assert.equal(detectImportProvider("https://example.com/document"), null);
  assert.equal(detectImportProvider("not a link"), null);
});

test("distinguishes importable documents from workspace links", () => {
  const publicNotion = analyzeImportSource(
    "https://app.notion.com/p/1ac3d509366b401d935995cdbf98c4b3?source=copy_link"
  );
  assert.equal(publicNotion?.importable, true);
  assert.equal(publicNotion?.publicImportSupported, true);
  assert.equal(publicNotion?.resourceLabel, "Notion 公开页面");
  const board = analyzeImportSource("https://youmind.com/boards/019ab47a-d140-7b02-ab46-9ee915a037f");
  assert.equal(board?.importable, false);
  assert.equal(board?.resourceType, "container");
  assert.equal(board?.resourceId, "019ab47a-d140-7b02-ab46-9ee915a037f");
  assert.equal(analyzeImportSource("https://youmind.com/crafts/019bc6bc-e1cc-79a2-a6fd-448b711a8895")?.importable, true);
  const publicShare = analyzeImportSource("https://youmind.com/s/fGHbM9Si7QKJlJ");
  assert.equal(publicShare?.importable, true);
  assert.equal(publicShare?.publicImportSupported, true);
  assert.equal(publicShare?.resourceId, "fGHbM9Si7QKJlJ");
  const publicFeishu = analyzeImportSource(
    "https://j8luzjm9ir.feishu.cn/docx/G45Sdeoino8s6JxLQiecn5Vqnpe?from=from_copylink"
  );
  assert.equal(publicFeishu?.importable, true);
  assert.equal(publicFeishu?.publicImportSupported, true);
  assert.equal(publicFeishu?.message, "链接有效，将使用只读应用身份读取外部公开内容。");
  assert.equal(analyzeImportSource("https://docs.google.com/document/d/abc/edit")?.importable, true);
  assert.equal(analyzeImportSource("https://drive.google.com/drive/my-drive")?.importable, false);
});

test("accepts the public links shown in the demo test panel", () => {
  const testLinks = [
    "https://app.notion.com/p/16cb65e572f48049b4dff0a5010a637d?source=copy_link",
    "https://j8luzjm9ir.feishu.cn/docx/G45Sdeoino8s6JxLQiecn5Vqnpe?from=from_copylink",
    "https://youmind.com/s/fGHbM9Si7QKJlJ",
    "https://docs.google.com/document/d/1y8KA-crwQsiXhpHL15rGppxWPUz0drtm/edit#bookmark=id.3u3pai97xq0r"
  ];

  for (const link of testLinks) {
    assert.equal(analyzeImportSource(link)?.importable, true, link);
  }
});
