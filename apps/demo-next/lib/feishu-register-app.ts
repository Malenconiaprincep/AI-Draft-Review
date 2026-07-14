import { gzipSync } from "node:zlib";

const FEISHU_ACCOUNTS = "https://accounts.feishu.cn";
const LARK_ACCOUNTS = "https://accounts.larksuite.com";
const REGISTRATION_PATH = "/oauth/v1/app/registration";

type RegistrationResponse = {
  device_code?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  client_id?: string;
  client_secret?: string;
  user_info?: {
    open_id?: string;
    tenant_brand?: "feishu" | "lark";
  };
  error?: string;
  error_description?: string;
};

export type FeishuRegisteredApp = {
  clientId: string;
  clientSecret: string;
  tenantBrand?: "feishu" | "lark";
};

export async function registerTuttiFeishuApp(options: {
  signal: AbortSignal;
  onAuthorizationUrl: (info: { url: string; expireIn: number }) => void;
}): Promise<FeishuRegisteredApp> {
  const started = await registrationRequest(FEISHU_ACCOUNTS, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id"
  }, options.signal);
  if (!started.device_code || !started.verification_uri_complete) {
    throw registrationError(
      started.error || "invalid_registration_response",
      started.error_description || "飞书没有返回动态注册链接。"
    );
  }

  const expireIn = started.expires_in ?? 600;
  const authorizationUrl = new URL(started.verification_uri_complete);
  authorizationUrl.searchParams.set("from", "sdk");
  authorizationUrl.searchParams.set("source", "node-sdk/tutti-content-import");
  authorizationUrl.searchParams.set("tp", "sdk");
  authorizationUrl.searchParams.set("name", "Tutti 文档导入 - {user}");
  authorizationUrl.searchParams.set("desc", "仅用于将当前用户有权访问的飞书文档导入 Tutti。");
  authorizationUrl.searchParams.set("addons", encodeTuttiAddons());
  authorizationUrl.searchParams.set("createOnly", "true");
  options.onAuthorizationUrl({ url: authorizationUrl.toString(), expireIn });

  return pollRegistration({
    baseUrl: FEISHU_ACCOUNTS,
    deviceCode: started.device_code,
    intervalMs: (started.interval ?? 5) * 1000,
    expireInMs: expireIn * 1000,
    signal: options.signal
  });
}

async function pollRegistration(input: {
  baseUrl: string;
  deviceCode: string;
  intervalMs: number;
  expireInMs: number;
  signal: AbortSignal;
}): Promise<FeishuRegisteredApp> {
  const deadline = Date.now() + input.expireInMs;
  let baseUrl = input.baseUrl;
  let intervalMs = input.intervalMs;
  let switchedToLark = false;

  while (Date.now() < deadline) {
    await abortableDelay(intervalMs, input.signal);
    const result = await registrationRequest(baseUrl, {
      action: "poll",
      device_code: input.deviceCode
    }, input.signal);

    if (result.user_info?.tenant_brand === "lark" && !switchedToLark) {
      baseUrl = LARK_ACCOUNTS;
      switchedToLark = true;
      continue;
    }
    if (result.client_id && result.client_secret) {
      return {
        clientId: result.client_id,
        clientSecret: result.client_secret,
        tenantBrand: result.user_info?.tenant_brand
      };
    }
    if (result.error === "authorization_pending" || !result.error) continue;
    if (result.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    throw registrationError(
      result.error,
      result.error_description || "飞书应用创建失败。"
    );
  }
  throw registrationError("expired_token", "飞书动态链接已过期。");
}

async function registrationRequest(
  baseUrl: string,
  body: Record<string, string>,
  signal: AbortSignal
): Promise<RegistrationResponse> {
  const response = await fetch(`${baseUrl}${REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal,
    redirect: "error"
  });
  const payload = await response.json().catch(() => undefined) as RegistrationResponse | undefined;
  if (!payload) throw new Error("飞书动态注册响应不是有效 JSON。");
  if (!response.ok && !payload.error) {
    throw new Error(`飞书动态注册请求失败：${response.status}`);
  }
  return payload;
}

function encodeTuttiAddons(): string {
  const payload = {
    preset: false,
    scopes: {
      tenant: ["application:application:self_manage"],
      user: [
        "docx:document:readonly",
        "wiki:wiki:readonly",
        "search:docs:read",
        "docs:document.media:download",
        "offline_access"
      ]
    }
  };
  return gzipSync(Buffer.from(JSON.stringify(payload), "utf8"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(registrationError("abort", "Registration was aborted"));
      return;
    }
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
    function finish() {
      signal.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      reject(registrationError("abort", "Registration was aborted"));
    }
  });
}

function registrationError(code: string, description: string): Error {
  return Object.assign(new Error(description), { code, description });
}
