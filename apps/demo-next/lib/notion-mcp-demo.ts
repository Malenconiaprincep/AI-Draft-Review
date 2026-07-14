import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";

export const NOTION_MCP_SESSION_COOKIE = "tutti_notion_mcp_session";
export const NOTION_MCP_SERVER_URL = process.env.NOTION_MCP_SERVER_URL || "https://mcp.notion.com/mcp";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type NotionMcpSession = {
  id: string;
  state: string;
  redirectUrl: string;
  expiresAt: number;
  authorizationUrl?: string;
  codeVerifier?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  accountName?: string;
  accountId?: string;
};

export type NotionMcpPageSummary = {
  id: string;
  title: string;
  url: string;
  type: string;
  highlight?: string;
  timestamp?: string;
};

const globalStore = globalThis as typeof globalThis & {
  __tuttiNotionMcpSessions?: Map<string, NotionMcpSession>;
};

const sessions = globalStore.__tuttiNotionMcpSessions ?? new Map<string, NotionMcpSession>();
globalStore.__tuttiNotionMcpSessions = sessions;

class NotionMcpOAuthProvider implements OAuthClientProvider {
  constructor(private readonly session: NotionMcpSession) {}

  get redirectUrl() {
    return this.session.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Tutti Content Import",
      redirect_uris: [this.session.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    };
  }

  state() {
    return this.session.state;
  }

  clientInformation() {
    return this.session.clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.session.clientInformation = clientInformation;
  }

  tokens() {
    return this.session.tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    this.session.tokens = tokens;
    this.session.expiresAt = Date.now() + SESSION_TTL_MS;
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.session.authorizationUrl = authorizationUrl.toString();
  }

  saveCodeVerifier(codeVerifier: string) {
    this.session.codeVerifier = codeVerifier;
  }

  codeVerifier() {
    if (!this.session.codeVerifier) throw new Error("Notion MCP OAuth 缺少 PKCE code verifier。");
    return this.session.codeVerifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") this.session.clientInformation = undefined;
    if (scope === "all" || scope === "tokens") this.session.tokens = undefined;
    if (scope === "all" || scope === "verifier") this.session.codeVerifier = undefined;
  }
}

export async function beginNotionMcpAuthorization(request: Request) {
  pruneExpiredSessions();
  const id = randomUUID();
  const session: NotionMcpSession = {
    id,
    state: randomBytes(32).toString("hex"),
    redirectUrl: new URL("/api/connectors/notion/callback", request.url).toString(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  sessions.set(id, session);

  const provider = new NotionMcpOAuthProvider(session);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transport = createTransport(provider);
    const client = createClient();
    try {
      await client.connect(transport);
      await client.close();
      throw new Error("Notion MCP 未要求授权，无法启动 OAuth 流程。");
    } catch (error) {
      if (error instanceof UnauthorizedError && session.authorizationUrl) {
        return { sessionId: id, authorizationUrl: session.authorizationUrl };
      }
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt === 2) break;
      await delay(250 * (attempt + 1));
    }
  }

  sessions.delete(id);
  throw lastError;
}

export async function finishNotionMcpAuthorization(request: Request) {
  const session = requireSession(request);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !safeEqual(state, session.state)) throw new Error("invalid_state");
  if (!code) throw new Error("missing_code");

  const provider = new NotionMcpOAuthProvider(session);
  const transport = createTransport(provider);
  await transport.finishAuth(code);

  const identity = await withMcpClientRetry(provider, (client) =>
    client.callTool({ name: "notion-fetch", arguments: { id: "self" } })
  );
  try {
    assertNotionMcpToolSuccess(identity);
    const account = parseNotionMcpIdentity(identity);
    session.accountName = account.name;
    session.accountId = account.id;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return account;
  } catch (error) {
    session.tokens = undefined;
    throw error;
  }
}

export async function callNotionMcpFetch(request: Request, source: string): Promise<unknown> {
  const session = requireConnectedSession(request);
  const provider = new NotionMcpOAuthProvider(session);
  const result = await withMcpClientRetry(provider, (client) =>
    client.callTool({ name: "notion-fetch", arguments: { id: source } })
  );
  assertNotionMcpToolSuccess(result);
  return result;
}

