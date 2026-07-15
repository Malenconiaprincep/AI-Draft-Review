import { NextResponse } from "next/server";
import { isBrowserSessionPersistenceAvailable } from "../../../../../lib/browser-session-persistence";
import {
  exportGoogleDocsBrowserSession,
  GOOGLE_DOCS_SESSION_COOKIE,
  restoreGoogleDocsBrowserSession
} from "../../../../../lib/google-docs-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!isBrowserSessionPersistenceAvailable()) return disabledResponse();
  try {
    return NextResponse.json(exportGoogleDocsBrowserSession(request), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Google Docs 尚未连接。" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  if (!isBrowserSessionPersistenceAvailable()) return disabledResponse();
  try {
    const restored = restoreGoogleDocsBrowserSession(await request.json());
    const response = NextResponse.json(
      { connected: true, accountName: restored.accountName },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(GOOGLE_DOCS_SESSION_COOKIE, restored.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60
    });
    return response;
  } catch {
    return NextResponse.json({ error: "浏览器中的 Google Docs 会话已失效，请重新授权。" }, { status: 400 });
  }
}

function disabledResponse() {
  return NextResponse.json({ error: "浏览器会话实验功能未开启。" }, { status: 404 });
}
