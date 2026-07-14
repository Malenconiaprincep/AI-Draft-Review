import {
  ConnectorError,
  createFeishuConnector,
  createGoogleDocsConnector,
  createNotionConnector,
  createYouMindConnector,
  feishuMcpFetchResultToImport,
  importConnectedDocument,
  notionMcpFetchResultToImport,
  type ContentImportResult,
  type ConnectorProvider,
  type ConnectorToken,
  type FetchLike
} from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  createConfiguredGoogleDocsConnector,
  getGoogleDocsConnection,
  getGoogleDocsToken
} from "../../../../lib/google-docs-demo";
import {
  callNotionMcpFetch,
  getNotionMcpConnection,
  isNotionDevLocalStorageAvailable
} from "../../../../lib/notion-mcp-demo";
import { localizeImportAssets } from "../../../../lib/local-import-assets";
import { callFeishuMcpFetch } from "../../../../lib/feishu-mcp-demo";
import {
  getFeishuApiConfig,
  getFeishuConnection,
  getFeishuToken,
  isFeishuLocalDemoToken
} from "../../../../lib/feishu-demo";
import {
  getYouMindApiConfig,
  getYouMindConnection,
  getYouMindToken
} from "../../../../lib/youmind-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXTURE_SOURCES: Record<ConnectorProvider, string> = {
  notion: "https://www.notion.so/Campaign-Draft-b55c9c91384d452b81dbd1ef79372b75",
  feishu: "https://tutti.feishu.cn/docx/doxcnTuttiImportDemo",
  youmind: "https://youmind.com/crafts/019bc6bc-e1cc-79a2-a6fd-448b711a8895",
  googledocs: "https://docs.google.com/document/d/1TuttiGoogleDocsImportDemo123456789/edit"
};

