import { NextResponse } from "next/server";
import {
  finishFeishuAuthorization,
  validateFeishuAuthorizationState
} from "../../../../../lib/feishu-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) {
    try {
      validateFeishuAuthorizationState(request);
      return redirectToDemo(request, "denied");
    } catch {
      return redirectToDemo(request, "invalid_state");
    }
  }

  try {
    await finishFeishuAuthorization(request);
    return redirectToDemo(request, "connected");
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_state") {
      return redirectToDemo(request, "invalid_state");
    }
    console.error("Feishu callback failed", error);
    return redirectToDemo(request, "failed");
  }
}

function redirectToDemo(request: Request, outcome: string) {
  const url = new URL("/import-demo", request.url);
  url.searchParams.set("feishu_oauth", outcome);
  return NextResponse.redirect(url);
}
