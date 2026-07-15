import { canonicalDocumentToDraftDoc } from "./canonical.ts";
import { ConnectorError, errorCodeForStatus, readErrorBody } from "./errors.ts";
import { parseMarkdownToCanonical } from "./markdown.ts";
import { notionMarkdownAdapter } from "./notion-markdown-adapter.ts";
import { importPublicNotionDocument } from "./notion-public.ts";
import type {
  CanonicalDocument,
  ConnectorDocumentPage,
  ConnectorToken,
  ContentConnector,
  ContentImportResult,
  ExternalDocumentRef,
  FetchLike,
  ListDocumentsInput
} from "./types.ts";

const NOTION_API_VERSION = "2026-03-11";

export type NotionConnectorConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl?: string;
  publicApiBaseUrl?: string;
  fetch?: FetchLike;
};

type NotionPage = {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProperty>;
};

type NotionProperty = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
};

type NotionMarkdownResponse = {
  id: string;
  markdown: string;
  truncated: boolean;
  unknown_block_ids: string[];
};

export class NotionConnector implements ContentConnector {
  readonly provider = "notion" as const;
  private readonly config: NotionConnectorConfig;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly publicApiBaseUrl: string;

  constructor(config: NotionConnectorConfig) {
    this.config = config;
    this.fetchImpl = config.fetch ?? fetch;
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://api.notion.com").replace(/\/$/, "");
    this.publicApiBaseUrl = (config.publicApiBaseUrl ?? "https://www.notion.so").replace(/\/$/, "");
  }

