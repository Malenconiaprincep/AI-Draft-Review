import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ConnectorError,
  createFeishuConnector,
  type ConnectorToken,
  type FeishuConnectorConfig
} from "@tutti/content-import";
import { registerTuttiFeishuApp } from "./feishu-register-app";

export const FEISHU_SESSION_COOKIE = "tutti_feishu_session";
export const FEISHU_LOCAL_DEMO_ACCOUNT = "本地飞书演示账号";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;
const REGISTRATION_READY_TIMEOUT_MS = 20 * 1000;

type FeishuAppCredentials = {
  clientId: string;
  clientSecret: string;
  tenantBrand?: "feishu" | "lark";
};

type FeishuRegistration = {
  status: "starting" | "awaiting_user" | "registered" | "failed";
  authorizationUrl?: string;
  expiresAt?: number;
  error?: string;
  abortController: AbortController;
};

type FeishuSession = {
  id: string;
  state?: string;
  redirectUri: string;
  expiresAt: number;
  token?: ConnectorToken;
  appCredentials?: FeishuAppCredentials;
  registration?: FeishuRegistration;
  refreshPromise?: Promise<ConnectorToken>;
};

const globalStore = globalThis as typeof globalThis & {
  __tuttiFeishuSessions?: Map<string, FeishuSession>;
};

const sessions = globalStore.__tuttiFeishuSessions ?? new Map<string, FeishuSession>();
globalStore.__tuttiFeishuSessions = sessions;

export function beginFeishuAuthorization(request: Request) {
  pruneExpiredSessions();
  const redirectUri = getFeishuRedirectUri(request);
  const state = randomBytes(32).toString("hex");
  const session = isFeishuDynamicAppEnabled()
    ? requireRegisteredAppSession(request)
    : createFeishuSession(redirectUri);
  session.state = state;
  session.redirectUri = redirectUri;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  if (isFeishuLocalDemoEnabled()) {
    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set("code", "local-demo");
    callbackUrl.searchParams.set("state", state);
    return {
      sessionId: session.id,
      authorizationUrl: callbackUrl.toString()
    };
  }
  const connector = createFeishuConnector(requireFeishuConfig(redirectUri, session));
  return {
    sessionId: session.id,
    authorizationUrl: connector.getAuthorizationUrl(state)
  };
}

