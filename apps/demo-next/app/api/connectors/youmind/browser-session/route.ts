import { NextResponse } from "next/server";
import { isBrowserSessionPersistenceAvailable } from "../../../../../lib/browser-session-persistence";
import {
  exportYouMindBrowserSession,
  restoreYouMindBrowserSession,
  YOUMIND_SESSION_COOKIE
} from "../../../../../lib/youmind-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!isBrowserSessionPersistenceAvailable()) return disabledResponse();
  try {
    return NextResponse.json(exportYouMindBrowserSession(request), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return NextResponse.json({ error: "YouMind 尚未连接。" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  if (!isBrowserSessionPersistenceAvailable()) return disabledResponse();
  try {
    const restored = restoreYouMindBrowserSession(await request.json());
    const response = NextResponse.json(
      { connected: true, accountName: restored.accountName },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(YOUMIND_SESSION_COOKIE, restored.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return response;
  } catch {
    return NextResponse.json({ error: "浏览器中的 YouMind 会话无效。" }, { status: 400 });
  }
}

function disabledResponse() {
  return NextResponse.json({ error: "浏览器会话实验功能未开启。" }, { status: 404 });
}
