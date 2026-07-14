import { canonicalDocumentToDraftDoc, paragraph } from "./canonical.ts";
import { ConnectorError, errorCodeForStatus, readErrorBody } from "./errors.ts";
import { parseMarkdownToCanonical } from "./markdown.ts";
import type {
  CanonicalDocument,
  CanonicalNode,
  ConnectorDocumentPage,
  ConnectorToken,
  ContentConnector,
  ContentImportResult,
  ExternalDocumentRef,
  FetchLike,
  ListDocumentsInput
} from "./types.ts";

const DEFAULT_API_BASE_URL = "https://youmind.com/openapi/v1";
const DEFAULT_SETTINGS_URL = "https://youmind.com/settings/api-keys";

export type YouMindConnectorConfig = {
  apiBaseUrl?: string;
  settingsUrl?: string;
  fetch?: FetchLike;
};

export type YouMindBoard = {
  id: string;
  name: string;
  status?: string;
  favorite?: boolean;
  updatedAt?: string;
};

type JsonRecord = Record<string, unknown>;

export class YouMindConnector implements ContentConnector {
  readonly provider = "youmind" as const;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly settingsUrl: string;

  constructor(config: YouMindConnectorConfig = {}) {
    this.fetchImpl = config.fetch ?? fetch;
    this.apiBaseUrl = (config.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
    this.settingsUrl = config.settingsUrl ?? DEFAULT_SETTINGS_URL;
  }

  getAuthorizationUrl(state: string): string {
    const url = new URL(this.settingsUrl);
    url.searchParams.set("utm_source", "tutti-import");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorization(apiKey: string): Promise<ConnectorToken> {
    const token = youMindApiKeyToken(apiKey);
    await this.listBoards(token, { pageSize: 1 });
    return token;
  }

  async refreshAuthorization(token: ConnectorToken): Promise<ConnectorToken> {
    return token;
  }

  resolveDocument(urlOrId: string): ExternalDocumentRef {
    const value = urlOrId.trim();
    const id = parseYouMindFileId(value);
    if (!id) {
      throw new ConnectorError({
        provider: "youmind",
        code: "invalid_source",
        message: "无法从输入中识别 YouMind File/Craft ID。"
      });
    }
    return {
      provider: "youmind",
      id,
      kind: "file",
      url: isYouMindUrl(value) ? value : undefined
    };
  }

  async listBoards(
    token: ConnectorToken,
    input: { query?: string; pageSize?: number } = {}
  ): Promise<YouMindBoard[]> {
    const response = await this.apiRequest(token, "listBoards", {
      fuzzyName: input.query || undefined,
      withFavorite: true,
      pageSize: input.pageSize
    });
    return collectionFromResponse(response, ["boards", "items", "records", "list"])
      .map(toYouMindBoard)
      .filter((item): item is YouMindBoard => Boolean(item));
  }

  async listFiles(
    token: ConnectorToken,
    boardId: string,
    input: ListDocumentsInput = {}
  ): Promise<ConnectorDocumentPage> {
    const payload = compactObject({
      boardId,
      groupId: input.cursor,
      query: input.query,
      pageSize: input.pageSize
    });
    let response: unknown;
    try {
      response = await this.apiRequest(token, "listFiles", payload);
    } catch (error) {
      if (!(error instanceof ConnectorError) || error.code !== "not_found") throw error;
      const [crafts, materials] = await Promise.all([
        this.apiRequest(token, "listCrafts", compactObject({ boardId, groupId: input.cursor })),
        this.apiRequest(token, "listMaterials", compactObject({ boardId, groupId: input.cursor }))
      ]);
      response = [
        ...collectionFromResponse(crafts, ["crafts", "items", "records", "list"]),
        ...collectionFromResponse(materials, ["materials", "items", "records", "list"])
      ];
    }

    const query = input.query?.trim().toLocaleLowerCase();
    const items = fileCollectionFromResponse(response)
      .map(toYouMindDocument)
      .filter((item): item is NonNullable<ReturnType<typeof toYouMindDocument>> => Boolean(item))
      .filter((item) => !query || item.title.toLocaleLowerCase().includes(query));
    return {
      items: input.pageSize ? items.slice(0, input.pageSize) : items,
      nextCursor: readString(asRecord(response), ["nextCursor", "next_cursor"])
    };
  }

  async listDocuments(
    token: ConnectorToken,
    input: ListDocumentsInput = {}
  ): Promise<ConnectorDocumentPage> {
    const boardId = typeof token.metadata?.boardId === "string" ? token.metadata.boardId : undefined;
    if (!boardId) {
      throw new ConnectorError({
        provider: "youmind",
        code: "invalid_source",
        message: "YouMind 列表请求缺少 boardId，请先选择 Board。"
      });
    }
    return this.listFiles(token, boardId, input);
  }

  async fetchDocument(token: ConnectorToken, ref: ExternalDocumentRef): Promise<CanonicalDocument> {
    assertYouMindRef(ref);
    let response: unknown;
    try {
      response = await this.apiRequest(token, "getFile", { id: ref.id, withChildren: true });
    } catch (error) {
      if (!(error instanceof ConnectorError) || error.code !== "not_found") throw error;
      response = await this.apiRequest(token, "getCraft", { id: ref.id, withChildren: true });
    }

    const file = selectDocumentRecord(response);
    const markdown = extractMarkdown(file);
    const parsed = markdown
      ? parseMarkdownToCanonical(markdown, "youmind")
      : { content: extractCanonicalNodes(file), assets: [], warnings: [] };
    const title = readString(file, ["title", "name"]) ?? "Untitled YouMind file";
    const updatedAt = readString(file, ["updatedAt", "updated_at", "modifiedAt", "modified_at"]);
    const sourceUrl = readString(file, ["url", "shareUrl", "share_url"]);

    return {
      ref: { ...ref, url: sourceUrl ?? ref.url },
      title,
      revision: readString(file, ["revision", "version", "updatedAt", "updated_at"]),
      lastEditedAt: updatedAt,
      content: parsed.content.length ? parsed.content : [paragraph("")],
      assets: parsed.assets,
      warnings: [
        ...parsed.warnings,
        ...(!markdown && parsed.content.length === 0
          ? [{
              code: "partial_document" as const,
              message: "YouMind 文件未返回可识别的 Markdown 或文档节点。"
            }]
          : [])
      ]
    };
  }

  async importDocument(token: ConnectorToken, urlOrId: string): Promise<ContentImportResult> {
    return canonicalDocumentToDraftDoc(
      await this.fetchDocument(token, this.resolveDocument(urlOrId))
    );
  }

  private async apiRequest(token: ConnectorToken, endpoint: string, payload: JsonRecord): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": token.accessToken,
        "x-use-camel-case": "true"
      },
      body: JSON.stringify(compactObject(payload))
    });
    if (!response.ok) {
      const code = errorCodeForStatus(response.status);
      throw new ConnectorError({
        provider: "youmind",
        code,
        message: `YouMind OpenAPI 请求失败：${endpoint}`,
        status: response.status,
        retryable: code === "rate_limited" || response.status >= 500,
        details: await readErrorBody(response)
      });
    }
    return response.json().catch(() => undefined);
  }
}