export function GET(request: Request) {
  const notionMcp = getNotionMcpConnection(request);
  const feishu = getFeishuConnection(request);
  const youmind = getYouMindConnection(request);
  const googleDocs = getGoogleDocsConnection(request);
  return NextResponse.json({
    fixtureSources: FIXTURE_SOURCES,
    liveAvailable: {
      notion: Boolean(process.env.NOTION_IMPORT_ACCESS_TOKEN || notionMcp.connected),
      feishu: Boolean(process.env.FEISHU_IMPORT_ACCESS_TOKEN || feishu.connected),
      youmind: youmind.connected,
      googledocs: googleDocs.connected
    },
    connections: {
      notion: {
        transport: "mcp",
        available: true,
        connected: notionMcp.connected,
        accountName: notionMcp.accountName,
        devLocalStorageAvailable: isNotionDevLocalStorageAvailable()
      },
      feishu: {
        transport: "mcp",
        available: feishu.available,
        connected: feishu.connected,
        accountName: feishu.accountName,
        mode: feishu.mode,
        appType: feishu.appType
      },
      youmind: {
        transport: "openapi",
        available: youmind.available,
        connected: youmind.connected,
        accountName: youmind.accountName,
        mode: youmind.mode,
        settingsUrl: youmind.settingsUrl
      },
      googledocs: googleDocs
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider?: unknown;
      source?: unknown;
      mode?: unknown;
    };
    const provider = parseProvider(body.provider);
    const mode = body.mode === "live" ? "live" : body.mode === "fixture" ? "fixture" : undefined;
    if (!mode) return errorResponse("mode 必须是 fixture 或 live。", 400);

    const source =
      typeof body.source === "string" && body.source.trim()
        ? body.source.trim()
        : FIXTURE_SOURCES[provider];
    const fixture = mode === "fixture";

    if (!fixture && provider === "googledocs") {
      if (!getGoogleDocsConnection(request).connected) {
        return errorResponse("请先连接个人 Google 账号。", 401);
      }
      const connector = createConfiguredGoogleDocsConnector();
      const token = await getGoogleDocsToken(request);
      const selectedDocumentId = token.metadata?.selectedDocumentId;
      const requestedDocumentId = connector.resolveDocument(source).id;
      if (selectedDocumentId !== requestedDocumentId) {
        return errorResponse("请通过 Google Picker 选择这篇文档后再导入。", 403);
      }
      const imported = await importConnectedDocument({
        connector,
        token,
        source
      });
      return importResponse(mode, await localizeImportAssets(imported), "rest");
    }

    if (!fixture && provider === "youmind") {
      if (!getYouMindConnection(request).connected) {
        return errorResponse("请先连接 YouMind API Key。", 401);
      }
      const connector = createYouMindConnector(getYouMindApiConfig());
      const imported = await importConnectedDocument({
        connector,
        token: getYouMindToken(request),
        source
      });
      return importResponse(mode, await localizeImportAssets(imported), "openapi");
    }

    if (!fixture && provider === "notion" && !process.env.NOTION_IMPORT_ACCESS_TOKEN) {
      if (!getNotionMcpConnection(request).connected) {
        return errorResponse("请先点击 Connect Notion 完成 MCP 授权。", 401);
      }
      const notionMcpResult = await callNotionMcpFetch(request, source);
      const result = await localizeImportAssets(
        notionMcpFetchResultToImport(notionMcpResult, source)
      );
      return importResponse(mode, result, "mcp");
    }

    const token = fixture
      ? { accessToken: "fixture-access-token", tokenType: "bearer" as const }
      : provider === "feishu" && !process.env.FEISHU_IMPORT_ACCESS_TOKEN
        ? await getFeishuToken(request)
        : liveToken(provider);
    if (!token) {
      return errorResponse(
        `服务端尚未配置 ${provider === "notion" ? "NOTION_IMPORT_ACCESS_TOKEN" : "FEISHU_IMPORT_ACCESS_TOKEN"}。`,
        400
      );
    }

    if (!fixture && provider === "feishu" && isFeishuLocalDemoToken(token)) {
      const connector = createFeishuConnector({
        clientId: "local-store-demo",
        clientSecret: "local-store-demo",
        redirectUri: "http://localhost:3000/api/connectors/feishu/callback",
        fetch: createFeishuFixtureFetch()
      });
      const result = await importConnectedDocument({ connector, token, source });
      return importResponse(mode, result, "fixture");
    }

    if (!fixture && provider === "feishu") {
      try {
        const mcpResult = feishuMcpFetchResultToImport(
          await callFeishuMcpFetch(token, source),
          source
        );
        return importResponse(mode, await localizeImportAssets(mcpResult), "mcp");
      } catch (error) {
        console.warn(
          "Feishu MCP import unavailable; falling back to REST blocks:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }

    const connector =
      provider === "notion"
        ? createNotionConnector({
            clientId: "demo-client",
            clientSecret: "demo-secret",
            redirectUri: "http://localhost:3000/import-demo",
            fetch: fixture ? createNotionFixtureFetch() : undefined
          })
        : provider === "feishu"
          ? createFeishuConnector({
            clientId: process.env.FEISHU_APP_ID || "demo-client",
            clientSecret: process.env.FEISHU_APP_SECRET || "demo-secret",
            redirectUri: "http://localhost:3000/import-demo",
            ...getFeishuApiConfig(),
            fetch: fixture ? createFeishuFixtureFetch() : undefined
          })
          : provider === "youmind"
            ? createYouMindConnector({ fetch: fixture ? createYouMindFixtureFetch() : undefined })
            : createGoogleDocsConnector({
                clientId: "demo-client",
                clientSecret: "demo-secret",
                redirectUri: "http://localhost:3000/import-demo",
                fetch: createGoogleDocsFixtureFetch()
              });

    const imported = await importConnectedDocument({ connector, token, source });
    const result = fixture ? imported : await localizeImportAssets(imported);

    return importResponse(mode, result, fixture ? "fixture" : "rest");
  } catch (error) {
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          provider: error.provider,
          retryable: error.retryable
        },
        { status: error.status && error.status < 500 ? error.status : 502 }
      );
    }
    console.error("Content import preview failed", error);
    return errorResponse(error instanceof Error ? error.message : "导入预览失败。", 500);
  }
}

function parseProvider(value: unknown): ConnectorProvider {
  if (value === "notion" || value === "feishu" || value === "youmind" || value === "googledocs") return value;
  throw new ConnectorError({
    provider: "notion",
    code: "invalid_source",
    message: "provider 必须是 notion、feishu、youmind 或 googledocs。"
  });
}

function liveToken(provider: ConnectorProvider): ConnectorToken | undefined {
  if (provider === "notion") {
    const accessToken = process.env.NOTION_IMPORT_ACCESS_TOKEN;
    return accessToken ? { accessToken, tokenType: "bearer" } : undefined;
  }
  if (provider === "youmind") {
    const apiKey = process.env.YOUMIND_IMPORT_API_KEY;
    return apiKey ? { accessToken: apiKey, tokenType: "bearer" } : undefined;
  }
  const accessToken = process.env.FEISHU_IMPORT_ACCESS_TOKEN;
  return accessToken ? { accessToken, tokenType: "bearer" } : undefined;
}

function createYouMindFixtureFetch(): FetchLike {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/getFile")) {
      return Response.json({
        file: {
          id: "019bc6bc-e1cc-79a2-a6fd-448b711a8895",
          title: "Tutti YouMind Import Demo",
          updatedAt: "2026-07-13T12:00:00.000Z",
          markdown: "# YouMind draft\n\nA fixture imported through the official OpenAPI contract."
        }
      });
    }
    return Response.json({ message: `Fixture route not found: ${url}` }, { status: 404 });
  };
}

