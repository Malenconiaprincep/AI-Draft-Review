import { NextResponse } from "next/server";
import {
  beginNotionMcpAuthorization,
  NOTION_MCP_SESSION_COOKIE
} from "../../../../../lib/notion-mcp-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authorization = await beginNotionMcpAuthorization(request);
    const response = NextResponse.redirect(authorization.authorizationUrl);
    response.cookies.set(NOTION_MCP_SESSION_COOKIE, authorization.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return response;
  } catch (error) {
    console.error("Notion MCP authorization failed", error);
    const url = new URL("/import-demo", request.url);
    url.searchParams.set("notion_mcp", "unavailable");
    url.hash = "notion-auth-help";
    return NextResponse.redirect(url);
  }
}
