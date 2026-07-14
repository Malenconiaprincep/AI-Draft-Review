import { ConnectorError } from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  connectGoogleDocs,
  disconnectGoogleDocs,
  getGoogleDocsPickerConfig,
  GOOGLE_DOCS_SESSION_COOKIE
} from "../../../../../lib/google-docs-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = getGoogleDocsPickerConfig();
  return NextResponse.json(config, {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      accessToken?: unknown;
      expiresIn?: unknown;
      source?: unknown;
    };
    if (typeof body.accessToken !== "string" || typeof body.source !== "string") {
      return NextResponse.json({ error: "Google Picker 授权结果不完整。" }, { status: 400 });
    }
    const connection = connectGoogleDocs({
      accessToken: body.accessToken,
      expiresIn: typeof body.expiresIn === "number" ? body.expiresIn : undefined,
      source: body.source
    });
    const response = NextResponse.json({
      connected: true,
      source: connection.selected,
      accountName: connection.token.accountName
    });
    response.cookies.set(GOOGLE_DOCS_SESSION_COOKIE, connection.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60
    });
    return response;
  } catch (error) {
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status < 500 ? error.status : 400 }
      );
    }
    console.error("Google Picker connection failed", error);
    return NextResponse.json({ error: "Google Picker 连接失败。" }, { status: 500 });
  }
}

export function DELETE(request: Request) {
  disconnectGoogleDocs(request);
  const response = NextResponse.json({ connected: false });
  response.cookies.set(GOOGLE_DOCS_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
