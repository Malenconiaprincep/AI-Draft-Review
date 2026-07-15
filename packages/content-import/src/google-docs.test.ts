import assert from "node:assert/strict";
import test from "node:test";
import {
  GoogleDocsConnector,
  normalizeGoogleDocument,
  normalizeGoogleMarkdownDocument,
  parseGoogleDocId
} from "./google-docs.ts";
import type { ConnectorToken, FetchLike } from "./types.ts";

const token: ConnectorToken = { accessToken: "google-access", tokenType: "bearer" };
const documentId = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

test("parses Google Docs IDs and document links", () => {
  assert.equal(parseGoogleDocId(documentId), documentId);
  assert.equal(
    parseGoogleDocId(`https://docs.google.com/document/d/${documentId}/edit?tab=t.0`),
    documentId
  );
  assert.equal(parseGoogleDocId("https://drive.google.com/file/d/not-a-doc"), undefined);
});

test("builds offline OAuth URLs and preserves refresh tokens", async () => {
  const bodies: string[] = [];
  const connector = new GoogleDocsConnector({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://tutti.example/api/connectors/google-docs/callback",
    fetch: (async (_input, init) => {
      bodies.push(String(init?.body));
      return Response.json({
        access_token: bodies.length === 1 ? "initial-access" : "refreshed-access",
        refresh_token: bodies.length === 1 ? "refresh-token" : undefined,
        expires_in: 3600,
        token_type: "Bearer"
      });
    }) as FetchLike
  });
  const auth = new URL(connector.getAuthorizationUrl("csrf-state"));
  assert.equal(auth.searchParams.get("access_type"), "offline");
  assert.equal(auth.searchParams.get("state"), "csrf-state");
  assert.equal(auth.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");

  const initial = await connector.exchangeAuthorization("code");
  const refreshed = await connector.refreshAuthorization(initial);
  assert.equal(initial.refreshToken, "refresh-token");
  assert.equal(refreshed.accessToken, "refreshed-access");
  assert.equal(refreshed.refreshToken, "refresh-token");
  assert.match(bodies[1], /grant_type=refresh_token/);
});

test("lists recent Google Docs with an optional title query", async () => {
  let requestedUrl = "";
  const connector = new GoogleDocsConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/callback",
    fetch: (async (input) => {
      requestedUrl = String(input);
      return Response.json({
        files: [{
          id: documentId,
          name: "Launch plan",
          mimeType: "application/vnd.google-apps.document",
          modifiedTime: "2026-07-13T10:00:00.000Z",
          webViewLink: `https://docs.google.com/document/d/${documentId}/edit`
        }],
        nextPageToken: "next-page"
      });
    }) as FetchLike
  });

  const page = await connector.listDocuments(token, { query: "Launch's", pageSize: 20 });
  const url = new URL(requestedUrl);
  assert.match(url.searchParams.get("q") ?? "", /mimeType/);
  assert.match(url.searchParams.get("q") ?? "", /Launch\\'s/);
  assert.equal(page.items[0]?.title, "Launch plan");
  assert.equal(page.items[0]?.provider, "googledocs");
  assert.equal(page.nextCursor, "next-page");
});

