import assert from "node:assert/strict";
import test from "node:test";
import { isBrowserSessionPersistenceAvailable } from "./browser-session-persistence.ts";

test("browser session persistence stays off in production unless explicitly enabled", () => {
  assert.equal(isBrowserSessionPersistenceAvailable({
    NODE_ENV: "production",
    NOTION_DEV_LOCAL_STORAGE: "true"
  }), false);

  assert.equal(isBrowserSessionPersistenceAvailable({
    NODE_ENV: "production",
    BROWSER_SESSION_PERSISTENCE: "true"
  }), true);

  assert.equal(isBrowserSessionPersistenceAvailable({
    NODE_ENV: "production",
    BROWSER_SESSION_PERSISTENCE: "false",
    NOTION_BROWSER_SESSION_PERSISTENCE: "true"
  }), false);
});

test("the former Notion production flag remains a compatibility fallback", () => {
  assert.equal(isBrowserSessionPersistenceAvailable({
    NODE_ENV: "production",
    NOTION_BROWSER_SESSION_PERSISTENCE: "1"
  }), true);
});
