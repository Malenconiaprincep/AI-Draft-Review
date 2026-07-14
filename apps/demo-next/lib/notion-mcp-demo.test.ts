import assert from "node:assert/strict";
import test from "node:test";
import { isNotionBrowserSessionPersistenceAvailable } from "./notion-browser-persistence.ts";

test("browser session persistence stays off in production unless explicitly enabled", () => {
  assert.equal(isNotionBrowserSessionPersistenceAvailable({
    NODE_ENV: "production",
    NOTION_DEV_LOCAL_STORAGE: "true"
  }), false);

  assert.equal(isNotionBrowserSessionPersistenceAvailable({
    NODE_ENV: "production",
    NOTION_BROWSER_SESSION_PERSISTENCE: "true"
  }), true);

  assert.equal(isNotionBrowserSessionPersistenceAvailable({
    NODE_ENV: "production",
    NOTION_BROWSER_SESSION_PERSISTENCE: "false",
    NOTION_DEV_LOCAL_STORAGE: "true"
  }), false);
});
