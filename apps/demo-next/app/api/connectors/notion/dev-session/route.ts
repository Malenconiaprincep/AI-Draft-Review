import { NextResponse } from "next/server";
import {
  exportNotionMcpDevSession,
  isNotionDevLocalStorageAvailable,
  NOTION_MCP_SESSION_COOKIE,
  restoreNotionMcpDevSession
} from "../../../../../lib/notion-mcp-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!isNotionDevLocalStorageAvailable()) return disabledResponse();
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
  if (!isNotionDevLocalStorageAvailable()) return disabledResponse();
  try {
    const restored = restoreNotionMcpDevSession(request, await request.json());
    const response = NextResponse.json({ connected: true, accountName: restored.accountName });
    response.cookies.set(NOTION_MCP_SESSION_COOKIE, restored.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "invalid_dev_session" ? "本地 Notion 开发凭据无效。" : "无法恢复开发会话。" },
      { status: 400 }
    );
  }
}

function disabledResponse() {
  return NextResponse.json({ error: "Notion localStorage 开发开关未开启。" }, { status: 404 });
}
