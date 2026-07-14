import { randomUUID } from "node:crypto";
import {
  ConnectorError,
  createYouMindConnector,
  type ConnectorToken,
  type YouMindConnectorConfig
} from "@tutti/content-import";

export const YOUMIND_SESSION_COOKIE = "tutti_youmind_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type YouMindSession = {
  id: string;
  expiresAt: number;
  token: ConnectorToken;
};

const globalStore = globalThis as typeof globalThis & {
  __tuttiYouMindSessions?: Map<string, YouMindSession>;
};

const sessions = globalStore.__tuttiYouMindSessions ?? new Map<string, YouMindSession>();
globalStore.__tuttiYouMindSessions = sessions;

export async function connectYouMind(apiKey?: string) {
  pruneExpiredSessions();
  const connector = createYouMindConnector(getYouMindApiConfig());
  const token = await connector.exchangeAuthorization(apiKey?.trim() || configuredApiKey());
  const session: YouMindSession = {
    id: randomUUID(),
    token,
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  sessions.set(session.id, session);
  return { sessionId: session.id, token };
}

export function disconnectYouMind(request: Request) {
  const id = readCookie(request, YOUMIND_SESSION_COOKIE);
  if (id) sessions.delete(id);
}

export function getYouMindConnection(request: Request) {
  const token = getSession(request)?.token;
  return {
    available: true,
    connected: Boolean(token),
    accountName: token?.accountName ?? (token ? "YouMind workspace" : undefined),
    mode: process.env.YOUMIND_IMPORT_API_KEY ? "server-key" as const : "api-key" as const,
    settingsUrl: "https://youmind.com/settings/api-keys"
  };
}

export function getYouMindToken(request: Request): ConnectorToken {
  const token = getSession(request)?.token;
  if (!token) {
    throw new ConnectorError({
      provider: "youmind",
      code: "authorization_failed",
      message: "请先连接 YouMind API Key。",
      status: 401
    });
  }
  return token;
}

export function getYouMindApiConfig(): YouMindConnectorConfig {
  return { apiBaseUrl: process.env.YOUMIND_API_BASE_URL };
}

export function isYouMindArticleKind(kind: string): boolean {
  return kind.trim().toLocaleLowerCase() === "article";
}

function configuredApiKey(): string {
  const apiKey = process.env.YOUMIND_IMPORT_API_KEY;
  if (!apiKey) {
    throw new ConnectorError({
      provider: "youmind",
      code: "authorization_failed",
      message: "请输入 YouMind API Key。",
      status: 401
    });
  }
  return apiKey;
}

function getSession(request: Request): YouMindSession | undefined {
  pruneExpiredSessions();
  const id = readCookie(request, YOUMIND_SESSION_COOKIE);
  return id ? sessions.get(id) : undefined;
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