export async function finishFeishuAuthorization(request: Request) {
  const session = requireSession(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  validateState(session, url.searchParams.get("state"));
  session.state = undefined;
  if (!code) throw new Error("missing_code");

  if (code === "local-demo" && isFeishuLocalDemoEnabled()) {
    session.token = {
      accessToken: "local-feishu-demo-token",
      tokenType: "bearer",
      accountId: "local-feishu-demo-user",
      accountName: FEISHU_LOCAL_DEMO_ACCOUNT,
      metadata: { localDemo: true, appType: "store" }
    };
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session.token;
  }

  const connector = createFeishuConnector(requireFeishuConfig(session.redirectUri, session));
  session.token = await connector.exchangeAuthorization(code);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session.token;
}

export function validateFeishuAuthorizationState(request: Request) {
  const session = requireSession(request);
  const state = new URL(request.url).searchParams.get("state");
  validateState(session, state);
  session.state = undefined;
}

export function getFeishuConnection(request: Request) {
  const session = getSession(request);
  const localDemo = isFeishuLocalDemoEnabled();
  const dynamicApp = isFeishuDynamicAppEnabled();
  return {
    available: isFeishuConfigured() || localDemo || dynamicApp,
    connected: Boolean(session?.token?.accessToken),
    accountName: session?.token?.accountName || (session?.token ? "飞书账号" : undefined),
    mode: localDemo
      ? "local-demo" as const
      : dynamicApp
        ? "dynamic-app" as const
        : "oauth" as const,
    appType: dynamicApp ? "custom" as const : "store" as const
  };
}

export async function startFeishuAppRegistration(request: Request) {
  if (!isFeishuDynamicAppEnabled()) {
    throw new Error("dynamic_registration_unavailable");
  }
  pruneExpiredSessions();
  const redirectUri = getFeishuRedirectUri(request);
  const existingSession = getSession(request);
  const session = existingSession ?? createFeishuSession(redirectUri);
  session.redirectUri = redirectUri;
  session.expiresAt = Date.now() + SESSION_TTL_MS;

  if (session.appCredentials) {
    return { sessionId: session.id, ...registrationView(session) };
  }
  if (
    session.registration?.status === "awaiting_user"
    && session.registration.authorizationUrl
    && (session.registration.expiresAt ?? 0) > Date.now()
  ) {
    return { sessionId: session.id, ...registrationView(session) };
  }

  session.registration?.abortController.abort();
  const abortController = new AbortController();
  session.registration = { status: "starting", abortController };

  let resolveReady: (() => void) | undefined;
  let rejectReady: ((reason: unknown) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  void registerTuttiFeishuApp({
    signal: abortController.signal,
    onAuthorizationUrl(info) {
      if (session.registration?.abortController !== abortController) return;
      session.registration.status = "awaiting_user";
      session.registration.authorizationUrl = info.url;
      session.registration.expiresAt = Date.now() + info.expireIn * 1000;
      resolveReady?.();
    }
  }).then((result) => {
    if (session.registration?.abortController !== abortController) return;
    session.appCredentials = {
      clientId: result.clientId,
      clientSecret: result.clientSecret,
      tenantBrand: result.tenantBrand
    };
    session.registration.status = "registered";
    session.registration.authorizationUrl = undefined;
    session.registration.expiresAt = undefined;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
  }).catch((error: unknown) => {
    if (session.registration?.abortController !== abortController) return;
    const detail = registrationErrorMessage(error);
    session.registration.status = "failed";
    session.registration.error = detail;
    rejectReady?.(new Error(detail));
  });

  await Promise.race([
    ready,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("生成飞书授权链接超时，请重试。")), REGISTRATION_READY_TIMEOUT_MS);
    })
  ]);
  return { sessionId: session.id, ...registrationView(session) };
}

export function getFeishuAppRegistration(request: Request) {
  const session = getSession(request);
  return session ? registrationView(session) : { status: "idle" as const };
}

export function isFeishuLocalDemoToken(token: ConnectorToken): boolean {
  return token.metadata?.localDemo === true;
}

export async function getFeishuToken(request: Request): Promise<ConnectorToken> {
  const session = requireSession(request);
  if (!session.token?.accessToken) {
    throw new ConnectorError({
      provider: "feishu",
      code: "authorization_failed",
      message: "请先点击 Connect 飞书完成 OAuth 授权。",
      status: 401
    });
  }

  if (!tokenNeedsRefresh(session.token)) return session.token;
  if (!session.refreshPromise) {
    const currentToken = session.token;
    session.refreshPromise = (async () => {
      const connector = createFeishuConnector(requireFeishuConfig(session.redirectUri, session));
      const refreshed = await connector.refreshAuthorization(currentToken);
      session.token = refreshed;
      session.expiresAt = Date.now() + SESSION_TTL_MS;
      return refreshed;
    })();
  }
  const refreshPromise = session.refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (session.refreshPromise === refreshPromise) session.refreshPromise = undefined;
  }
}

export function getFeishuApiConfig(): Pick<
  FeishuConnectorConfig,
  "apiBaseUrl" | "accountsBaseUrl"
> {
  return {
    apiBaseUrl: process.env.FEISHU_API_BASE_URL,
    accountsBaseUrl: process.env.FEISHU_ACCOUNTS_BASE_URL
  };
}

