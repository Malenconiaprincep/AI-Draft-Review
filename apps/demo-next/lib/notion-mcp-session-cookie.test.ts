import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeNotionMcpSessionCookie,
  encodeNotionMcpSessionCookie,
  mergeNotionMcpTokens
} from "./notion-mcp-session-cookie.ts";

const redirectUrl = "https://tutti.example/api/connectors/notion/callback";

test("restores a Notion MCP session from the HttpOnly cookie after server memory is lost", () => {
  const encoded = encodeNotionMcpSessionCookie({
    id: "session-id",
    state: "a".repeat(64),
    redirectUrl,
    expiresAt: 2_000,
    codeVerifier: "pkce-verifier",
    clientInformation: { client_id: "dynamic-client" },
    tokens: { access_token: "access", refresh_token: "refresh", token_type: "bearer" },
    accountName: "Workspace"
  });

  assert.deepEqual(decodeNotionMcpSessionCookie(encoded, redirectUrl, 1_000), {
    id: "session-id",
    state: "a".repeat(64),
    redirectUrl,
    expiresAt: 2_000,
    codeVerifier: "pkce-verifier",
    clientInformation: { client_id: "dynamic-client" },
    tokens: { access_token: "access", refresh_token: "refresh", token_type: "bearer" },
    accountName: "Workspace",
    accountId: undefined
  });
});

test("rejects expired sessions and sessions issued for another callback origin", () => {
  const encoded = encodeNotionMcpSessionCookie({
    id: "session-id",
    state: "b".repeat(64),
    redirectUrl,
    expiresAt: 2_000
  });

  assert.equal(decodeNotionMcpSessionCookie(encoded, redirectUrl, 2_000), undefined);
  assert.equal(
    decodeNotionMcpSessionCookie(
      encoded,
      "https://attacker.example/api/connectors/notion/callback",
      1_000
    ),
    undefined
  );
});

test("keeps the rotating refresh token when Notion omits it from a refresh response", () => {
  assert.deepEqual(
    mergeNotionMcpTokens(
      { access_token: "old-access", refresh_token: "refresh", token_type: "bearer" },
      { access_token: "new-access", token_type: "bearer" }
    ),
    { access_token: "new-access", refresh_token: "refresh", token_type: "bearer" }
  );
});
