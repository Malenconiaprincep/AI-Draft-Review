import type {
  OAuthClientInformationMixed,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";

export const NOTION_MCP_STATE_COOKIE = "tutti_notion_mcp_state";

const COOKIE_VERSION = 1;
const MAX_COOKIE_VALUE_BYTES = 3_800;

export type PersistedNotionMcpSession = {
  id: string;
  state: string;
  redirectUrl: string;
  expiresAt: number;
  codeVerifier?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  accountName?: string;
  accountId?: string;
};

export function encodeNotionMcpSessionCookie(session: PersistedNotionMcpSession): string {
  const value = Buffer.from(JSON.stringify({
    version: COOKIE_VERSION,
    id: session.id,
    state: session.state,
    redirectUrl: session.redirectUrl,
    expiresAt: session.expiresAt,
    codeVerifier: session.codeVerifier,
    clientInformation: session.clientInformation,
    tokens: session.tokens,
    accountName: session.accountName,
    accountId: session.accountId
  })).toString("base64url");
  if (Buffer.byteLength(value) > MAX_COOKIE_VALUE_BYTES) {
    throw new Error("notion_session_cookie_too_large");
  }
  return value;
}

export function decodeNotionMcpSessionCookie(
  value: string,
  expectedRedirectUrl: string,
  now = Date.now()
): PersistedNotionMcpSession | undefined {
  try {
    const record = asRecord(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (
      record.version !== COOKIE_VERSION
      || typeof record.id !== "string"
      || !record.id
      || typeof record.state !== "string"
      || !/^[a-f0-9]{64}$/.test(record.state)
      || record.redirectUrl !== expectedRedirectUrl
      || typeof record.expiresAt !== "number"
      || !Number.isFinite(record.expiresAt)
      || record.expiresAt <= now
    ) return undefined;

    const clientInformation = optionalRecord(record.clientInformation);
    if (clientInformation && typeof clientInformation.client_id !== "string") return undefined;
    const tokens = optionalRecord(record.tokens);
    if (tokens && (typeof tokens.access_token !== "string" || !tokens.access_token)) return undefined;

    return {
      id: record.id,
      state: record.state,
      redirectUrl: record.redirectUrl,
      expiresAt: record.expiresAt,
      codeVerifier: optionalString(record.codeVerifier),
      clientInformation: clientInformation as OAuthClientInformationMixed | undefined,
      tokens: tokens as OAuthTokens | undefined,
      accountName: optionalString(record.accountName),
      accountId: optionalString(record.accountId)
    };
  } catch {
    return undefined;
  }
}

export function mergeNotionMcpTokens(
  current: OAuthTokens | undefined,
  next: OAuthTokens
): OAuthTokens {
  return {
    ...next,
    ...(next.refresh_token
      ? {}
      : current?.refresh_token
        ? { refresh_token: current.refresh_token }
        : {})
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  return Object.keys(record).length ? record : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