function requireFeishuConfig(
  redirectUri: string,
  session?: FeishuSession
): FeishuConnectorConfig {
  const clientId = session?.appCredentials?.clientId ?? process.env.FEISHU_APP_ID;
  const clientSecret = session?.appCredentials?.clientSecret ?? process.env.FEISHU_APP_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("missing_feishu_config");
  }
  const dynamicBrand = session?.appCredentials?.tenantBrand;
  const brandApiBaseUrl = dynamicBrand === "lark" ? "https://open.larksuite.com" : undefined;
  const brandAccountsBaseUrl = dynamicBrand === "lark" ? "https://accounts.larksuite.com" : undefined;
  return {
    clientId,
    clientSecret,
    redirectUri,
    ...getFeishuApiConfig(),
    apiBaseUrl: process.env.FEISHU_API_BASE_URL ?? brandApiBaseUrl,
    accountsBaseUrl: process.env.FEISHU_ACCOUNTS_BASE_URL ?? brandAccountsBaseUrl
  };
}

function isFeishuConfigured(): boolean {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

function isFeishuLocalDemoEnabled(): boolean {
  if (isFeishuConfigured()) return false;
  if (process.env.FEISHU_APP_ID || process.env.FEISHU_APP_SECRET) return false;
  return process.env.FEISHU_LOCAL_DEMO === "true" || process.env.FEISHU_LOCAL_DEMO === "1";
}

function isFeishuDynamicAppEnabled(): boolean {
  if (isFeishuConfigured() || isFeishuLocalDemoEnabled()) return false;
  if (process.env.FEISHU_APP_ID || process.env.FEISHU_APP_SECRET) return false;
  if (process.env.FEISHU_DYNAMIC_APP === "false" || process.env.FEISHU_DYNAMIC_APP === "0") {
    return false;
  }
  return process.env.NODE_ENV !== "production" || process.env.FEISHU_DYNAMIC_APP === "true";
}

function getFeishuRedirectUri(request: Request): string {
  return process.env.FEISHU_REDIRECT_URI
    || new URL("/api/connectors/feishu/callback", request.url).toString();
}

function tokenNeedsRefresh(token: ConnectorToken): boolean {
  if (!token.expiresAt) return false;
  const expiresAt = Date.parse(token.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + REFRESH_EARLY_MS;
}

function getSession(request: Request): FeishuSession | undefined {
  pruneExpiredSessions();
  const id = readCookie(request, FEISHU_SESSION_COOKIE);
  return id ? sessions.get(id) : undefined;
}

function createFeishuSession(redirectUri: string): FeishuSession {
  const session: FeishuSession = {
    id: randomUUID(),
    redirectUri,
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  sessions.set(session.id, session);
  return session;
}

function requireRegisteredAppSession(request: Request): FeishuSession {
  const session = requireSession(request);
  if (!session.appCredentials) {
    throw new ConnectorError({
      provider: "feishu",
      code: "authorization_failed",
      message: "请先打开飞书动态链接并确认创建应用。",
      status: 409
    });
  }
  return session;
}

function requireSession(request: Request): FeishuSession {
  const session = getSession(request);
  if (!session) {
    throw new ConnectorError({
      provider: "feishu",
      code: "authorization_failed",
      message: "飞书授权会话不存在或已过期，请重新连接。",
      status: 401
    });
  }
  return session;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      session.registration?.abortController.abort();
      sessions.delete(id);
    }
  }
}

function registrationView(session: FeishuSession) {
  if (session.appCredentials) {
    return {
      status: "registered" as const,
      continueUrl: "/api/connectors/feishu/authorize"
    };
  }
  if (!session.registration) return { status: "idle" as const };
  return {
    status: session.registration.status,
    authorizationUrl: session.registration.authorizationUrl,
    expiresAt: session.registration.expiresAt
      ? new Date(session.registration.expiresAt).toISOString()
      : undefined,
    error: session.registration.error
  };
}

function registrationErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; description?: unknown; message?: unknown };
    if (value.code === "access_denied") return "你取消了飞书应用创建。";
    if (value.code === "expired_token") return "飞书动态链接已过期，请重新生成。";
    if (typeof value.description === "string" && value.description) return value.description;
    if (typeof value.message === "string" && value.message) return value.message;
  }
  return "创建飞书应用失败，请重试。";
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

function validateState(session: FeishuSession, state: string | null) {
  if (!state || !session.state || !safeEqual(state, session.state)) {
    throw new Error("invalid_state");
  }
}