export function createYouMindConnector(config: YouMindConnectorConfig = {}): YouMindConnector {
  return new YouMindConnector(config);
}

export function youMindApiKeyToken(apiKey: string): ConnectorToken {
  const normalized = apiKey.trim();
  if (!/^sk-ym-[A-Za-z0-9_-]{8,}$/.test(normalized)) {
    throw new ConnectorError({
      provider: "youmind",
      code: "authorization_failed",
      message: "YouMind API Key 格式无效，应以 sk-ym- 开头。",
      status: 401
    });
  }
  return { accessToken: normalized, tokenType: "bearer", accountName: "YouMind workspace" };
}

export function parseYouMindFileId(input: string): string | undefined {
  const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const direct = input.match(new RegExp(`^${uuidPattern}$`, "i"))?.[0];
  if (direct) return direct.toLowerCase();
  if (!isYouMindUrl(input)) return undefined;
  try {
    const url = new URL(input);
    const matches = `${url.pathname} ${url.search}`.match(new RegExp(uuidPattern, "gi"));
    return matches?.at(-1)?.toLowerCase();
  } catch {
    return undefined;
  }
}

function assertYouMindRef(ref: ExternalDocumentRef) {
  if (ref.provider !== "youmind") {
    throw new ConnectorError({
      provider: "youmind",
      code: "invalid_source",
      message: "文档引用不属于 YouMind。"
    });
  }
}

function isYouMindUrl(input: string): boolean {
  try {
    return /(^|\.)youmind\.(com|ai)$/.test(new URL(input).hostname);
  } catch {
    return false;
  }
}

