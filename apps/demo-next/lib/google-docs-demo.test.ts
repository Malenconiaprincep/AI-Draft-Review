import assert from "node:assert/strict";
import test from "node:test";
import {
  connectGoogleDocs,
  disconnectGoogleDocs,
  exportGoogleDocsBrowserSession,
  getGoogleDocsConnection,
  getGoogleDocsPickerConfig,
  getGoogleDocsToken,
  GOOGLE_DOCS_SESSION_COOKIE,
  GOOGLE_DOCS_PICKER_SCOPE,
  restoreGoogleDocsBrowserSession
} from "./google-docs-demo.ts";

const documentId = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

test("stores only the Google Picker token and selected document in a short server session", async () => {
  const original = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    apiKey: process.env.GOOGLE_PICKER_API_KEY,
    projectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER
  };
  process.env.GOOGLE_CLIENT_ID = "client.apps.googleusercontent.com";
  process.env.GOOGLE_PICKER_API_KEY = "AIza-test";
  process.env.GOOGLE_CLOUD_PROJECT_NUMBER = "123456789012";

  try {
    const config = getGoogleDocsPickerConfig();
    assert.equal(config.available, true);
    assert.equal(config.scope, GOOGLE_DOCS_PICKER_SCOPE);

    const connected = connectGoogleDocs({
      accessToken: "picker-access-token",
      expiresIn: 1800,
      source: `https://docs.google.com/document/d/${documentId}/edit`
    });
    const request = new Request("http://localhost/api", {
      headers: { cookie: `${GOOGLE_DOCS_SESSION_COOKIE}=${connected.sessionId}` }
    });

    assert.equal(getGoogleDocsConnection(request).connected, true);
    const token = await getGoogleDocsToken(request);
    assert.equal(token.metadata?.scope, GOOGLE_DOCS_PICKER_SCOPE);
    assert.equal(token.metadata?.selectedDocumentId, documentId);
    assert.equal(token.refreshToken, undefined);

    disconnectGoogleDocs(request);
    assert.equal(getGoogleDocsConnection(request).connected, false);
  } finally {
    restoreEnv("GOOGLE_CLIENT_ID", original.clientId);
    restoreEnv("GOOGLE_PICKER_API_KEY", original.apiKey);
    restoreEnv("GOOGLE_CLOUD_PROJECT_NUMBER", original.projectNumber);
  }
});

test("restores an unexpired Google Picker snapshot into a fresh server session", async () => {
  const restored = restoreGoogleDocsBrowserSession({
    version: 1,
    savedAt: new Date().toISOString(),
    token: {
      accessToken: "google-browser-test-token",
      tokenType: "bearer",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      accountName: "Google account",
      metadata: {
        scope: GOOGLE_DOCS_PICKER_SCOPE,
        selectedDocumentId: documentId,
        authorizationMode: "picker"
      }
    }
  });
  const request = new Request("http://localhost/import-demo", {
    headers: { cookie: `${GOOGLE_DOCS_SESSION_COOKIE}=${restored.sessionId}` }
  });

  assert.equal(getGoogleDocsConnection(request).connected, true);
  assert.equal((await getGoogleDocsToken(request)).metadata?.selectedDocumentId, documentId);
  assert.equal(exportGoogleDocsBrowserSession(request).version, 1);
});

test("rejects an expired Google Picker browser snapshot", () => {
  assert.throws(() => restoreGoogleDocsBrowserSession({
    version: 1,
    token: {
      accessToken: "expired-token",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      metadata: { selectedDocumentId: documentId }
    }
  }), /invalid_browser_session/);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
