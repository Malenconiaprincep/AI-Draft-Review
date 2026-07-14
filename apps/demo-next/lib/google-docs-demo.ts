import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ConnectorError,
  createGoogleDocsConnector,
  type ConnectorToken,
  type GoogleDocsConnectorConfig
} from "@tutti/content-import";

export const GOOGLE_DOCS_SESSION_COOKIE = "tutti_google_docs_session";
export const GOOGLE_DOCS_PICKER_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

type GoogleDocsSession = {
  id: string;
  expiresAt: number;
  token: ConnectorToken;
};

type GooglePickerLocalConfig = {
  clientId?: string;
  apiKey?: string;
  projectNumber?: string;
};

const globalStore = globalThis as typeof globalThis & {
  __tuttiGoogleDocsSessions?: Map<string, GoogleDocsSession>;
};

const sessions = globalStore.__tuttiGoogleDocsSessions ?? new Map<string, GoogleDocsSession>();
globalStore.__tuttiGoogleDocsSessions = sessions;

export function connectGoogleDocs(input: {
  accessToken: string;
  expiresIn?: number;
  source: string;
}) {
  pruneExpiredSessions();
  const accessToken = input.accessToken.trim();
  if (!accessToken || accessToken.length > 8192) {
    throw new ConnectorError({
      provider: "googledocs",
      code: "authorization_failed",
      message: "Google Picker 没有返回有效 access token。",
      status: 401
    });
  }
  const connector = createGoogleDocsConnector(requireGoogleDocsConfig());
  const selected = connector.resolveDocument(input.source);
  const expiresIn = Math.max(60, Math.min(MAX_ACCESS_TOKEN_TTL_SECONDS, input.expiresIn ?? 3600));
  const token: ConnectorToken = {
    accessToken,
    tokenType: "bearer",
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    accountName: "Google account",
    metadata: {
      scope: GOOGLE_DOCS_PICKER_SCOPE,
      selectedDocumentId: selected.id,
      authorizationMode: "picker"
    }
  };
  const session: GoogleDocsSession = {
    id: randomUUID(),
    token,
    expiresAt: Math.min(Date.now() + SESSION_TTL_MS, Date.now() + expiresIn * 1000)
  };
  sessions.set(session.id, session);
  return { sessionId: session.id, token, selected };
}

export function disconnectGoogleDocs(request: Request) {
  const id = readCookie(request, GOOGLE_DOCS_SESSION_COOKIE);
  if (id) sessions.delete(id);
}

export function getGoogleDocsConnection(request: Request) {
  const session = getSession(request);
  return {
    available: isGoogleDocsConfigured(),
    connected: Boolean(session?.token.accessToken),
    accountName: session?.token.accountName,
    mode: "picker" as const
  };
}

export function getGoogleDocsPickerConfig() {
  const localConfig = readGooglePickerLocalConfig();
  const clientId = firstNonEmpty(process.env.GOOGLE_CLIENT_ID, localConfig.clientId);
  const apiKey = firstNonEmpty(process.env.GOOGLE_PICKER_API_KEY, localConfig.apiKey);
  const appId = firstNonEmpty(process.env.GOOGLE_CLOUD_PROJECT_NUMBER, localConfig.projectNumber);
  return {
    available: Boolean(clientId && apiKey && appId),
    clientId,
    apiKey,
    appId,
    scope: GOOGLE_DOCS_PICKER_SCOPE
  };
}

export async function getGoogleDocsToken(request: Request): Promise<ConnectorToken> {
  const session = getSession(request);
  if (!session?.token.accessToken) {
    throw new ConnectorError({
      provider: "googledocs",
      code: "authorization_failed",
      message: "请通过 Google Picker 重新选择文档。",
      status: 401
    });
  }
  return session.token;
}

export function getGoogleDocsApiConfig(): Pick<
  GoogleDocsConnectorConfig,
  "docsApiBaseUrl" | "driveApiBaseUrl"
> {
  return {
    docsApiBaseUrl: process.env.GOOGLE_DOCS_API_BASE_URL,
    driveApiBaseUrl: process.env.GOOGLE_DRIVE_API_BASE_URL
  };
}

export function createConfiguredGoogleDocsConnector() {
  return createGoogleDocsConnector(requireGoogleDocsConfig());
}

function requireGoogleDocsConfig(): GoogleDocsConnectorConfig {
  const clientId = getGoogleDocsPickerConfig().clientId;
  if (!clientId) throw new Error("missing_google_docs_config");
  return { clientId, ...getGoogleDocsApiConfig() };
}

function readGooglePickerLocalConfig(): GooglePickerLocalConfig {
  const candidates = [
    join(process.cwd(), "google-picker.config.local.json"),
    join(process.cwd(), "apps/demo-next/google-picker.config.local.json")
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as GooglePickerLocalConfig;
    } catch {
      throw new Error(`invalid_google_picker_local_config:${path}`);
    }
  }
  return {};
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function isGoogleDocsConfigured(): boolean {
  return getGoogleDocsPickerConfig().available;
}

function getSession(request: Request): GoogleDocsSession | undefined {
  pruneExpiredSessions();
  const id = readCookie(request, GOOGLE_DOCS_SESSION_COOKIE);
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