test("normalizes tabs, rich text, lists, tables and inline images", () => {
  const normalized = normalizeGoogleDocument(
    { provider: "googledocs", id: documentId, kind: "document" },
    {
      documentId,
      title: "Campaign brief",
      revisionId: "rev-7",
      tabs: [{
        tabProperties: { tabId: "tab-1", title: "Overview" },
        documentTab: {
          lists: {
            list: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } }
          },
          inlineObjects: {
            image: {
              inlineObjectProperties: {
                embeddedObject: {
                  title: "Hero",
                  imageProperties: { contentUri: "https://lh3.googleusercontent.com/hero" },
                  size: { width: { magnitude: 640 }, height: { magnitude: 360 } }
                }
              }
            }
          },
          body: {
            content: [
              { paragraph: { paragraphStyle: { namedStyleType: "HEADING_1", alignment: "CENTER" }, elements: [{ textRun: { content: "Plan\n", textStyle: { bold: true } } }] } },
              { paragraph: { paragraphStyle: { alignment: "END" }, bullet: { listId: "list" }, elements: [{ textRun: { content: "First\n" } }] } },
              { paragraph: { paragraphStyle: { alignment: "END" }, bullet: { listId: "list" }, elements: [{ textRun: { content: "Second\n" } }] } },
              { paragraph: { elements: [{ textRun: { content: "Before " } }, { inlineObjectElement: { inlineObjectId: "image" } }, { textRun: { content: " after\n" } }] } },
              { table: { tableRows: [{ tableCells: [
                { content: [{ paragraph: { elements: [{ textRun: { content: "A\n" } }] } }] },
                { content: [{ paragraph: { elements: [{ textRun: { content: "B\n" } }] } }] }
              ] }] } }
            ]
          }
        }
      }]
    },
    {
      id: documentId,
      name: "Campaign brief",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-07-13T12:00:00.000Z",
      version: "9",
      webViewLink: `https://docs.google.com/document/d/${documentId}/edit`
    }
  );

  assert.equal(normalized.revision, "rev-7");
  assert.equal(normalized.lastEditedAt, "2026-07-13T12:00:00.000Z");
  assert.equal(normalized.content[0]?.type, "heading");
  assert.equal(normalized.content[0]?.attrs?.textAlign, "center");
  assert.equal(normalized.content[1]?.type, "orderedList");
  assert.equal(normalized.content[1]?.content?.[0]?.content?.[0]?.attrs?.textAlign, "right");
  assert.equal(normalized.content.some((node) => node.type === "image"), true);
  assert.equal(normalized.content.at(-1)?.type, "table");
  assert.equal(normalized.assets[0]?.provider, "googledocs");
  assert.equal(normalized.assets[0]?.sourceUrl, "https://lh3.googleusercontent.com/hero");
});

test("normalizes exported Markdown with Drive metadata", () => {
  const normalized = normalizeGoogleMarkdownDocument(
    { provider: "googledocs", id: documentId, kind: "document" },
    "# Campaign brief\n\nBody with **bold text** and a [link](https://example.com).",
    {
      id: documentId,
      name: "Drive title",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-07-13T12:00:00.000Z",
      version: "11"
    }
  );

  assert.equal(normalized.title, "Drive title");
  assert.equal(normalized.revision, "11");
  assert.equal(normalized.content[0]?.type, "heading");
  assert.equal(normalized.content[1]?.type, "paragraph");
});

test("repairs Google Docs bold labels that touch CJK list text", () => {
  const normalized = normalizeGoogleMarkdownDocument(
    { provider: "googledocs", id: documentId, kind: "document" },
    [
      "# 基本信息",
      "",
      "- **姓名：**汪波",
      "- **联系方式：**18571654572 | [279495889@qq.com](mailto:279495889@qq.com)"
    ].join("\n"),
    { id: documentId, name: "个人简历" }
  );

  const list = normalized.content[1];
  const nameNodes = list?.content?.[0]?.content?.[0]?.content;
  const contactNodes = list?.content?.[1]?.content?.[0]?.content;

  assert.equal(list?.type, "bulletList");
  assert.equal(nameNodes?.[0]?.text, "姓名：");
  assert.deepEqual(nameNodes?.[0]?.marks?.map((mark) => mark.type), ["bold"]);
  assert.equal(nameNodes?.[1]?.text, "汪波");
  assert.equal(nameNodes?.map((node) => node.text ?? "").join(""), "姓名：汪波");
  assert.equal(contactNodes?.[0]?.text, "联系方式：");
  assert.deepEqual(contactNodes?.[0]?.marks?.map((mark) => mark.type), ["bold"]);
  assert.deepEqual(contactNodes?.at(-1)?.marks?.map((mark) => mark.type), ["link"]);
});

test("applies Google Docs inline repair to paragraphs and tables but not code blocks", () => {
  const normalized = normalizeGoogleMarkdownDocument(
    { provider: "googledocs", id: documentId, kind: "document" },
    [
      "**专业总结：**具备 10 年经验",
      "",
      "| 字段 | 内容 |",
      "| --- | --- |",
      "| 姓名 | **姓名：**汪波 |",
      "",
      "```markdown",
      "**姓名：**汪波",
      "```"
    ].join("\n"),
    { id: documentId, name: "个人简历" }
  );

  const paragraphNodes = normalized.content[0]?.content;
  const tableCellNodes = normalized.content[1]?.content?.[1]?.content?.[1]?.content?.[0]?.content;
  const codeBlock = normalized.content[2];

  assert.deepEqual(paragraphNodes?.[0]?.marks?.map((mark) => mark.type), ["bold"]);
  assert.equal(paragraphNodes?.map((node) => node.text ?? "").join(""), "专业总结：具备 10 年经验");
  assert.deepEqual(tableCellNodes?.[0]?.marks?.map((mark) => mark.type), ["bold"]);
  assert.equal(tableCellNodes?.map((node) => node.text ?? "").join(""), "姓名：汪波");
  assert.equal(codeBlock?.type, "codeBlock");
  assert.equal(codeBlock?.content?.[0]?.text, "**姓名：**汪波");
});

