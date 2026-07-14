import { ConnectorError } from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  FEISHU_SESSION_COOKIE,
  getFeishuAppRegistration,
  startFeishuAppRegistration
} from "../../../../../lib/feishu-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return NextResponse.json(getFeishuAppRegistration(request));
}

export async function POST(request: Request) {
  try {
    const registration = await startFeishuAppRegistration(request);
    const { sessionId, ...publicRegistration } = registration;
    const response = NextResponse.json(publicRegistration);
    response.cookies.set(FEISHU_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return response;
  } catch (error) {
    console.error("Feishu dynamic app registration failed", error);
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status < 500 ? error.status : 502 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建飞书连接失败。" },
      { status: 502 }
    );
  }
}