function createGoogleDocsFixtureFetch(): FetchLike {
  return async (input) => {
    const url = String(input);
    if (url.includes("docs.googleapis.com")) {
      return Response.json({
        documentId: "1TuttiGoogleDocsImportDemo123456789",
        title: "Tutti Google Docs Import Demo",
        revisionId: "fixture-revision",
        body: { content: [{ paragraph: { elements: [{ textRun: { content: "Google Docs fixture body.\n" } }] } }] }
      });
    }
    if (url.includes("googleapis.com/drive/v3/files/")) {
      return Response.json({
        id: "1TuttiGoogleDocsImportDemo123456789",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-07-13T12:00:00.000Z"
      });
    }
    return Response.json({ message: `Fixture route not found: ${url}` }, { status: 404 });
  };
}

function importResponse(
  mode: "fixture" | "live",
  result: ContentImportResult,
  transport: "fixture" | "mcp" | "rest" | "openapi"
) {
  return NextResponse.json({
    mode,
    transport,
    result: {
      ...result,
      assets: result.assets.map((asset) => ({
        ...asset,
        sourceUrl: undefined,
        sourceAvailable: Boolean(asset.sourceUrl),
        previewUrl: asset.sourceUrl?.startsWith("/api/import-assets/") ? asset.sourceUrl : undefined
      }))
    }
  });
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function createNotionFixtureFetch(): FetchLike {
  const pageId = "b55c9c91-384d-452b-81db-d1ef79372b75";
  const childId = "11111111-2222-3333-4444-555555555555";
  return async (input) => {
    const url = String(input);
    if (url.endsWith(`/v1/pages/${pageId}`)) {
      return Response.json({
        id: pageId,
        url: FIXTURE_SOURCES.notion,
        last_edited_time: "2026-07-13T09:30:00.000Z",
        properties: {
          title: { type: "title", title: [{ plain_text: "Summer Launch Campaign" }] }
        }
      });
    }
    if (url.endsWith(`/v1/pages/${pageId}/markdown`)) {
      return Response.json({
        id: pageId,
        markdown: [
          "# Summer Launch Campaign",
          "",
          "Turn everyday movement into momentum with **Tutti Move**.",
          "",
          "## Post outline",
          "",
          "- Open with a personal training moment",
          "- Mention the new recovery dashboard",
          "- Close with [Learn more](https://tutti.example/move)",
          "",
          "<callout icon=\"💡\" color=\"green_bg\">",
          "\tKeep the tone personal and avoid absolute performance claims.",
          "</callout>",
          "",
          `<unknown url="https://notion.so/page#${childId}"/>`
        ].join("\n"),
        truncated: true,
        unknown_block_ids: [childId]
      });
    }
    if (url.endsWith(`/v1/pages/${childId}/markdown`)) {
      return Response.json({
        id: childId,
        markdown: [
          '<table header-row="true"><tr><td>Requirement</td><td>Value</td></tr><tr><td>Hashtag</td><td>#TuttiMove</td></tr></table>',
          "",
          "![Campaign visual](https://files.notion.example/tutti-move.png)"
        ].join("\n"),
        truncated: false,
        unknown_block_ids: []
      });
    }
    return Response.json({ message: `Fixture route not found: ${url}` }, { status: 404 });
  };
}

function createFeishuFixtureFetch(): FetchLike {
  const documentId = "doxcnTuttiImportDemo";
  return async (input) => {
    const url = String(input);
    if (url.endsWith(`/open-apis/docx/v1/documents/${documentId}`)) {
      return Response.json({
        code: 0,
        data: {
          document: {
            document_id: documentId,
            revision_id: 28,
            title: "Tutti Creator Brief"
          }
        }
      });
    }
    if (url.includes(`/open-apis/docx/v1/documents/${documentId}/blocks`)) {
      return Response.json({
        code: 0,
        data: {
          has_more: false,
          items: [
            { block_id: documentId, block_type: 1, children: ["h1", "p1", "h2", "b1", "b2", "quote", "table", "img"] },
            { block_id: "h1", parent_id: documentId, block_type: 3, heading1: { elements: [{ text_run: { content: "Tutti Creator Brief" } }] } },
            {
              block_id: "p1",
              parent_id: documentId,
              block_type: 2,
              text: {
                elements: [
                  { text_run: { content: "Goal: ", text_element_style: { bold: true } } },
                  { text_run: { content: "Introduce the new creator workflow in an authentic voice." } }
                ]
              }
            },
            { block_id: "h2", parent_id: documentId, block_type: 4, heading2: { elements: [{ text_run: { content: "Required points" } }] } },
            { block_id: "b1", parent_id: documentId, block_type: 12, bullet: { elements: [{ text_run: { content: "Mention collaborative review" } }] } },
            { block_id: "b2", parent_id: documentId, block_type: 12, bullet: { elements: [{ text_run: { content: "Use #CreateWithTutti" } }] } },
            { block_id: "quote", parent_id: documentId, block_type: 15, quote: { elements: [{ text_run: { content: "Make the product benefit concrete, not corporate." } }] } },
            { block_id: "table", parent_id: documentId, block_type: 31, table: { cells: ["c1", "c2", "c3", "c4"], property: { row_size: 2, column_size: 2 } } },
            { block_id: "c1", parent_id: "table", block_type: 32, children: ["ct1"] },
            { block_id: "c2", parent_id: "table", block_type: 32, children: ["ct2"] },
            { block_id: "c3", parent_id: "table", block_type: 32, children: ["ct3"] },
            { block_id: "c4", parent_id: "table", block_type: 32, children: ["ct4"] },
            { block_id: "ct1", parent_id: "c1", block_type: 2, text: { elements: [{ text_run: { content: "Channel" } }] } },
            { block_id: "ct2", parent_id: "c2", block_type: 2, text: { elements: [{ text_run: { content: "X" } }] } },
            { block_id: "ct3", parent_id: "c3", block_type: 2, text: { elements: [{ text_run: { content: "Length" } }] } },
            { block_id: "ct4", parent_id: "c4", block_type: 2, text: { elements: [{ text_run: { content: "Under 240 characters" } }] } },
            { block_id: "img", parent_id: documentId, block_type: 27, image: { token: "boxcnTuttiImage", width: 1200, height: 630 } }
          ]
        }
      });
    }
    if (url.includes("/open-apis/drive/v1/medias/batch_get_tmp_download_url")) {
      return Response.json({
        code: 0,
        data: {
          tmp_download_urls: [
            {
              file_token: "boxcnTuttiImage",
              tmp_download_url: "https://files.feishu.example/tutti-creator.png"
            }
          ]
        }
      });
    }
    return Response.json({ code: 404, msg: `Fixture route not found: ${url}` }, { status: 404 });
  };
}
