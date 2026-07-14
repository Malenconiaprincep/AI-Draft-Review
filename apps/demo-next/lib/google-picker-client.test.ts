import assert from "node:assert/strict";
import test from "node:test";
import {
  openGoogleDocsPicker,
  prepareGoogleDocsPicker,
  type GooglePickerConfig
} from "./google-picker-client.ts";

const config: GooglePickerConfig = {
  available: true,
  clientId: "client.apps.googleusercontent.com",
  apiKey: "AIza-test",
  appId: "123456789012",
  scope: "https://www.googleapis.com/auth/drive.file"
};

test("preloads GIS so requestAccessToken runs synchronously inside the click call", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let requestMode: "blocked" | "success" = "blocked";
  let accessRequests = 0;
  let pickerCallback: ((data: Record<string, unknown>) => void) | undefined;

  class FakeDocsView {
    setMode() {
      return this;
    }
  }

  class FakePickerBuilder {
    addView() { return this; }
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setOrigin() { return this; }
    setTitle() { return this; }
    setCallback(callback: (data: Record<string, unknown>) => void) {
      pickerCallback = callback;
      return this;
    }
    build() {
      return {
        setVisible() {
          queueMicrotask(() => pickerCallback?.({ action: "cancel" }));
        }
      };
    }
  }

  const fakeWindow = {
    location: { origin: "http://127.0.0.1:3000" },
    gapi: {
      load(_name: string, options: { callback(): void }) {
        options.callback();
      }
    },
    google: {
      accounts: {
        oauth2: {
          initTokenClient(input: { callback(response: Record<string, unknown>): void }) {
            const client = {
              callback: input.callback,
              requestAccessToken() {
                accessRequests += 1;
                queueMicrotask(() => {
                  client.callback(requestMode === "blocked"
                    ? { error: "popup_failed_to_open" }
                    : { access_token: "token", expires_in: 3600 });
                });
              }
            };
            return client;
          }
        }
      },
      picker: {
        PickerBuilder: FakePickerBuilder,
        DocsView: FakeDocsView,
        DocsViewMode: { LIST: "list" },
        ViewId: { DOCUMENTS: "documents" },
        Action: { PICKED: "picked", CANCEL: "cancel" },
        Response: { ACTION: "action", DOCUMENTS: "documents" },
        Document: { ID: "id", NAME: "name", URL: "url" }
      }
    }
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    assert.throws(
      () => openGoogleDocsPicker(config),
      /仍在准备中/
    );

    await prepareGoogleDocsPicker(config);
    await assert.rejects(
      openGoogleDocsPicker(config),
      /授权窗口被浏览器拦截/
    );

    requestMode = "success";
    const pickerPromise = openGoogleDocsPicker(config);
    assert.equal(accessRequests, 2, "OAuth popup request must happen before the function yields");
    const result = await pickerPromise;
    assert.equal(result.accessToken, "token");
    assert.equal(result.document, undefined);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});
