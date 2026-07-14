import assert from "node:assert/strict";
import test from "node:test";
import { FeishuConnector, normalizeFeishuBlocks } from "./feishu.ts";
import type { ConnectorToken, FetchLike } from "./types.ts";

const token: ConnectorToken = { accessToken: "feishu-access", tokenType: "bearer" };

test("resolves Feishu docx and wiki URLs", () => {
  const connector = new FeishuConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/oauth/feishu"
  });
  assert.deepEqual(connector.resolveDocument("https://acme.feishu.cn/docx/doxcnDocumentToken"), {
    provider: "feishu",
    id: "doxcnDocumentToken",
    kind: "docx",
    url: "https://acme.feishu.cn/docx/doxcnDocumentToken"
  });
  assert.equal(
    connector.resolveDocument("https://acme.feishu.cn/wiki/wikcnWikiToken").kind,
    "wiki"
  );
});

test("normalizes Feishu block trees, rich text, lists, tables and assets", () => {
  const result = normalizeFeishuBlocks(
    { provider: "feishu", id: "doc", kind: "docx" },
    { document_id: "doc", revision_id: 42, title: "Campaign" },
    [
      { block_id: "doc", block_type: 1, children: ["h", "p", "b1", "b2", "table", "img"] },
      { block_id: "h", parent_id: "doc", block_type: 5, heading3: { elements: [{ text_run: { content: "Plan" } }] } },
      {
        block_id: "p",
        parent_id: "doc",
        block_type: 2,
        text: {
          elements: [
            { text_run: { content: "Bold", text_element_style: { bold: true } } },
            { text_run: { content: " link", text_element_style: { link: { url: "https%3A%2F%2Ftutti.example" } } } }
          ]
        }
      },
      { block_id: "b1", parent_id: "doc", block_type: 12, bullet: { elements: [{ text_run: { content: "One" } }] } },
      { block_id: "b2", parent_id: "doc", block_type: 12, bullet: { elements: [{ text_run: { content: "Two" } }] } },
      {
        block_id: "table",
        parent_id: "doc",
        block_type: 31,
        table: { cells: ["c1", "c2"], property: { row_size: 1, column_size: 2 } }
      },
      { block_id: "c1", parent_id: "table", block_type: 32, children: ["ct1"] },
      { block_id: "c2", parent_id: "table", block_type: 32, children: ["ct2"] },
      { block_id: "ct1", parent_id: "c1", block_type: 2, text: { elements: [{ text_run: { content: "A" } }] } },
      { block_id: "ct2", parent_id: "c2", block_type: 2, text: { elements: [{ text_run: { content: "B" } }] } },
      { block_id: "img", parent_id: "doc", block_type: 27, image: { token: "image-token", width: 640, height: 480 } }
    ]
  );

  assert.equal(result.revision, "42");
  assert.equal(result.content[0].type, "heading");
  assert.equal(result.content[2].type, "bulletList");
  assert.equal(result.content[3].type, "table");
  assert.equal(result.assets[0].providerToken, "image-token");
  assert.equal(result.warnings.length, 0);
});

test("uses OAuth, resolves wiki nodes and paginates block reads", async () => {
  const requests: string[] = [];
  const fetchMock = (async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/wiki/v2/spaces/get_node")) {
      return Response.json({ code: 0, data: { node: { obj_token: "docx-token", obj_type: "docx" } } });
    }
    if (url.endsWith("/docx/v1/documents/docx-token")) {
      return Response.json({ code: 0, data: { document: { document_id: "docx-token", revision_id: 7, title: "Wiki doc" } } });
    }
    if (url.includes("/docx/v1/documents/docx-token/blocks")) {
      const page = new URL(url).searchParams.get("page_token");
      return page
        ? Response.json({ code: 0, data: { items: [{ block_id: "p", parent_id: "docx-token", block_type: 2, text: { elements: [{ text_run: { content: "Body" } }] } }], has_more: false } })
        : Response.json({ code: 0, data: { items: [{ block_id: "docx-token", block_type: 1, children: ["p"] }], has_more: true, page_token: "next" } });
    }
    return Response.json({ code: 0, data: {} });
  }) as FetchLike;

  const connector = new FeishuConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/oauth/feishu",
    fetch: fetchMock
  });
  const result = await connector.importDocument(token, "https://acme.feishu.cn/wiki/wikcnWikiToken");

  assert.equal(result.title, "Wiki doc");
  assert.equal(result.doc.content?.[0]?.content?.[0]?.text, "Body");
  assert.equal(requests.some((url) => url.includes("page_token=next")), true);

  const auth = new URL(connector.getAuthorizationUrl("csrf"));
  assert.equal(auth.searchParams.get("state"), "csrf");
  assert.match(auth.searchParams.get("scope") ?? "", /offline_access/);
});

test("exchanges and refreshes v2 OAuth tokens with rotating refresh expiry", async () => {
  const bodies: Array<Record<string, string>> = [];
  const fetchMock = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, string>);
    return Response.json({
      code: 0,
      access_token: bodies.length === 1 ? "initial-access" : "refreshed-access",
      expires_in: 7200,
      refresh_token: bodies.length === 1 ? "initial-refresh" : "rotated-refresh",
      refresh_token_expires_in: 604800,
      scope: "docx:document:readonly offline_access",
      token_type: "Bearer"
    });
  }) as FetchLike;
  const connector = new FeishuConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/oauth/feishu",
    fetch: fetchMock
  });

  const initial = await connector.exchangeAuthorization("authorization-code");
  const refreshed = await connector.refreshAuthorization(initial);

  assert.equal(initial.accessToken, "initial-access");
  assert.equal(initial.refreshToken, "initial-refresh");
  assert.ok(initial.refreshExpiresAt);
  assert.equal(refreshed.accessToken, "refreshed-access");
  assert.equal(refreshed.refreshToken, "rotated-refresh");
  assert.equal(bodies[1].grant_type, "refresh_token");
  assert.equal(bodies[1].refresh_token, "initial-refresh");
});
