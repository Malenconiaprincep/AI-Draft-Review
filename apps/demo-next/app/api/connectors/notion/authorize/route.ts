import { NextResponse } from "next/server";
import {
  beginNotionMcpAuthorization,
  persistNotionMcpSession
} from "../../../../../lib/notion-mcp-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authorization = await beginNotionMcpAuthorization(request);
    const response = NextResponse.redirect(authorization.authorizationUrl);
    return persistNotionMcpSession(response, request, authorization);
  } catch (error) {
    console.error("Notion MCP authorization failed", error);
    const url = new URL("/import-demo", request.url);
    url.searchParams.set("notion_mcp", "unavailable");
    url.hash = "notion-auth-help";
    return NextResponse.redirect(url);
  }
}
