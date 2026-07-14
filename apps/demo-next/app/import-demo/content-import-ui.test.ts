import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImportSource, detectImportProvider } from "./content-import-ui.ts";

test("detects supported document providers from links", () => {
  assert.equal(detectImportProvider("https://www.notion.so/team/Page-123"), "notion");
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
  const board = analyzeImportSource("https://youmind.com/boards/019ab47a-d140-7b02-ab46-9ee915a037f");
  assert.equal(board?.importable, false);
  assert.equal(board?.resourceType, "container");
  assert.equal(board?.resourceId, "019ab47a-d140-7b02-ab46-9ee915a037f");
  assert.equal(analyzeImportSource("https://youmind.com/crafts/019bc6bc-e1cc-79a2-a6fd-448b711a8895")?.importable, true);
  assert.equal(analyzeImportSource("https://docs.google.com/document/d/abc/edit")?.importable, true);
  assert.equal(analyzeImportSource("https://drive.google.com/drive/my-drive")?.importable, false);
});
