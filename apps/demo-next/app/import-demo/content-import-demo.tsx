"use client";

import { createDraftDocExtensions, docJsonToPlainText, emptyDraftDoc, type DraftDocJSON, type DraftNodeJSON } from "@tutti/draft-doc";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import {
  openGoogleDocsPicker,
  type GooglePickerConfig,
  type PickedGoogleDocument
} from "../../lib/google-picker-client";

type Provider = "notion" | "feishu" | "youmind" | "googledocs";

type DemoSettings = {
  liveAvailable: Record<Provider, boolean>;
  connections: {
    notion: {
      transport: "mcp";
      available: boolean;
      connected: boolean;
      accountName?: string;
    };
    feishu: {
      transport: "mcp";
      available: boolean;
      connected: boolean;
      accountName?: string;
      mode: "oauth" | "dynamic-app" | "local-demo";
      appType: "store" | "custom";
    };
    youmind: {
      transport: "openapi";
      available: boolean;
      connected: boolean;
      accountName?: string;
      mode: "api-key" | "server-key";
      settingsUrl: string;
    };
    googledocs: {
      available: boolean;
      connected: boolean;
      accountName?: string;
      mode: "picker";
    };
  };
};

type PreviewResult = {
  source: { provider: Provider; id: string; kind: string; url?: string };
  sourceRevision?: string;
  sourceLastEditedAt?: string;
  title: string;
  doc: DraftDocJSON;
  assets: Array<{
    id: string;
    provider: Provider;
    kind: "image" | "file" | "video" | "audio";
    filename?: string;
    providerToken?: string;
    sourceAvailable?: boolean;
    previewUrl?: string;
  }>;
  warnings: Array<{ code: string; message: string; sourceId?: string }>;
};

type PreviewResponse = {
  mode: "live";
  transport: "fixture" | "mcp" | "rest" | "openapi";
  result: PreviewResult;
};

type NotionPageSummary = {
  id: string;
  title: string;
  url: string;
  type: string;
  highlight?: string;
  timestamp?: string;
};

type FeishuDocumentSummary = {
  id: string;
  title: string;
  url?: string;
  kind: string;
  lastEditedAt?: string;
};

type FeishuRegistrationState = {
  status: "idle" | "starting" | "awaiting_user" | "registered" | "failed";
  authorizationUrl?: string;
  continueUrl?: string;
  expiresAt?: string;
  error?: string;
};

type YouMindBoardSummary = {
  id: string;
  name: string;
  status?: string;
  favorite?: boolean;
  updatedAt?: string;
};

type YouMindFileSummary = {
  id: string;
  title: string;
  url?: string;
  kind: string;
  lastEditedAt?: string;
};

const DEFAULT_SETTINGS: DemoSettings = {
  liveAvailable: { notion: false, feishu: false, youmind: false, googledocs: false },
  connections: {
    notion: { transport: "mcp", available: true, connected: false },
    feishu: {
      transport: "mcp",
      available: false,
      connected: false,
      mode: "oauth",
      appType: "store"
    },
    youmind: {
      transport: "openapi",
      available: true,
      connected: false,
      mode: "api-key",
      settingsUrl: "https://youmind.com/settings/api-keys"
    },
    googledocs: { available: false, connected: false, mode: "picker" }
  }
};

