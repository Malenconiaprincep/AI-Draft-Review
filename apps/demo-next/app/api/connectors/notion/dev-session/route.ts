import { NextResponse } from "next/server";
import {
  exportNotionMcpDevSession,
  isNotionBrowserSessionPersistenceAvailable,
  NOTION_MCP_SESSION_COOKIE,
  restoreNotionMcpDevSession
} from "../../../../../lib/notion-mcp-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!isNotionBrowserSessionPersistenceAvailable()) return disabledResponse();
  try {
    return NextResponse.json(exportNotionMcpDevSession(request), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "not_connected" ? "Notion 尚未连接。" : "无法导出开发会话。" },
      { status: 401 }
    );
  }
}

export async function POST(request: Request) {
  if (!isNotionBrowserSessionPersistenceAvailable()) return disabledResponse();
  try {
    const restored = restoreNotionMcpDevSession(request, await request.json());
    const response = NextResponse.json(
      { connected: true, accountName: restored.accountName },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(NOTION_MCP_SESSION_COOKIE, restored.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "invalid_dev_session" ? "浏览器中的 Notion 会话无效。" : "无法恢复浏览器会话。" },
      { status: 400 }
    );
  }
}

function disabledResponse() {
  return NextResponse.json({ error: "Notion 浏览器会话实验功能未开启。" }, { status: 404 });
}
