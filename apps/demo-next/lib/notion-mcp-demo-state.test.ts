import assert from "node:assert/strict";
import test from "node:test";
import {
  getNotionMcpConnection,
  NOTION_MCP_SESSION_COOKIE,
  NOTION_MCP_STATE_COOKIE
} from "./notion-mcp-demo.ts";
import { encodeNotionMcpSessionCookie } from "./notion-mcp-session-cookie.ts";

test("connection lookup rehydrates a connected session when the server instance has no memory", () => {
  const sessionId = "fresh-serverless-instance-session";
  const requestUrl = "https://tutti.example/api/content-import/preview";
  const state = encodeNotionMcpSessionCookie({
    id: sessionId,
    state: "c".repeat(64),
    redirectUrl: "https://tutti.example/api/connectors/notion/callback",
    expiresAt: Date.now() + 60_000,
    clientInformation: { client_id: "dynamic-client" },
    tokens: { access_token: "access", refresh_token: "refresh", token_type: "bearer" },
    accountName: "Recovered workspace"
  });
  const request = new Request(requestUrl, {
    headers: {
      cookie: `${NOTION_MCP_SESSION_COOKIE}=${sessionId}; ${NOTION_MCP_STATE_COOKIE}=${state}`
    }
  });

  assert.deepEqual(getNotionMcpConnection(request), {
    connected: true,
    accountName: "Recovered workspace",
    accountId: undefined
  });
});