export function ContentImportDemo() {
  const [provider, setProvider] = useState<Provider>("notion");
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState("");
  const [response, setResponse] = useState<PreviewResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Connect Notion 后获取页面，选择一篇测试真实导入。");
  const [notionQuery, setNotionQuery] = useState("最近修改的页面");
  const [notionPages, setNotionPages] = useState<NotionPageSummary[]>([]);
  const [notionPagesStatus, setNotionPagesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [notionPagesMessage, setNotionPagesMessage] = useState("点击“获取页面”后才会请求 Notion MCP。");
  const [feishuQuery, setFeishuQuery] = useState("");
  const [feishuDocuments, setFeishuDocuments] = useState<FeishuDocumentSummary[]>([]);
  const [feishuDocumentsStatus, setFeishuDocumentsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [feishuDocumentsMessage, setFeishuDocumentsMessage] = useState("输入标题关键词，搜索当前飞书账号有权访问的文档。");
  const [feishuRegistration, setFeishuRegistration] = useState<FeishuRegistrationState>({ status: "idle" });
  const [youMindApiKey, setYouMindApiKey] = useState("");
  const [youMindConnectStatus, setYouMindConnectStatus] = useState<"idle" | "loading" | "error">("idle");
  const [youMindBoards, setYouMindBoards] = useState<YouMindBoardSummary[]>([]);
  const [youMindBoardId, setYouMindBoardId] = useState("");
  const [youMindFiles, setYouMindFiles] = useState<YouMindFileSummary[]>([]);
  const [youMindQuery, setYouMindQuery] = useState("");
  const [youMindFilesStatus, setYouMindFilesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [youMindFilesMessage, setYouMindFilesMessage] = useState("连接后读取个人 Board 与文件列表。");
  const [googlePickerStatus, setGooglePickerStatus] = useState<"idle" | "loading">("idle");
  const [selectedGoogleDocument, setSelectedGoogleDocument] = useState<PickedGoogleDocument | undefined>();

  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    extensions: createDraftDocExtensions(),
    content: emptyDraftDoc()
  });

  useEffect(() => {
    fetch("/api/content-import/preview", { cache: "no-store" })
      .then((result) => result.json())
      .then((nextSettings: DemoSettings) => {
        setSettings(nextSettings);
      })
      .catch(() => undefined);

    const url = new URL(window.location.href);
    const mcpOutcome = url.searchParams.get("notion_mcp");
    if (mcpOutcome) {
      const feedback = notionMcpFeedback(mcpOutcome);
      setStatus(feedback.status);
      setMessage(feedback.message);
      url.searchParams.delete("notion_mcp");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const feishuOutcome = url.searchParams.get("feishu_oauth");
    if (feishuOutcome) {
      const feedback = feishuOAuthFeedback(feishuOutcome);
      setProvider("feishu");
      setStatus(feedback.status);
      setMessage(feedback.message);
      url.searchParams.delete("feishu_oauth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(toDisplayDoc(response?.result.doc ?? emptyDraftDoc()));
  }, [editor, response]);

  useEffect(() => {
    if (feishuRegistration.status !== "awaiting_user") return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await fetch("/api/connectors/feishu/register", { cache: "no-store" });
        const next = await result.json() as FeishuRegistrationState;
        if (!result.ok || stopped) return;
        setFeishuRegistration(next);
        if (next.status === "registered" && next.continueUrl) {
          setMessage("飞书应用创建成功，正在进入个人文档授权…");
          window.location.assign(next.continueUrl);
        } else if (next.status === "failed") {
          setStatus("error");
          setMessage(next.error || "飞书应用创建失败，请重新生成授权链接。");
        }
      } catch {
        // Polling is best effort; the next interval can recover from a transient error.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [feishuRegistration.status]);

  const stats = useMemo(() => {
    if (!response) return { characters: 0, blocks: 0 };
    return {
      characters: docJsonToPlainText(response.result.doc).length,
      blocks: response.result.doc.content?.length ?? 0
    };
  }, [response]);

  const selectProvider = (nextProvider: Provider) => {
    setProvider(nextProvider);
    setSource("");
    setResponse(null);
    setStatus("idle");
    setMessage(`已切换到 ${providerLabel(nextProvider)} 连接器。`);
  };

  const loadNotionPages = async (query = notionQuery) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setNotionPagesStatus("error");
      setNotionPagesMessage("请输入页面标题、关键词，或自然语言搜索条件。");
      return;
    }
    setNotionPagesStatus("loading");
    setNotionPagesMessage("正在通过 Notion MCP 搜索可访问页面…");
    try {
      const result = await fetch(`/api/connectors/notion/pages?q=${encodeURIComponent(normalizedQuery)}`, {
        cache: "no-store"
      });
      const payload = (await result.json()) as { pages?: NotionPageSummary[]; error?: string };
      if (!result.ok) throw new Error(payload.error || `页面列表请求失败：${result.status}`);
      const pages = payload.pages ?? [];
      setNotionPages(pages);
      setNotionPagesStatus("ready");
      setNotionPagesMessage(pages.length ? `找到 ${pages.length} 个可访问页面。` : "没有找到匹配页面，请换一个关键词。");
    } catch (error) {
      setNotionPages([]);
      setNotionPagesStatus("error");
      setNotionPagesMessage(error instanceof Error ? error.message : "读取 Notion 页面列表失败。");
    }
  };

  const loadFeishuDocuments = async (query = feishuQuery) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setFeishuDocumentsStatus("error");
      setFeishuDocumentsMessage("请输入飞书文档标题或关键词。");
      return;
    }
    setFeishuDocumentsStatus("loading");
    setFeishuDocumentsMessage("正在通过飞书 MCP 搜索当前用户可访问的文档…");
    try {
      const result = await fetch(`/api/connectors/feishu/documents?q=${encodeURIComponent(normalizedQuery)}`, {
        cache: "no-store"
      });
      const payload = (await result.json()) as { documents?: FeishuDocumentSummary[]; error?: string };
      if (!result.ok) throw new Error(payload.error || `文档列表请求失败：${result.status}`);
      const documents = payload.documents ?? [];
      setFeishuDocuments(documents);
      setFeishuDocumentsStatus("ready");
      setFeishuDocumentsMessage(
        documents.length ? `找到 ${documents.length} 篇当前用户可访问的文档。` : "没有找到匹配文档，请换一个关键词。"
      );
    } catch (error) {
      setFeishuDocuments([]);
      setFeishuDocumentsStatus("error");
      setFeishuDocumentsMessage(error instanceof Error ? error.message : "读取飞书文档失败。");
    }
  };

  const startFeishuRegistration = async () => {
    setStatus("loading");
    setMessage("正在生成飞书官方动态授权链接…");
    setFeishuRegistration({ status: "starting" });
    const authorizationWindow = window.open("about:blank", "tutti-feishu-registration");
    try {
      const result = await fetch("/api/connectors/feishu/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const payload = await result.json() as FeishuRegistrationState & { error?: string };
      if (!result.ok) throw new Error(payload.error || `生成链接失败：${result.status}`);
      setFeishuRegistration(payload);
      if (payload.status === "registered" && payload.continueUrl) {
        authorizationWindow?.close();
        window.location.assign(payload.continueUrl);
        return;
      }
      if (!payload.authorizationUrl) throw new Error("飞书没有返回可打开的授权链接。");
      if (authorizationWindow) authorizationWindow.location.href = payload.authorizationUrl;
      setStatus("idle");
      setMessage("请在新窗口打开飞书链接并确认创建只读文档应用；本页会自动继续授权。");
    } catch (error) {
      authorizationWindow?.close();
      setFeishuRegistration({ status: "failed" });
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "生成飞书授权链接失败。");
    }
  };

  const loadYouMindFiles = async (boardId = youMindBoardId, query = youMindQuery) => {
    if (!boardId) {
      setYouMindFilesStatus("error");
      setYouMindFilesMessage("请先选择一个 YouMind Board。");
      return;
    }
    setYouMindFilesStatus("loading");
    setYouMindFilesMessage("正在通过 YouMind OpenAPI 读取文件…");
    try {
      const params = new URLSearchParams({ boardId });
      if (query.trim()) params.set("q", query.trim());
      const result = await fetch(`/api/connectors/youmind/files?${params}`, { cache: "no-store" });
      const payload = await result.json() as { files?: YouMindFileSummary[]; error?: string };
      if (!result.ok) throw new Error(payload.error || `文件列表请求失败：${result.status}`);
      const files = payload.files ?? [];
      setYouMindFiles(files);
      setYouMindFilesStatus("ready");
      setYouMindFilesMessage(files.length ? `找到 ${files.length} 个 article 文档。` : "这个 Board 中没有匹配的 article 文档。");
    } catch (error) {
      setYouMindFiles([]);
      setYouMindFilesStatus("error");
      setYouMindFilesMessage(error instanceof Error ? error.message : "读取 YouMind 文件失败。");
    }
  };

  const chooseGoogleDocument = async () => {
    setGooglePickerStatus("loading");
    setStatus("loading");
    setMessage("正在打开 Google 个人授权与文档选择器…");
    try {
      const configResult = await fetch("/api/connectors/google-docs/authorize", { cache: "no-store" });
      const config = await configResult.json() as GooglePickerConfig & { error?: string };
      if (!configResult.ok || !config.available) {
        throw new Error(config.error || "当前站点尚未启用 Google 文档连接，请联系 Tutti 管理员。");
      }
      const pickerResult = await openGoogleDocsPicker(config);
      if (!pickerResult.document) {
        setStatus("idle");
        setMessage("已取消 Google Docs 选择，没有授予任何新文档权限。");
        return;
      }
      const connectResult = await fetch("/api/connectors/google-docs/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: pickerResult.accessToken,
          expiresIn: pickerResult.expiresIn,
          source: pickerResult.document.url
        })
      });
      const connection = await connectResult.json() as { error?: string };
      if (!connectResult.ok) throw new Error(connection.error || "保存 Google Picker 会话失败。");
      const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
      setSettings(await settingsResult.json() as DemoSettings);
      setSelectedGoogleDocument(pickerResult.document);
      setSource(pickerResult.document.url);
      setStatus("ready");
      setMessage(`已通过 Google Picker 选择「${pickerResult.document.name}」，可以导入。`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Google Picker 打开失败。");
    } finally {
      setGooglePickerStatus("idle");
    }
  };

  const disconnectGoogleDocs = async () => {
    await fetch("/api/connectors/google-docs/authorize", { method: "DELETE" });
    const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
    setSettings(await settingsResult.json() as DemoSettings);
    setSelectedGoogleDocument(undefined);
    setSource("");
    setStatus("idle");
    setMessage("Google Docs 已断开，服务端会话中的 Token 已清除。");
  };

  const loadYouMindBoards = async () => {
    setYouMindFilesStatus("loading");
    setYouMindFilesMessage("正在读取个人 YouMind Board…");
    try {
      const result = await fetch("/api/connectors/youmind/boards", { cache: "no-store" });
      const payload = await result.json() as { boards?: YouMindBoardSummary[]; error?: string };
      if (!result.ok) throw new Error(payload.error || `Board 列表请求失败：${result.status}`);
      const boards = payload.boards ?? [];
      setYouMindBoards(boards);
      const nextBoardId = boards.some((board) => board.id === youMindBoardId)
        ? youMindBoardId
        : boards[0]?.id ?? "";
      setYouMindBoardId(nextBoardId);
      if (nextBoardId) await loadYouMindFiles(nextBoardId, "");
      else {
        setYouMindFiles([]);
        setYouMindFilesStatus("ready");
        setYouMindFilesMessage("当前账号没有可访问的 Board。");
      }
    } catch (error) {
      setYouMindBoards([]);
      setYouMindFiles([]);
      setYouMindFilesStatus("error");
      setYouMindFilesMessage(error instanceof Error ? error.message : "读取 YouMind Board 失败。");
    }
  };

  const connectYouMind = async () => {
    if (youMindConnection.mode === "api-key" && !youMindApiKey.trim()) return;
    setYouMindConnectStatus("loading");
    setMessage("正在请求 YouMind 授权并校验访问权限…");
    try {
      const result = await fetch("/api/connectors/youmind/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(youMindApiKey.trim() ? { apiKey: youMindApiKey.trim() } : {})
      });
      const payload = await result.json() as { error?: string };
      if (!result.ok) throw new Error(payload.error || `连接失败：${result.status}`);
      const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
      setSettings(await settingsResult.json() as DemoSettings);
      setYouMindApiKey("");
      setYouMindConnectStatus("idle");
      setStatus("ready");
      setMessage("YouMind 已连接，正在获取个人 Board 与文件列表。");
      await loadYouMindBoards();
    } catch (error) {
      setYouMindConnectStatus("error");
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "YouMind 连接失败。");
    }
  };

  const disconnectYouMind = async () => {
    await fetch("/api/connectors/youmind/authorize", { method: "DELETE" });
    const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
    setSettings(await settingsResult.json() as DemoSettings);
    setYouMindBoards([]);
    setYouMindFiles([]);
    setYouMindBoardId("");
    setSource("");
    setStatus("idle");
    setMessage("YouMind 已断开，服务端会话中的 API Key 已清除。");
  };

  const runImport = async (overrideSource?: string) => {
    setStatus("loading");
    setMessage("正在读取真实平台文档并转换格式…");
    setResponse(null);
    const requestSource = overrideSource ?? source;

    try {
      const result = await fetch("/api/content-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, source: requestSource, mode: "live" })
      });
      const payload = (await result.json()) as PreviewResponse & { error?: string; code?: string };
      if (!result.ok) throw new Error(payload.error || `请求失败：${result.status}`);
      setResponse(payload);
      setStatus("ready");
      setMessage(
        `${providerLabel(provider)} 导入完成：${payload.result.doc.content?.length ?? 0} 个顶层 Block，${payload.result.assets.length} 个待转存素材。`
      );
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "导入预览失败。");
    }
  };

  const liveReady = settings.liveAvailable[provider];
  const notionConnection = settings.connections.notion;
  const feishuConnection = settings.connections.feishu;
  const youMindConnection = settings.connections.youmind;
  const googleDocsConnection = settings.connections.googledocs;
  const result = response?.result;

  return (
    <main className="import-demo-shell">
      <header className="import-demo-header">
        <div>
          <a className="import-back-link" href="/">← 返回草稿审阅 Demo</a>
          <div className="import-eyebrow">Tutti connector lab</div>
          <h1>内容导入 Demo</h1>
          <p>通过服务端连接器读取 Notion、飞书、YouMind 或 Google Docs，规范化后预览 Tutti DraftDocJSON。</p>
        </div>
        <div className="import-header-badge">
          <span className="import-status-dot" />
          Connector lab
        </div>
      </header>

      <section className="import-demo-grid">
        <aside className="import-control-card">
          <div className="import-step-label">01 · 选择来源</div>
          <div className="import-provider-tabs" role="tablist" aria-label="内容平台">
            {(["notion", "feishu", "youmind", "googledocs"] as Provider[]).map((item) => (
              <button
                className={item === provider ? "active" : ""}
                key={item}
                type="button"
                role="tab"
                aria-selected={item === provider}
                onClick={() => selectProvider(item)}
              >
                <ProviderIcon provider={item} />
                <span>{providerLabel(item)}</span>
              </button>
            ))}
          </div>

          <label className="import-field">
            <span>文档链接</span>
            <textarea
              value={source}
              rows={4}
              readOnly={provider === "googledocs"}
              onChange={(event) => setSource(event.target.value)}
              placeholder={provider === "googledocs" ? "通过 Google Picker 选择文档" : `粘贴 ${providerLabel(provider)} 文档链接`}
            />
          </label>

          {provider === "notion" && notionConnection.connected ? (
            <section className="import-notion-picker" aria-labelledby="notion-page-picker-title">
              <div className="import-picker-heading">
                <div>
                  <span>已授权页面</span>
                  <strong id="notion-page-picker-title">从工作区选择</strong>
                </div>
                <small>{notionPagesStatus === "loading" ? "读取中" : `${notionPages.length} 项`}</small>
              </div>
              <div className="import-picker-search">
                <input
                  aria-label="搜索 Notion 页面"
                  value={notionQuery}
                  onChange={(event) => setNotionQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadNotionPages();
                  }}
                  placeholder="页面标题或关键词"
                />
                <button
                  type="button"
                  disabled={notionPagesStatus === "loading" || !notionQuery.trim()}
                  onClick={() => void loadNotionPages()}
                >
                  获取页面
                </button>
              </div>
              <p className={`import-picker-message ${notionPagesStatus}`}>{notionPagesMessage}</p>
              {notionPages.length ? (
                <div className="import-page-list" role="list" aria-label="可访问的 Notion 页面">
                  {notionPages.map((page) => (
                    <button
                      type="button"
                      role="listitem"
                      className={source === page.url ? "selected" : ""}
                      key={page.id}
                      onClick={() => {
                        setSource(page.url);
                        setMessage(`已选择「${page.title}」，可以测试真实导入。`);
                      }}
                    >
                      <span className="provider-letter">N</span>
                      <span>
                        <strong>{page.title}</strong>
                        <small>{page.highlight || formatNotionPageDate(page.timestamp)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {provider === "feishu" && feishuConnection.connected ? (
            <section className="import-notion-picker" aria-labelledby="feishu-document-picker-title">
              <div className="import-picker-heading">
                <div>
                  <span>当前用户的文档</span>
                  <strong id="feishu-document-picker-title">从飞书中选择</strong>
                </div>
                <small>{feishuDocumentsStatus === "loading" ? "读取中" : `${feishuDocuments.length} 项`}</small>
              </div>
              <div className="import-picker-search">
                <input
                  aria-label="搜索飞书文档"
                  value={feishuQuery}
                  onChange={(event) => setFeishuQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadFeishuDocuments();
                  }}
                  placeholder="文档标题或关键词"
                />
                <button
                  type="button"
                  disabled={feishuDocumentsStatus === "loading" || !feishuQuery.trim()}
                  onClick={() => void loadFeishuDocuments()}
                >
                  搜索文档
                </button>
              </div>
              <p className={`import-picker-message ${feishuDocumentsStatus}`}>{feishuDocumentsMessage}</p>
              {feishuDocuments.length ? (
                <div className="import-page-list" role="list" aria-label="当前用户可访问的飞书文档">
                  {feishuDocuments.map((document) => {
                    const documentSource = document.url || document.id;
                    return (
                      <button
                        type="button"
                        role="listitem"
                        className={source === documentSource ? "selected" : ""}
                        key={document.id}
                        onClick={() => {
                          setSource(documentSource);
                          setMessage(`已选择「${document.title}」，可以导入到 Tutti。`);
                        }}
                      >
                        <span className="provider-letter feishu">飞</span>
                        <span>
                          <strong>{document.title}</strong>
                          <small>{formatDocumentDate(document.lastEditedAt, "飞书文档")}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}

          {provider === "youmind" && youMindConnection.connected ? (
            <section className="import-notion-picker" aria-labelledby="youmind-file-picker-title">
              <div className="import-picker-heading">
                <div>
                  <span>个人工作区</span>
                  <strong id="youmind-file-picker-title">从 YouMind 中选择</strong>
                </div>
                <small>{youMindFilesStatus === "loading" ? "读取中" : `${youMindFiles.length} 项`}</small>
              </div>
              <div className="import-picker-search">
                <select
                  aria-label="选择 YouMind Board"
                  value={youMindBoardId}
                  onChange={(event) => {
                    const boardId = event.target.value;
                    setYouMindBoardId(boardId);
                    void loadYouMindFiles(boardId, "");
                  }}
                >
                  {youMindBoards.length ? null : <option value="">暂无 Board</option>}
                  {youMindBoards.map((board) => (
                    <option value={board.id} key={board.id}>{board.favorite ? "★ " : ""}{board.name}</option>
                  ))}
                </select>
                <button type="button" disabled={youMindFilesStatus === "loading"} onClick={() => void loadYouMindBoards()}>
                  刷新
                </button>
              </div>
              <div className="import-picker-search">
                <input
                  aria-label="筛选 YouMind 文件"
                  value={youMindQuery}
                  onChange={(event) => setYouMindQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadYouMindFiles();
                  }}
                  placeholder="文件标题关键词（可选）"
                />
                <button type="button" disabled={youMindFilesStatus === "loading" || !youMindBoardId} onClick={() => void loadYouMindFiles()}>
                  筛选
                </button>
              </div>
              <p className={`import-picker-message ${youMindFilesStatus}`}>{youMindFilesMessage}</p>
              {youMindFiles.length ? (
                <div className="import-page-list" role="list" aria-label="YouMind 文件列表">
                  {youMindFiles.map((file) => {
                    const fileSource = file.url || file.id;
                    return (
                      <button
                        type="button"
                        role="listitem"
                        className={source === fileSource ? "selected" : ""}
                        key={file.id}
                        onClick={() => {
                          setSource(fileSource);
                          setMessage(`已选择「${file.title}」，可以导入到 Tutti。`);
                        }}
                      >
                        <span className="provider-letter youmind">Y</span>
                        <span>
                          <strong>{file.title}</strong>
                          <small>type: {file.kind || "unknown"} · {formatDocumentDate(file.lastEditedAt, "无更新时间")}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}

          {provider === "googledocs" ? (
            <section className="import-notion-picker" aria-labelledby="google-document-picker-title">
              <div className="import-picker-heading">
                <div>
                  <span>最小权限 · drive.file</span>
                  <strong id="google-document-picker-title">连接 Google 文档</strong>
                </div>
                <small>{selectedGoogleDocument ? "已选择" : "单篇授权"}</small>
              </div>
              <p className="import-picker-message">
                点击连接后完成个人 Google 授权，再从官方窗口选择一篇 Docs；普通用户无需填写任何配置。
              </p>
              {selectedGoogleDocument ? (
                <div className="import-page-list" role="list" aria-label="已选择的 Google Docs">
                  <button type="button" role="listitem" className="selected" onClick={() => setSource(selectedGoogleDocument.url)}>
                    <span className="provider-letter google">G</span>
                    <span>
                      <strong>{selectedGoogleDocument.name}</strong>
                      <small>Google Picker 已授权</small>
                    </span>
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="import-step-label">02 · 运行连接器</div>
          {provider === "notion" ? (
            <a
              className={`import-oauth-button ${notionConnection.connected ? "connected" : ""}`}
              href="/api/connectors/notion/authorize"
            >
              <span className="provider-letter">N</span>
              {notionConnection.connected
                ? `重新连接 ${notionConnection.accountName || "Notion"}`
                : "Connect Notion via MCP"}
            </a>
          ) : provider === "feishu" && feishuConnection.mode === "dynamic-app" && !feishuConnection.connected ? (
            <div className="import-youmind-connected">
              <button
                className="import-oauth-button"
                type="button"
                disabled={feishuRegistration.status === "starting" || feishuRegistration.status === "awaiting_user"}
                onClick={() => void startFeishuRegistration()}
              >
                <span className="provider-letter feishu">飞</span>
                {feishuRegistration.status === "starting"
                  ? "生成飞书授权链接…"
                  : feishuRegistration.status === "awaiting_user"
                    ? "等待飞书确认…"
                    : "扫码连接个人飞书"}
              </button>
              {feishuRegistration.authorizationUrl ? (
                <a
                  className="import-disconnect-button"
                  href={feishuRegistration.authorizationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  手动打开授权链接
                </a>
              ) : null}
            </div>
          ) : provider === "feishu" ? (
            <a
              className={`import-oauth-button ${feishuConnection.connected ? "connected" : ""} ${feishuConnection.available ? "" : "disabled"}`}
              href="/api/connectors/feishu/authorize"
              aria-disabled={!feishuConnection.available}
            >
              <span className="provider-letter feishu">飞</span>
              {feishuConnection.connected
                ? `重新连接 ${feishuConnection.accountName || "飞书"}`
                : feishuConnection.mode === "local-demo"
                  ? "体验飞书商店应用流程"
                  : "连接个人飞书文档"}
            </a>
          ) : provider === "googledocs" ? (
            <div className="import-youmind-connected">
              <button
                className={`import-oauth-button ${googleDocsConnection.connected ? "connected" : ""}`}
                type="button"
                disabled={googlePickerStatus === "loading"}
                onClick={() => void chooseGoogleDocument()}
              >
                <span className="provider-letter google">G</span>
                {googlePickerStatus === "loading"
                  ? "正在打开 Google Picker…"
                  : googleDocsConnection.connected
                    ? "重新选择 Google Docs"
                    : "连接 Google"}
              </button>
              {googleDocsConnection.connected ? (
                <button className="import-disconnect-button" type="button" onClick={() => void disconnectGoogleDocs()}>断开连接</button>
              ) : null}
            </div>
          ) : youMindConnection.connected ? (
            <div className="import-youmind-connected">
              <button className="import-oauth-button connected" type="button" onClick={() => void loadYouMindBoards()}>
                <span className="provider-letter youmind">Y</span>
                已连接 {youMindConnection.accountName || "YouMind"}
              </button>
              <button className="import-disconnect-button" type="button" onClick={() => void disconnectYouMind()}>断开连接</button>
            </div>
          ) : youMindConnection.mode === "server-key" ? (
            <button
              className="import-oauth-button"
              type="button"
              disabled={youMindConnectStatus === "loading"}
              onClick={() => void connectYouMind()}
            >
              <span className="provider-letter youmind">Y</span>
              {youMindConnectStatus === "loading" ? "授权中…" : "授权 YouMind"}
            </button>
          ) : (
            <section className="import-youmind-auth">
              <a href={youMindConnection.settingsUrl} target="_blank" rel="noreferrer">先在 YouMind 生成个人 API Key ↗</a>
              <div className="import-picker-search">
                <input
                  type="password"
                  autoComplete="off"
                  aria-label="YouMind API Key"
                  value={youMindApiKey}
                  onChange={(event) => setYouMindApiKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void connectYouMind();
                  }}
                  placeholder="sk-ym-…"
                />
                <button
                  type="button"
                  disabled={youMindConnectStatus === "loading" || !youMindApiKey.trim()}
                  onClick={() => void connectYouMind()}
                >
                  {youMindConnectStatus === "loading" ? "连接中" : "连接"}
                </button>
              </div>
            </section>
          )}
          <button
            className="import-secondary-button"
            type="button"
            disabled={status === "loading" || !liveReady || !source.trim()}
            onClick={() => runImport()}
          >
            {status === "loading" ? "导入中…" : "导入选中文档"}
          </button>
          <p className="import-token-note">
            {liveReady
              ? provider === "notion" && notionConnection.connected
                ? `已通过官方 MCP 连接${notionConnection.accountName ? `工作区「${notionConnection.accountName}」` : " Notion"}。`
                : provider === "feishu" && feishuConnection.connected
                  ? feishuConnection.mode === "local-demo"
                    ? "当前为本地模拟授权；配置商店应用凭据后会自动切换为真实飞书 OAuth。"
                    : feishuConnection.mode === "dynamic-app"
                      ? "已通过用户专属自建应用取得 UAT；凭据仅保存在当前服务端会话。"
                      : "已通过飞书商店应用 OAuth 取得用户 UAT，导入时优先调用官方远程 MCP。"
                  : provider === "youmind" && youMindConnection.connected
                    ? "已通过官方 OpenAPI 连接；API Key 仅保存在服务端会话内存中。"
                    : provider === "googledocs" && googleDocsConnection.connected
                      ? "已通过 Google Picker 授权选中文档；Tutti 不读取完整 Drive 列表。"
                    : `服务端已配置 ${providerLabel(provider)} Token。`
              : provider === "notion"
                ? "尚未连接。点击 Connect Notion 将跳转官方 MCP OAuth；无需配置 Client ID/Secret。"
                : provider === "feishu" && feishuConnection.available
                  ? feishuConnection.mode === "local-demo"
                    ? "本地演示模式可用。点击体验完整流程，不会读取真实飞书数据。"
                    : feishuConnection.mode === "dynamic-app"
                      ? "无需填写 App ID/Secret；打开飞书动态链接创建只读应用后继续用户授权。"
                      : "尚未连接。点击后由用户授权其个人可访问的飞书文档。"
                  : provider === "feishu"
                    ? "飞书连接暂未开放，请联系 Tutti 管理员完成平台配置。"
                    : provider === "googledocs"
                      ? googleDocsConnection.available
                        ? "点击后完成个人 Google 授权，并在官方 Picker 中选择一篇 Docs。"
                        : "点击“连接 Google”完成个人授权；应用身份由 Tutti 管理员统一维护。"
                      : youMindConnection.mode === "server-key"
                        ? "服务端已配置 YouMind API Key；点击“授权 YouMind”后才会创建当前会话并读取个人内容。"
                        : "YouMind 不提供第三方 OAuth；请生成个人 API Key 后连接官方 OpenAPI。"}
          </p>

          <div className={`import-feedback ${status}`} role="status" aria-live="polite">
            <span>{statusIcon(status)}</span>
            <p>{message}</p>
          </div>
        </aside>

        <section className="import-preview-card">
          <div className="import-preview-toolbar">
            <div>
              <div className="import-step-label">03 · 导入预览</div>
              <h2>{result?.title ?? "等待导入文档"}</h2>
            </div>
            {result ? (
              <div className="import-stats">
                <span><strong>{stats.blocks}</strong> blocks</span>
                <span><strong>{stats.characters}</strong> chars</span>
              </div>
            ) : null}
          </div>

          <div className={`import-document-frame ${result ? "has-content" : "empty"}`}>
            {result ? (
              <EditorContent editor={editor} className="import-preview-editor" />
            ) : (
              <div className="import-empty-state">
                <div className="import-empty-icon">↗</div>
                <strong>选择一篇文档开始导入</strong>
                <span>转换后的标题、正文、列表、引用和表格会显示在这里。</span>
              </div>
            )}
          </div>

          {result ? (
            <div className="import-result-details">
              <section>
                <div className="import-detail-heading">
                  <h3>来源信息</h3>
                  <span>{response?.transport === "mcp" ? "MCP" : response?.transport === "openapi" ? "OpenAPI" : response?.transport === "rest" ? "REST fallback" : "Live"}</span>
                </div>
                <dl className="import-source-list">
                  <div><dt>Provider</dt><dd>{providerLabel(result.source.provider)}</dd></div>
                  <div><dt>Resource</dt><dd>{result.source.kind}</dd></div>
                  <div><dt>Source ID</dt><dd>{result.source.id}</dd></div>
                  <div><dt>Revision</dt><dd>{result.sourceRevision ?? "—"}</dd></div>
                </dl>
              </section>

              <section>
                <div className="import-detail-heading">
                  <h3>本地素材</h3>
                  <span>{result.assets.length}</span>
                </div>
                {result.assets.length ? (
                  <div className="import-asset-list">
                    {result.assets.map((asset) => (
                      <div className="import-asset" key={asset.id}>
                        <span className="import-asset-icon">{asset.kind === "image" ? "▧" : asset.kind === "video" ? "▶" : asset.kind === "audio" ? "♪" : "▤"}</span>
                        <div>
                          <strong>{asset.filename || asset.kind}</strong>
                          <small>{asset.previewUrl ? "已保存到本地并用于预览" : "本地保存失败"}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="import-detail-muted">文档没有外部素材。</p>}
              </section>

              <section>
                <div className="import-detail-heading">
                  <h3>转换提示</h3>
                  <span>{result.warnings.length}</span>
                </div>
                {result.warnings.length ? (
                  <ul className="import-warning-list">
                    {result.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}
                  </ul>
                ) : <p className="import-success-copy">没有检测到格式降级。</p>}
              </section>
            </div>
          ) : null}

          {result ? (
            <details className="import-json-details">
              <summary>查看 DraftDocJSON</summary>
              <pre>{JSON.stringify(result.doc, null, 2)}</pre>
            </details>
          ) : null}
        </section>
      </section>

    </main>
  );
}

function notionMcpFeedback(outcome: string): { status: "ready" | "error"; message: string } {
  if (outcome === "connected") {
    return { status: "ready", message: "Notion MCP 连接成功。点击“获取页面”，选择一篇后即可导入。" };
  }
  if (outcome === "denied") {
    return { status: "error", message: "你取消了 Notion MCP 授权，没有保存任何 Token。" };
  }
  if (outcome === "invalid_state") {
    return { status: "error", message: "Notion MCP 授权校验失败，请重新点击 Connect Notion。" };
  }
  if (outcome === "unavailable") {
    return { status: "error", message: "暂时无法连接官方 Notion MCP，请稍后重试。" };
  }
  return { status: "error", message: "Notion MCP 授权失败，请重新连接。" };
}

function feishuOAuthFeedback(outcome: string): { status: "ready" | "error"; message: string } {
  if (outcome === "connected") {
    return { status: "ready", message: "飞书连接成功。现在可以搜索并选择当前账号有权访问的文档。" };
  }
  if (outcome === "denied") {
    return { status: "error", message: "你取消了飞书授权，没有保存任何 Token。" };
  }
  if (outcome === "invalid_state") {
    return { status: "error", message: "飞书授权校验失败，请重新点击 Connect 飞书。" };
  }
  if (outcome === "unavailable") {
    return { status: "error", message: "飞书连接尚未配置，请先设置 App ID、App Secret 和回调地址。" };
  }
  return { status: "error", message: "飞书授权失败，请检查应用权限、回调地址和应用发布状态。" };
}

function providerLabel(provider: Provider): string {
  return provider === "notion"
    ? "Notion"
    : provider === "feishu"
      ? "飞书"
      : provider === "youmind"
        ? "YouMind"
        : "Google Docs";
}

function formatNotionPageDate(timestamp?: string): string {
  return formatDocumentDate(timestamp, "Notion 页面");
}

function formatDocumentDate(timestamp: string | undefined, fallback: string): string {
  if (!timestamp) return fallback;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? fallback
    : `更新于 ${new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date)}`;
}

function statusIcon(status: "idle" | "loading" | "ready" | "error"): string {
  if (status === "ready") return "✓";
  if (status === "error") return "!";
  if (status === "loading") return "↻";
  return "i";
}

function toDisplayDoc(doc: DraftDocJSON): DraftDocJSON {
  const visit = (node: DraftNodeJSON): DraftNodeJSON => {
    const next = { ...node };
    if (node.type === "image" && String(node.attrs?.src ?? "").startsWith("tutti-import://")) {
      next.attrs = {
        ...node.attrs,
        src: placeholderImageDataUrl(),
        alt: node.attrs?.alt ?? "External image pending transfer"
      };
    }
    if (node.content) next.content = node.content.map(visit);
    return next;
  };
  return { ...doc, content: doc.content?.map(visit) };
}

function placeholderImageDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360"><rect width="960" height="360" rx="18" fill="#edf3ef"/><path d="M380 224l58-64 42 42 32-31 69 69H380z" fill="#8db6a8"/><circle cx="540" cy="128" r="24" fill="#c4d9d1"/><text x="480" y="294" text-anchor="middle" fill="#557268" font-family="Arial,sans-serif" font-size="20">External asset · pending transfer</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function ProviderIcon({ provider }: { provider: Provider }) {
  return provider === "notion"
    ? <span className="provider-letter">N</span>
    : provider === "feishu"
      ? <span className="provider-letter feishu">飞</span>
      : provider === "youmind"
        ? <span className="provider-letter youmind">Y</span>
        : <span className="provider-letter google">G</span>;
}
