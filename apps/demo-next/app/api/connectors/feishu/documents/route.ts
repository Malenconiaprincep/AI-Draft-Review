import {
  ConnectorError,
  feishuMcpSearchResultToDocuments
} from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  getFeishuConnection,
  getFeishuToken,
  isFeishuLocalDemoToken
} from "../../../../../lib/feishu-demo";
import { callFeishuMcpSearch } from "../../../../../lib/feishu-mcp-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!getFeishuConnection(request).connected) {
    return NextResponse.json({ error: "请先 Connect 飞书完成用户授权。" }, { status: 401 });
  }
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "请输入飞书文档标题或关键词。" }, { status: 400 });
  }

  try {
    const token = await getFeishuToken(request);
    if (isFeishuLocalDemoToken(token)) {
      return NextResponse.json({
        query,
        documents: [{
          provider: "feishu",
          id: "doxcnTuttiImportDemo",
          kind: "docx",
          url: "https://tutti.feishu.cn/docx/doxcnTuttiImportDemo",
          title: "Tutti Creator Brief（本地演示）",
          lastEditedAt: "2026-07-13T09:30:00.000Z"
        }]
      });
    }
    const documents = feishuMcpSearchResultToDocuments(
      await callFeishuMcpSearch(token, query)
    );
    return NextResponse.json({ query, documents });
  } catch (error) {
    console.error("Feishu MCP document search failed", error);
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status < 500 ? error.status : 502 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取飞书文档失败。" },
      { status: 502 }
    );
  }
}