export async function searchNotionMcpPages(
  request: Request,
  query: string
): Promise<NotionMcpPageSummary[]> {
  const session = requireConnectedSession(request);
  const provider = new NotionMcpOAuthProvider(session);
  const result = await withMcpClientRetry(provider, (client) =>
    client.callTool({
      name: "notion-search",
      arguments: {
        query,
        query_type: "internal",
        page_size: 12,
        max_highlight_length: 120
      }
    })
  );
  assertNotionMcpToolSuccess(result);
  return parseNotionMcpSearchResult(result);
}

export function getNotionMcpConnection(request: Request) {
  const session = getSession(request);
  return {
    connected: Boolean(session?.tokens?.access_token),
    accountName: session?.accountName,
    accountId: session?.accountId
  };
}

function createClient() {
  return new Client({ name: "tutti-content-import", version: "0.1.0" }, { capabilities: {} });
}

function createTransport(provider: OAuthClientProvider) {
  return new StreamableHTTPClientTransport(new URL(NOTION_MCP_SERVER_URL), { authProvider: provider });
}

async function withMcpClientRetry<T>(
  provider: OAuthClientProvider,
  operation: (client: Client) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = createClient();
    try {
      await client.connect(createTransport(provider));
      return await operation(client);
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt === 2) break;
      await delay(250 * (attempt + 1));
    } finally {
      await client.close().catch(() => undefined);
    }
  }
  throw lastError;
}

function getSession(request: Request): NotionMcpSession | undefined {
  pruneExpiredSessions();
  const id = readCookie(request, NOTION_MCP_SESSION_COOKIE);
  return id ? sessions.get(id) : undefined;
}

function requireSession(request: Request): NotionMcpSession {
  const session = getSession(request);
  if (!session) throw new Error("missing_session");
  return session;
}

function requireConnectedSession(request: Request): NotionMcpSession {
  const session = requireSession(request);
  if (!session.tokens?.access_token) throw new Error("not_connected");
  return session;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertNotionMcpToolSuccess(result: unknown) {
  const record = asRecord(result);
  if (record.isError !== true) return;
  const structured = asRecord(record.structuredContent);
  const content = Array.isArray(record.content) ? record.content : [];
  const firstText = content
    .map(asRecord)
    .find((item) => item.type === "text" && typeof item.text === "string")?.text;
  const rawMessage =
    typeof structured.error === "string"
      ? structured.error
      : typeof firstText === "string"
        ? firstText
        : "Notion MCP 返回读取错误。";

  if (/object_not_found|could not find page|not found/i.test(rawMessage)) {
    throw new Error("Notion 找不到这个页面。请确认授权的是页面所在工作区，并且当前账号拥有该页面的访问权限。");
  }
  if (/unauthorized|invalid_token|forbidden|permission/i.test(rawMessage)) {
    throw new Error("Notion 授权已失效或没有页面权限，请重新 Connect Notion 后再试。");
  }
  throw new Error(`Notion MCP 读取失败：${rawMessage}`);
}

function isRetryableNetworkError(error: unknown): boolean {
  const messages: string[] = [];
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  while (pending.length) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    messages.push(String(current));
    const record = asRecord(current);
    if (record.cause) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors);
  }
  return messages.some((message) =>
    /fetch failed|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/i.test(message)
  );
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function parseNotionMcpIdentity(result: unknown): { id?: string; name?: string } {
  const payload = parseMcpPayload(result);
  const self = asRecord(payload.self);
  const workspace = asRecord(self.workspace);
  return {
    id: typeof workspace.id === "string" ? workspace.id : undefined,
    name: typeof workspace.name === "string" ? workspace.name : "Notion workspace"
  };
}

function parseNotionMcpSearchResult(result: unknown): NotionMcpPageSummary[] {
  const payload = parseMcpPayload(result);
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.flatMap((value) => {
    const item = asRecord(value);
    if (typeof item.id !== "string" || typeof item.url !== "string") return [];
    return [{
      id: item.id,
      title: typeof item.title === "string" && item.title.trim() ? item.title : "未命名页面",
      url: item.url,
      type: typeof item.type === "string" ? item.type : "page",
      highlight: typeof item.highlight === "string" ? item.highlight : undefined,
      timestamp: typeof item.timestamp === "string" ? item.timestamp : undefined
    }];
  });
}

function parseMcpPayload(result: unknown): Record<string, unknown> {
  const record = asRecord(result);
  const structured = asRecord(record.structuredContent);
  if (Object.keys(structured).length) return structured;
  const content = Array.isArray(record.content) ? record.content : [];
  for (const block of content) {
    const item = asRecord(block);
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      return asRecord(JSON.parse(item.text));
    } catch {
      continue;
    }
  }
  return {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
