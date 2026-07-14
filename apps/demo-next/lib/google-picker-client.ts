export type GooglePickerConfig = {
  available: boolean;
  clientId?: string;
  apiKey?: string;
  appId?: string;
  scope?: string;
};

export type PickedGoogleDocument = {
  id: string;
  name: string;
  url: string;
};

export type GooglePickerResult = {
  accessToken: string;
  expiresIn: number;
  document?: PickedGoogleDocument;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  callback: (response: GoogleTokenResponse) => void;
  requestAccessToken(input: { prompt: string }): void;
};

type PickerView = {
  setMode(mode: unknown): PickerView;
};

type PickerBuilder = {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
};

type GoogleWindow = Window & typeof globalThis & {
  gapi?: {
    load(
      name: string,
      options: {
        callback(): void;
        onerror(): void;
        timeout: number;
        ontimeout(): void;
      }
    ): void;
  };
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient(input: {
          client_id: string;
          scope: string;
          callback: (response: GoogleTokenResponse) => void;
        }): TokenClient;
      };
    };
    picker?: {
      PickerBuilder: new () => PickerBuilder;
      DocsView: new (viewId: unknown) => PickerView;
      DocsViewMode: { LIST: unknown };
      ViewId: { DOCUMENTS: unknown };
      Action: { PICKED: unknown; CANCEL: unknown };
      Response: { ACTION: string; DOCUMENTS: string };
      Document: { ID: string; NAME: string; URL: string };
    };
  };
};

let dependenciesPromise: Promise<void> | undefined;
let pickerLibraryPromise: Promise<void> | undefined;
let cachedToken: { value: string; expiresAt: number; expiresIn: number } | undefined;

export async function openGoogleDocsPicker(config: GooglePickerConfig): Promise<GooglePickerResult> {
  if (!config.available || !config.clientId || !config.apiKey || !config.appId || !config.scope) {
    throw new Error("当前站点尚未启用 Google 文档连接。");
  }
  await loadGoogleDependencies();
  await loadPickerLibrary();
  const token = await getAccessToken(config.clientId, config.scope);
  const document = await showPicker(config, token.value);
  return { accessToken: token.value, expiresIn: token.expiresIn, document };
}

function loadGoogleDependencies(): Promise<void> {
  if (!dependenciesPromise) {
    dependenciesPromise = Promise.all([
      loadScript("google-api-loader", "https://apis.google.com/js/api.js", () => Boolean(googleWindow().gapi)),
      loadScript("google-identity-services", "https://accounts.google.com/gsi/client", () => Boolean(googleWindow().google?.accounts?.oauth2))
    ]).then(() => undefined);
  }
  return dependenciesPromise;
}

function loadScript(id: string, src: string, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => ready() ? resolve() : reject(new Error(`Google script 未就绪：${src}`));
    const onError = () => reject(new Error(`无法加载 Google script：${src}`));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.id = id;
      script.src = src;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
}

function loadPickerLibrary(): Promise<void> {
  if (googleWindow().google?.picker) return Promise.resolve();
  if (!pickerLibraryPromise) {
    pickerLibraryPromise = new Promise((resolve, reject) => {
      const gapi = googleWindow().gapi;
      if (!gapi) {
        reject(new Error("Google API loader 不可用。"));
        return;
      }
      gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Google Picker library 加载失败。")),
        timeout: 10_000,
        ontimeout: () => reject(new Error("Google Picker library 加载超时。"))
      });
    });
  }
  return pickerLibraryPromise;
}

async function getAccessToken(clientId: string, scope: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken;
  const oauth2 = googleWindow().google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services 不可用。");
  const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({ client_id: clientId, scope, callback: resolve });
    tokenClient.callback = (next) => {
      if (next.error || !next.access_token) {
        reject(new Error(next.error_description || next.error || "Google 个人授权失败。"));
        return;
      }
      resolve(next);
    };
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
  const expiresIn = Math.max(60, Number(response.expires_in) || 3600);
  cachedToken = {
    value: response.access_token!,
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000
  };
  return cachedToken;
}

function showPicker(config: GooglePickerConfig, accessToken: string): Promise<PickedGoogleDocument | undefined> {
  const picker = googleWindow().google?.picker;
  if (!picker || !config.apiKey || !config.appId) throw new Error("Google Picker 不可用。");
  const apiKey = config.apiKey;
  const appId = config.appId;
  return new Promise((resolve, reject) => {
    const callback = (data: Record<string, unknown>) => {
      const action = data[picker.Response.ACTION];
      if (action === picker.Action.CANCEL) {
        resolve(undefined);
        return;
      }
      if (action !== picker.Action.PICKED) return;
      const documents = data[picker.Response.DOCUMENTS];
      const selected = Array.isArray(documents) ? documents[0] as Record<string, unknown> | undefined : undefined;
      const id = selected?.[picker.Document.ID];
      if (typeof id !== "string") {
        reject(new Error("Google Picker 没有返回文档 ID。"));
        return;
      }
      const name = selected?.[picker.Document.NAME];
      const url = selected?.[picker.Document.URL];
      resolve({
        id,
        name: typeof name === "string" ? name : "Untitled Google Doc",
        url: typeof url === "string" ? url : `https://docs.google.com/document/d/${id}/edit`
      });
    };
    const view = new picker.DocsView(picker.ViewId.DOCUMENTS).setMode(picker.DocsViewMode.LIST);
    const instance = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setOrigin(window.location.origin)
      .setTitle("选择要导入的 Google Docs")
      .setCallback(callback)
      .build();
    instance.setVisible(true);
  });
}

function googleWindow(): GoogleWindow {
  return window as GoogleWindow;
}
