import { ConnectorError } from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  connectYouMind,
  disconnectYouMind,
  YOUMIND_SESSION_COOKIE
} from "../../../../../lib/youmind-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : undefined;
    const authorization = await connectYouMind(apiKey);
    const response = NextResponse.json({
      connected: true,
      accountName: authorization.token.accountName
    });
    response.cookies.set(YOUMIND_SESSION_COOKIE, authorization.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return response;
  } catch (error) {
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status < 500 ? error.status : 502 }
      );
    }
    console.error("YouMind API Key connection failed", error);
    return NextResponse.json({ error: "YouMind API Key 校验失败。" }, { status: 502 });
  }
}

export function DELETE(request: Request) {
  disconnectYouMind(request);
  const response = NextResponse.json({ connected: false });
  response.cookies.set(YOUMIND_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
