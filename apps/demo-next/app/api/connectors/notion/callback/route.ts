import { NextResponse } from "next/server";
import {
  finishNotionMcpAuthorization,
  persistNotionMcpSession
} from "../../../../../lib/notion-mcp-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirectToDemo(request, "denied");

  try {
    await finishNotionMcpAuthorization(request);
    return persistNotionMcpSession(redirectToDemo(request, "connected"), request);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_state") {
      return redirectToDemo(request, "invalid_state");
    }
    console.error("Notion MCP callback failed", error);
    return redirectToDemo(request, "failed");
  }
}

function redirectToDemo(request: Request, outcome: string) {
  const url = new URL("/import-demo", request.url);
  url.searchParams.set("notion_mcp", outcome);
  url.hash = "notion-auth-help";
  return NextResponse.redirect(url);
}