function toYouMindBoard(value: unknown): YouMindBoard | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, ["id", "boardId", "board_id"]);
  if (!id) return undefined;
  return {
    id,
    name: readString(record, ["name", "title"]) ?? "Untitled Board",
    status: readString(record, ["status"]),
    favorite: readBoolean(record, ["favorite", "isFavorite", "is_favorite"]),
    updatedAt: readString(record, ["updatedAt", "updated_at"])
  };
}

function toYouMindDocument(value: unknown) {
  const record = asRecord(value);
  if (!record) return undefined;
  const nested = asRecord(record.file) ?? asRecord(record.craft) ?? asRecord(record.material) ?? record;
  const id = readString(nested, ["id", "fileId", "file_id", "craftId", "craft_id", "materialId", "material_id"]);
  if (!id) return undefined;
  const kind = readString(nested, ["type", "kind", "fileType", "file_type"]) ?? "file";
  return {
    provider: "youmind" as const,
    id,
    kind,
    url: readString(nested, ["url", "shareUrl", "share_url"]),
    title: readString(nested, ["title", "name"]) ?? "Untitled YouMind file",
    lastEditedAt: readString(nested, ["updatedAt", "updated_at", "modifiedAt", "modified_at"])
  };
}

function selectDocumentRecord(value: unknown): JsonRecord {
  const record = asRecord(value) ?? {};
  const data = asRecord(record.data) ?? record;
  return asRecord(data.file) ?? asRecord(data.craft) ?? asRecord(data.document) ?? data;
}

function extractMarkdown(record: JsonRecord): string | undefined {
  const direct = readString(record, ["markdown", "contentMarkdown", "content_markdown"]);
  if (direct) return direct;
  for (const key of ["content", "body", "document", "value"]) {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          const nested = asRecord(parsed);
          const markdown = nested ? extractMarkdown(nested) : undefined;
          if (markdown) return markdown;
        } catch {
          // Treat non-JSON content as Markdown below.
        }
      }
      return value;
    }
    const nested = asRecord(value);
    if (nested) {
      const markdown = extractMarkdown(nested);
      if (markdown) return markdown;
    }
  }
  return undefined;
}

function extractCanonicalNodes(record: JsonRecord): CanonicalNode[] {
  const root = asRecord(record.content) ?? asRecord(record.document) ?? record;
  const nodes = Array.isArray(root.content)
    ? root.content
    : Array.isArray(root.children)
      ? root.children
      : [];
  return nodes.flatMap(genericNodeToCanonical);
}

function genericNodeToCanonical(value: unknown): CanonicalNode[] {
  const node = asRecord(value);
  if (!node) return [];
  const type = readString(node, ["type", "kind"]) ?? "paragraph";
  const children = (Array.isArray(node.content) ? node.content : Array.isArray(node.children) ? node.children : [])
    .flatMap(genericNodeToCanonical);
  const text = readString(node, ["text", "value"]);
  if (type === "text") return text ? [{ type: "text", text }] : [];
  if (/heading/i.test(type)) {
    const level = Number(asRecord(node.attrs)?.level ?? type.match(/\d/)?.[0] ?? 1);
    return [{ type: "heading", attrs: { level }, content: children.length ? children : text ? [{ type: "text", text }] : [] }];
  }
  if (/blockquote|quote/i.test(type)) return [{ type: "blockquote", content: children.length ? children : [paragraph(text ?? "")] }];
  if (/code/i.test(type)) return [{ type: "codeBlock", content: text ? [{ type: "text", text }] : children }];
  if (/bullet.*list/i.test(type)) return [{ type: "bulletList", content: children }];
  if (/ordered.*list/i.test(type)) return [{ type: "orderedList", content: children }];
  if (/list.*item/i.test(type)) return [{ type: "listItem", content: children.length ? children : [paragraph(text ?? "")] }];
  if (/horizontal.*rule|divider/i.test(type)) return [{ type: "horizontalRule" }];
  return [{ type: "paragraph", content: children.length ? children : text ? [{ type: "text", text }] : [] }];
}

function collectionFromResponse(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  const data = asRecord(record.data);
  return data ? collectionFromResponse(data, keys) : [];
}

function fileCollectionFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  const files = collectionFromResponse(record, ["files", "items", "records", "list"]);
  if (files.length) return files;
  const crafts = Array.isArray(record.crafts) ? record.crafts : [];
  const materials = Array.isArray(record.materials) ? record.materials : [];
  if (crafts.length || materials.length) return [...crafts, ...materials];
  return record.data ? fileCollectionFromResponse(record.data) : [];
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function readString(record: JsonRecord | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function readBoolean(record: JsonRecord, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  return undefined;
}

function compactObject<T extends JsonRecord>(record: T): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
