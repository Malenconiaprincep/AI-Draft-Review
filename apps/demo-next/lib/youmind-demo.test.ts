import assert from "node:assert/strict";
import test from "node:test";
import { getYouMindConnection, getYouMindToken, isYouMindArticleKind } from "./youmind-demo.ts";

test("a configured server key still requires an explicit YouMind session", () => {
  const previousApiKey = process.env.YOUMIND_IMPORT_API_KEY;
  process.env.YOUMIND_IMPORT_API_KEY = "sk-ym-configured-test-key";

  try {
    const request = new Request("http://localhost/import-demo");
    assert.deepEqual(getYouMindConnection(request), {
      available: true,
      connected: false,
      accountName: undefined,
      mode: "server-key",
      settingsUrl: "https://youmind.com/settings/api-keys"
    });
    assert.throws(() => getYouMindToken(request), /请先连接 YouMind API Key/);
  } finally {
    if (previousApiKey === undefined) delete process.env.YOUMIND_IMPORT_API_KEY;
    else process.env.YOUMIND_IMPORT_API_KEY = previousApiKey;
  }
});

test("identifies YouMind article files", () => {
  assert.equal(isYouMindArticleKind("article"), true);
  assert.equal(isYouMindArticleKind(" ARTICLE "), true);
  assert.equal(isYouMindArticleKind("document"), false);
  assert.equal(isYouMindArticleKind("video"), false);
  assert.equal(isYouMindArticleKind("group"), false);
});
