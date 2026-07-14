import assert from "node:assert/strict";
import test from "node:test";
import { NotionConnector, parseNotionPageId } from "./notion.ts";
import type { ConnectorToken, FetchLike } from "./types.ts";

const token: ConnectorToken = { accessToken: "notion-access", tokenType: "bearer" };

test("parses common Notion page URLs and IDs", () => {
  assert.equal(
    parseNotionPageId("https://www.notion.so/team/Campaign-Draft-b55c9c91384d452b81dbd1ef79372b75?pvs=4"),
    "b55c9c91-384d-452b-81db-d1ef79372b75"
  );
  assert.equal(
    parseNotionPageId("b55c9c91-384d-452b-81db-d1ef79372b75"),
    "b55c9c91-384d-452b-81db-d1ef79372b75"
  );
  assert.equal(parseNotionPageId("https://example.com/not-a-notion-page"), undefined);
});

test("builds OAuth URL and exchanges the authorization code", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const connector = new NotionConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/oauth/notion",
    fetch: (async (url, init) => {
      captured = { url: String(url), init };
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        bot_id: "bot",
        workspace_id: "workspace",
        workspace_name: "Tutti"
      });
    }) as FetchLike
  });

  const authorizationUrl = new URL(connector.getAuthorizationUrl("csrf"));
  assert.equal(authorizationUrl.searchParams.get("state"), "csrf");
  assert.equal(authorizationUrl.searchParams.get("owner"), "user");

  const result = await connector.exchangeAuthorization("code");
  assert.equal(result.refreshToken, "refresh");
  assert.match(String(captured?.init?.headers && new Headers(captured.init.headers).get("Authorization")), /^Basic /);
  assert.match(String(captured?.init?.body), /authorization_code/);
});

test("fetches Notion markdown subtrees and returns a DraftDoc import", async () => {
  const unknownId = "11111111-2222-3333-4444-555555555555";
  const fetchMock = (async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/pages/b55c9c91-384d-452b-81db-d1ef79372b75")) {
      return Response.json({
        id: "b55c9c91-384d-452b-81db-d1ef79372b75",
        url: "https://notion.so/page",
        last_edited_time: "2026-07-13T08:00:00.000Z",
        properties: {
          title: { type: "title", title: [{ plain_text: "Campaign" }] }
        }
      });
    }
    if (url.endsWith("/v1/pages/b55c9c91-384d-452b-81db-d1ef79372b75/markdown")) {
      return Response.json({
        id: "root",
        markdown: `# Campaign\n\nIntro\n\n<unknown url="https://notion.so/page#${unknownId}"/>`,
        truncated: true,
        unknown_block_ids: [unknownId]
      });
    }
    if (url.endsWith(`/v1/pages/${unknownId}/markdown`)) {
      return Response.json({
        id: unknownId,
        markdown: "## Details\n\n![hero](https://files.notion.example/hero.png)",
        truncated: false,
        unknown_block_ids: []
      });
    }
    return Response.json({ message: "missing" }, { status: 404 });
  }) as FetchLike;

  const connector = new NotionConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/oauth/notion",
    fetch: fetchMock
  });
  const result = await connector.importDocument(
    token,
    "https://www.notion.so/Campaign-b55c9c91384d452b81dbd1ef79372b75"
  );

  assert.equal(result.title, "Campaign");
  assert.equal(result.sourceRevision, "2026-07-13T08:00:00.000Z");
  assert.equal(result.doc.content?.filter((node) => node.type === "heading").length, 2);
  assert.equal(result.assets.length, 1);
  assert.equal(result.warnings.some((warning) => warning.code === "partial_document"), false);
});
