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
  assert.equal(
    parseNotionPageId("https://app.notion.com/p/1ac3d509366b401d935995cdbf98c4b3?source=copy_link"),
    "1ac3d509-366b-401d-9359-95cdbf98c4b3"
  );
  assert.equal(parseNotionPageId("https://example.com/not-a-notion-page"), undefined);
});

test("imports an app.notion.com public page without a Notion token", async () => {
  const pageId = "1ac3d509-366b-401d-9359-95cdbf98c4b3";
  const headingId = "11111111-2222-3333-4444-555555555555";
  const paragraphId = "22222222-3333-4444-5555-666666666666";
  const listId = "33333333-4444-5555-6666-777777777777";
  const imageId = "44444444-5555-6666-7777-888888888888";
  const collectionId = "55555555-6666-7777-8888-999999999999";
  let captured: { url: string; init?: RequestInit } | undefined;
  const connector = new NotionConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/oauth/notion",
    publicApiBaseUrl: "https://public.notion.test",
    fetch: (async (input, init) => {
      captured = { url: String(input), init };
      return Response.json({
        recordMap: {
          block: {
            [pageId]: {
              value: {
                value: {
                  id: pageId,
                  type: "page",
                  alive: true,
                  last_edited_time: 1784103653823,
                  properties: { title: [["人才"]] },
                  content: [headingId, paragraphId, listId, imageId, collectionId]
                },
                role: "reader"
              }
            },
            [headingId]: {
              value: { value: { id: headingId, type: "header", properties: { title: [["公开说明"]] } } }
            },
            [paragraphId]: {
              value: {
                value: {
                  id: paragraphId,
                  type: "text",
                  properties: {
                    title: [["访问 "], ["Tutti", [["b"], ["a", "https://tutti.example"]]]]
                  }
                }
              }
            },
            [listId]: {
              value: { value: { id: listId, type: "bulleted_list", properties: { title: [["第一项"]] } } }
            },
            [imageId]: {
              value: {
                value: {
                  id: imageId,
                  type: "image",
                  properties: {
                    source: [["https://files.notion.example/public.png"]],
                    caption: [["公开配图"]]
                  }
                }
              }
            },
            [collectionId]: {
              value: {
                value: {
                  id: collectionId,
                  type: "collection_view_page",
                  properties: { title: [["人才数据库"]] }
                }
              }
            }
          }
        }
      });
    }) as FetchLike
  });

  const result = await connector.importPublicDocument(
    `https://app.notion.com/p/${pageId.replace(/-/g, "")}?source=copy_link`
  );

  assert.equal(captured?.url, "https://public.notion.test/api/v3/loadCachedPageChunk");
  assert.equal(JSON.parse(String(captured?.init?.body)).pageId, pageId);
  assert.equal(result.title, "人才");
  assert.equal(result.sourceRevision, "2026-07-15T08:20:53.823Z");
  assert.equal(result.doc.content?.some((node) => node.type === "heading"), true);
  assert.equal(result.doc.content?.some((node) => node.type === "bulletList"), true);
  assert.equal(result.assets[0]?.sourceUrl, "https://files.notion.example/public.png");
  assert.equal(result.warnings.some((warning) => warning.code === "unsupported_block"), true);
  assert.equal(result.warnings.some((warning) => warning.code === "format_downgraded"), true);
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