test("exports selected Docs as Markdown and parses it into a DraftDoc", async () => {
  const calls: string[] = [];
  const connector = new GoogleDocsConnector({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://tutti.example/callback",
    fetch: (async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/export?")) {
        return new Response("# Exported heading\n\nBody with **bold text**.", {
          headers: { "Content-Type": "text/markdown" }
        });
      }
      return Response.json({
        id: documentId,
        name: "Fetched doc",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-07-13T12:00:00.000Z",
        version: "12"
      });
    }) as FetchLike
  });

  const result = await connector.importDocument(token, documentId);
  assert.equal(result.title, "Fetched doc");
  assert.equal(result.sourceRevision, "12");
  assert.equal(result.doc.content?.[0]?.type, "heading");
  assert.equal(result.doc.content?.[0]?.content?.[0]?.text, "Exported heading");
  const exportCall = calls.find((url) => url.includes("/export?"));
  assert.equal(new URL(exportCall ?? "http://invalid").searchParams.get("mimeType"), "text/markdown");
  assert.equal(calls.some((url) => url.includes("docs.googleapis.com")), false);
});

test("imports a public Google Doc as Markdown without an access token", async () => {
  const requestedUrls: string[] = [];
  const authorizationHeaders: Array<string | null> = [];
  const connector = new GoogleDocsConnector({
    clientId: "client",
    publicDocsBaseUrl: "https://docs.example",
    fetch: (async (input, init) => {
      const requestedUrl = String(input);
      requestedUrls.push(requestedUrl);
      authorizationHeaders.push(new Headers(init?.headers).get("authorization"));
      if (new URL(requestedUrl).searchParams.get("format") === "html") {
        return new Response([
          "<style>.left{text-align:left}.right{text-align:right}</style>",
          '<p class="left">公开文档</p>',
          '<p class="right">无需授权即可读取。<br>右对齐第二行</p>'
        ].join(""), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("# 公开文档\n\n无需授权即可读取。  \n右对齐第二行", {
        headers: {
          "Content-Type": "text/x-markdown; charset=utf-8",
          "Content-Disposition": "attachment; filename*=UTF-8''%E5%85%AC%E5%BC%80%E6%96%87%E6%A1%A3.md"
        }
      });
    }) as FetchLike
  });

  const result = await connector.importPublicDocument(
    `https://docs.google.com/document/d/${documentId}/edit?tab=t.0`
  );

  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]).pathname, `/document/d/${documentId}/export`);
  assert.deepEqual(requestedUrls.map((url) => new URL(url).searchParams.get("format")), ["md", "html"]);
  assert.deepEqual(authorizationHeaders, [null, null]);
  assert.equal(result.title, "公开文档");
  assert.equal(result.doc.content?.[0]?.type, "heading");
  assert.equal(result.doc.content?.[0]?.attrs?.textAlign, "left");
  assert.equal(result.doc.content?.[1]?.attrs?.textAlign, "right");
  assert.equal(result.sourceRevision, undefined);
});

test("requires authorization when anonymous Google Docs export returns HTML", async () => {
  const connector = new GoogleDocsConnector({
    clientId: "client",
    fetch: (async () => new Response("<html>Sign in</html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    })) as FetchLike
  });

  await assert.rejects(
    connector.importPublicDocument(documentId),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "access_denied"
    )
  );
});

test("falls back to Docs API when Markdown export is unavailable", async () => {
  const calls: string[] = [];
  const connector = new GoogleDocsConnector({
    clientId: "client",
    fetch: (async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/export?")) return Response.json({ error: "export failed" }, { status: 500 });
      if (url.includes("docs.googleapis.com")) {
        return Response.json({
          documentId,
          title: "Fallback doc",
          revisionId: "docs-revision",
          body: { content: [{ paragraph: { elements: [{ textRun: { content: "Fallback body\n" } }] } }] }
        });
      }
      return Response.json({
        id: documentId,
        name: "Fallback doc",
        mimeType: "application/vnd.google-apps.document"
      });
    }) as FetchLike
  });

  const result = await connector.importDocument(token, documentId);
  assert.equal(result.doc.content?.[0]?.content?.[0]?.text, "Fallback body");
  assert.equal(result.warnings[0]?.code, "format_downgraded");
  assert.equal(calls.some((url) => url.includes("includeTabsContent=true")), true);
});
