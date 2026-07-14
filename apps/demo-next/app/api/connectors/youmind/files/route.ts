import { ConnectorError, createYouMindConnector } from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  getYouMindApiConfig,
  getYouMindConnection,
  getYouMindToken,
  isYouMindArticleKind
} from "../../../../../lib/youmind-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!getYouMindConnection(request).connected) {
    return NextResponse.json({ error: "请先连接 YouMind API Key。" }, { status: 401 });
  }
  const url = new URL(request.url);
  const boardId = url.searchParams.get("boardId")?.trim();
  if (!boardId) {
    return NextResponse.json({ error: "请选择 YouMind Board。" }, { status: 400 });
  }
  try {
    const connector = createYouMindConnector(getYouMindApiConfig());
    const page = await connector.listFiles(getYouMindToken(request), boardId, {
      query: url.searchParams.get("q")?.trim() || undefined,
      pageSize: 100
    });
    return NextResponse.json({
      files: page.items.filter((file) => isYouMindArticleKind(file.kind)),
      nextCursor: page.nextCursor
    });
  } catch (error) {
    console.error("YouMind file listing failed", error);
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status < 500 ? error.status : 502 }
      );
    }
    return NextResponse.json({ error: "读取 YouMind 文件失败。" }, { status: 502 });
  }
}
