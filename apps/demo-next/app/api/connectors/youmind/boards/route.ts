import { ConnectorError, createYouMindConnector } from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  getYouMindApiConfig,
  getYouMindConnection,
  getYouMindToken
} from "../../../../../lib/youmind-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!getYouMindConnection(request).connected) {
    return NextResponse.json({ error: "请先连接 YouMind API Key。" }, { status: 401 });
  }
  const query = new URL(request.url).searchParams.get("q")?.trim();
  try {
    const connector = createYouMindConnector(getYouMindApiConfig());
    const boards = await connector.listBoards(getYouMindToken(request), { query, pageSize: 100 });
    return NextResponse.json({ boards });
  } catch (error) {
    console.error("YouMind board listing failed", error);
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status < 500 ? error.status : 502 }
      );
    }
    return NextResponse.json({ error: "读取 YouMind Board 失败。" }, { status: 502 });
  }
}