  getAuthorizationUrl(state: string): string {
    const url = new URL(`${this.apiBaseUrl}/v1/oauth/authorize`);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorization(code: string): Promise<ConnectorToken> {
    const response = await this.oauthTokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri
    });
    return notionTokenFromResponse(response);
  }

  async refreshAuthorization(token: ConnectorToken): Promise<ConnectorToken> {
    if (!token.refreshToken) {
      throw new ConnectorError({
        provider: "notion",
        code: "token_refresh_failed",
        message: "Notion 连接缺少 refresh token，需要用户重新授权。"
      });
    }
    const response = await this.oauthTokenRequest({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken
    });
    return notionTokenFromResponse(response);
  }

  resolveDocument(urlOrId: string): ExternalDocumentRef {
    const trimmed = urlOrId.trim();
    const id = parseNotionPageId(trimmed);
    if (!id) {
      throw new ConnectorError({
        provider: "notion",
        code: "invalid_source",
        message: "无法从输入中识别 Notion page ID。"
      });
    }
    return {
      provider: "notion",
      id,
      kind: "page",
      url: isHttpUrl(trimmed) ? trimmed : undefined
    };
  }

  async listDocuments(
    token: ConnectorToken,
    input: ListDocumentsInput = {}
  ): Promise<ConnectorDocumentPage> {
    const body: Record<string, unknown> = {
      page_size: Math.min(100, Math.max(1, input.pageSize ?? 50)),
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" }
    };
    if (input.query) body.query = input.query;
    if (input.cursor) body.start_cursor = input.cursor;

    const response = await this.apiRequest<{
      results: NotionPage[];
      has_more: boolean;
      next_cursor?: string | null;
    }>(token, "/v1/search", { method: "POST", body: JSON.stringify(body) });

    return {
      items: response.results.map((page) => ({
        provider: "notion" as const,
        id: page.id,
        kind: "page",
        url: page.url,
        title: notionPageTitle(page),
        lastEditedAt: page.last_edited_time
      })),
      nextCursor: response.has_more ? response.next_cursor ?? undefined : undefined
    };
  }

  async fetchDocument(token: ConnectorToken, ref: ExternalDocumentRef): Promise<CanonicalDocument> {
    assertNotionRef(ref);
    const page = await this.apiRequest<NotionPage>(token, `/v1/pages/${ref.id}`);
    const resolved = await this.fetchCompleteMarkdown(token, ref.id);
    const parsed = parseMarkdownToCanonical(resolved.markdown, "notion", notionMarkdownAdapter);

    return {
      ref: { ...ref, id: page.id, url: page.url ?? ref.url },
      title: notionPageTitle(page),
      revision: page.last_edited_time,
      lastEditedAt: page.last_edited_time,
      content: parsed.content,
      assets: parsed.assets,
      warnings: [
        ...parsed.warnings,
        ...(resolved.partial
          ? [
              {
                code: "partial_document" as const,
                message: "部分 Notion 子块因权限或服务限制未能读取。"
              }
            ]
          : [])
      ]
    };
  }

  async importDocument(token: ConnectorToken, urlOrId: string): Promise<ContentImportResult> {
    const ref = this.resolveDocument(urlOrId);
    return canonicalDocumentToDraftDoc(await this.fetchDocument(token, ref));
  }

  async importPublicDocument(source: string): Promise<ContentImportResult> {
    return importPublicNotionDocument({
      fetch: this.fetchImpl,
      apiBaseUrl: this.publicApiBaseUrl,
      ref: this.resolveDocument(source)
    });
  }

  private async fetchCompleteMarkdown(
    token: ConnectorToken,
    pageId: string
  ): Promise<{ markdown: string; partial: boolean }> {
    const root = await this.apiRequest<NotionMarkdownResponse>(
      token,
      `/v1/pages/${pageId}/markdown`
    );
    let markdown = root.markdown;
    let partial = false;
    const pending = [...root.unknown_block_ids];
    const visited = new Set<string>([pageId]);

    while (pending.length > 0) {
      const blockId = pending.shift()!;
      if (visited.has(blockId)) continue;
      visited.add(blockId);
      try {
        const child = await this.apiRequest<NotionMarkdownResponse>(
          token,
          `/v1/pages/${blockId}/markdown`
        );
        markdown = replaceUnknownBlock(markdown, blockId, child.markdown);
        pending.push(...child.unknown_block_ids);
      } catch (error) {
        if (error instanceof ConnectorError && (error.code === "not_found" || error.code === "access_denied")) {
          partial = true;
          continue;
        }
        throw error;
      }
    }

    return { markdown, partial: partial || (root.truncated && root.unknown_block_ids.length === 0) };
  }

  private async oauthTokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
    const authorization = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      "utf8"
    ).toString("base64");
    const response = await this.fetchImpl(`${this.apiBaseUrl}/v1/oauth/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${authorization}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new ConnectorError({
        provider: "notion",
        code: body.grant_type === "refresh_token" ? "token_refresh_failed" : "authorization_failed",
        message: "Notion OAuth 请求失败。",
        status: response.status,
        details: await readErrorBody(response)
      });
    }
    return response.json() as Promise<Record<string, unknown>>;
  }

  private async apiRequest<T>(
    token: ConnectorToken,
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
        ...init.headers
      }
    });
    if (!response.ok) {
      const code = errorCodeForStatus(response.status);
      throw new ConnectorError({
        provider: "notion",
        code,
        message: `Notion API 请求失败：${path}`,
        status: response.status,
        retryable: code === "rate_limited" || response.status >= 500,
        details: await readErrorBody(response)
      });
    }
    return response.json() as Promise<T>;
  }
}

export function createNotionConnector(config: NotionConnectorConfig): NotionConnector {
  return new NotionConnector(config);
}

export function parseNotionPageId(input: string): string | undefined {
  const direct = normalizeUuid(input);
  if (direct) return direct;
  if (!isHttpUrl(input)) return undefined;

  try {
    const url = new URL(input);
    if (!/(^|\.)notion\.(so|site|com)$/.test(url.hostname)) return undefined;
    const candidates = `${url.pathname} ${url.search}`.match(/[a-f0-9]{32}|[a-f0-9-]{36}/gi) ?? [];
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const normalized = normalizeUuid(candidates[index]);
      if (normalized) return normalized;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeUuid(value: string): string | undefined {
  const compact = value.replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(compact)) return undefined;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toLowerCase();
}

function notionTokenFromResponse(response: Record<string, unknown>): ConnectorToken {
  if (typeof response.access_token !== "string") {
    throw new ConnectorError({
      provider: "notion",
      code: "invalid_provider_response",
      message: "Notion OAuth 响应缺少 access_token。",
      details: response
    });
  }
  return {
    accessToken: response.access_token,
    refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : undefined,
    tokenType: "bearer",
    accountId: typeof response.bot_id === "string" ? response.bot_id : undefined,
    accountName: typeof response.workspace_name === "string" ? response.workspace_name : undefined,
    metadata: {
      workspaceId: response.workspace_id,
      workspaceIcon: response.workspace_icon,
      owner: response.owner
    }
  };
}

function notionPageTitle(page: NotionPage): string {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title" || property.title) {
      const title = property.title?.map((item) => item.plain_text ?? "").join("").trim();
      if (title) return title;
    }
  }
  return "Untitled Notion page";
}

function replaceUnknownBlock(markdown: string, blockId: string, childMarkdown: string): string {
  const compact = blockId.replace(/-/g, "");
  const pattern = new RegExp(`<unknown\\b[^>]*(?:${escapeRegExp(blockId)}|${escapeRegExp(compact)})[^>]*/?>`, "i");
  if (pattern.test(markdown)) return markdown.replace(pattern, childMarkdown);
  return `${markdown}\n\n${childMarkdown}`;
}

function assertNotionRef(ref: ExternalDocumentRef): void {
  if (ref.provider !== "notion" || ref.kind !== "page") {
    throw new ConnectorError({
      provider: "notion",
      code: "invalid_source",
      message: "文档引用不是 Notion page。"
    });
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
