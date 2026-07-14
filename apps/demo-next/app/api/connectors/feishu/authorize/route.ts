import { NextResponse } from "next/server";
import {
  beginFeishuAuthorization,
  FEISHU_SESSION_COOKIE
} from "../../../../../lib/feishu-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const authorization = beginFeishuAuthorization(request);
    const response = NextResponse.redirect(authorization.authorizationUrl);
    response.cookies.set(FEISHU_SESSION_COOKIE, authorization.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return response;
  } catch (error) {
    console.error("Feishu authorization failed", error);
    return redirectToDemo(request, "unavailable");
  }
}

function redirectToDemo(request: Request, outcome: string) {
  const url = new URL("/import-demo", request.url);
  url.searchParams.set("feishu_oauth", outcome);
  return NextResponse.redirect(url);
}
