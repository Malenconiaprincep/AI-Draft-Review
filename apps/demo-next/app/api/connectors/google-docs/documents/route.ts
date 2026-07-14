import { ConnectorError } from "@tutti/content-import";
import { NextResponse } from "next/server";
import {
  createConfiguredGoogleDocsConnector,
  getGoogleDocsConnection,
  getGoogleDocsToken
} from "../../../../../lib/google-docs-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!getGoogleDocsConnection(request).connected) {
    return NextResponse.json({ error: "请先通过 Google Picker 授权一篇文档。" }, { status: 401 });
  }

  try {
    const token = await getGoogleDocsToken(request);
    const selectedDocumentId = token.metadata?.selectedDocumentId;
    if (typeof selectedDocumentId !== "string" || !selectedDocumentId) {
      return NextResponse.json({ error: "Google Picker 会话中没有已选择的文档。" }, { status: 400 });
    }

    const page = await createConfiguredGoogleDocsConnector().listDocuments(token, { pageSize: 100 });
    const documents = page.items
      .filter((document) => document.id === selectedDocumentId)
      .map((document) => ({
        id: document.id,
        name: document.title,
        url: document.url || `https://docs.google.com/document/d/${document.id}/edit`
      }));

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Google Docs selected document listing failed", error);
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status < 500 ? error.status : 502 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取 Google Docs 失败。" },
      { status: 502 }
    );
  }
}
