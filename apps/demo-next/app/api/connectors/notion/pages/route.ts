import { NextResponse } from "next/server";
import {
  getNotionMcpConnection,
  searchNotionMcpPages
} from "../../../../../lib/notion-mcp-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!getNotionMcpConnection(request).connected) {
    return NextResponse.json({ error: "请先 Connect Notion 完成 MCP 授权。" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() || "最近修改的页面";
  try {
    const pages = await searchNotionMcpPages(request, query);
    return NextResponse.json({ query, pages });
  } catch (error) {
    console.error("Notion MCP page search failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取 Notion 页面列表失败。" },
      { status: 502 }
    );
  }
}
