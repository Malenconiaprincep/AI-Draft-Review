import { canonicalDocumentToDraftDoc } from "./canonical.ts";
import { ConnectorError } from "./errors.ts";
import { parseMarkdownToCanonical } from "./markdown.ts";
import type {
  CanonicalDocument,
  ConnectorDocumentListItem,
  ContentImportResult,
  ExternalDocumentRef
} from "./types.ts";

export function feishuMcpFetchResultToImport(result: unknown, source: string): ContentImportResult {
  const envelope = asRecord(result);
  if (envelope.isError === true) {
    throw new ConnectorError({
      provider: "feishu",
      code: "provider_error",
      message: extractErrorMessage(envelope) || "飞书 MCP 读取文档失败。",
      details: envelope
    });
  }

  const payload = extractPayload(envelope);
  const documentPayload = unwrapData(payload);
  const markdown = extractDocumentText(documentPayload, envelope);
  if (!markdown.trim()) {
    throw new ConnectorError({
      provider: "feishu",
      code: "invalid_provider_response",
      message: "飞书 MCP 响应中没有可导入的文档正文。",
      details: payload
    });
  }

  const ref = parseSourceRef(source, documentPayload);
  const parsed = parseMarkdownToCanonical(markdown, "feishu");
  const title = findString(documentPayload, ["title", "name"])
    || markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || "Untitled Feishu document";
  const revision = findScalar(documentPayload, [
    "revision_id",
    "revisionId",
    "revision",
    "version"
  ]);
  const lastEditedAt = findString(documentPayload, [
    "last_edited_time",
    "lastEditedAt",
    "obj_edit_time",
    "updated_at"
  ]);

  const document: CanonicalDocument = {
    ref,
    title,
    revision,
    lastEditedAt,
    content: parsed.content,
    assets: parsed.assets,
    warnings: parsed.warnings
  };
  return canonicalDocumentToDraftDoc(document);
}

export function feishuMcpSearchResultToDocuments(
  result: unknown
): ConnectorDocumentListItem[] {
  const envelope = asRecord(result);
  if (envelope.isError === true) {
    throw new ConnectorError({
      provider: "feishu",
      code: "provider_error",
      message: extractErrorMessage(envelope) || "飞书 MCP 搜索文档失败。",
      details: envelope
    });
  }
  const payload = unwrapData(extractPayload(envelope));
  const items = findArray(payload, ["items", "results", "documents", "docs"]);
  return items.flatMap((value): ConnectorDocumentListItem[] => {
    const item = asRecord(value);
    const id = findString(item, [
      "document_id",
      "documentId",
      "doc_id",
      "docID",
      "obj_token",
      "token",
      "id"
    ]);
    if (!id) return [];
    const url = findString(item, ["url", "document_url", "documentUrl"]);
    const kindValue = findString(item, ["type", "obj_type", "document_type"]);
    return [{
      provider: "feishu",
      id,
      kind: kindValue === "wiki" ? "wiki" : "docx",
      url,
      title: findString(item, ["title", "name"]) || "未命名飞书文档",
      lastEditedAt: findString(item, [
        "last_edited_time",
        "lastEditedAt",
        "obj_edit_time",
        "updated_at",
        "update_time"
      ])
    }];
  });
}

function extractPayload(envelope: Record<string, unknown>): Record<string, unknown> {
  const structured = asRecord(envelope.structuredContent);
  if (Object.keys(structured).length) return structured;
  for (const text of textBlocks(envelope)) {
    try {
      const parsed = asRecord(JSON.parse(text));
      if (Object.keys(parsed).length) return parsed;
    } catch {
      continue;
    }
  }
  return {};
}

function unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(payload.data);
  return Object.keys(data).length ? data : payload;
}

function extractDocumentText(
  payload: Record<string, unknown>,
  envelope: Record<string, unknown>
): string {
  const direct = findString(payload, [
    "markdown",
    "content",
    "text",
    "body",
    "document_content",
    "documentContent"
  ]);
  if (direct) return direct;
  return textBlocks(envelope).find((text) => !looksLikeJson(text)) || "";
}

function parseSourceRef(
  source: string,
  payload: Record<string, unknown>
): ExternalDocumentRef {
  const sourceUrl = isHttpUrl(source) ? source : findString(payload, ["url", "document_url"]);
  const match = sourceUrl?.match(/\/(docx|wiki)\/([A-Za-z0-9_-]+)/);
  const payloadId = findString(payload, [
    "document_id",
    "documentId",
    "doc_id",
    "docID",
    "obj_token",
    "token",
    "id"
  ]);
  return {
    provider: "feishu",
    id: payloadId || match?.[2] || source,
    kind: match?.[1] || "docx",
    url: sourceUrl
  };
}

function findString(
  value: Record<string, unknown>,
  keys: string[],
  depth = 0
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  if (depth >= 3) return undefined;
  for (const candidate of Object.values(value)) {
    const nested = asRecord(candidate);
    if (!Object.keys(nested).length) continue;
    const found = findString(nested, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function findScalar(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number") return String(candidate);
  }
  for (const candidate of Object.values(value)) {
    const nested = asRecord(candidate);
    if (!Object.keys(nested).length) continue;
    const found = findScalar(nested, keys);
    if (found) return found;
  }
  return undefined;
}

function findArray(value: Record<string, unknown>, keys: string[], depth = 0): unknown[] {
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (depth >= 3) return [];
  for (const candidate of Object.values(value)) {
    const nested = asRecord(candidate);
    if (!Object.keys(nested).length) continue;
    const found = findArray(nested, keys, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function extractErrorMessage(envelope: Record<string, unknown>): string | undefined {
  for (const text of textBlocks(envelope)) {
    try {
      const parsed = asRecord(JSON.parse(text));
      const error = parsed.error;
      if (typeof error === "string") return error;
      const message = asRecord(error).message;
      if (typeof message === "string") return message;
    } catch {
      if (text.trim()) return text.trim();
    }
  }
  return undefined;
}

function textBlocks(envelope: Record<string, unknown>): string[] {
  const content = Array.isArray(envelope.content) ? envelope.content : [];
  return content.flatMap((block) => {
    const item = asRecord(block);
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  });
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
