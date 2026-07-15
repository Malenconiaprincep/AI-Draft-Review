"use client";

import { createDraftDocExtensions, docJsonToPlainText, emptyDraftDoc, type DraftDocJSON, type DraftNodeJSON } from "@tutti/draft-doc";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  openGoogleDocsPicker,
  prepareGoogleDocsPicker,
  type GooglePickerConfig,
  type PickedGoogleDocument
} from "../../lib/google-picker-client";
import { analyzeImportSource, detectImportProvider, type ImportProvider } from "./content-import-ui";

type Provider = ImportProvider;
type BrowserPersistableProvider = Exclude<Provider, "feishu">;

type DemoSettings = {
  liveAvailable: Record<Provider, boolean>;
  connections: {
    notion: {
      transport: "mcp";
      available: boolean;
      connected: boolean;
      accountName?: string;
      browserSessionPersistenceAvailable: boolean;
    };
    feishu: {
      transport: "public";
      available: boolean;
      connected: boolean;
      mode: "public-only";
      appType: "store" | "custom";
    };
    youmind: {
      transport: "openapi";
      available: boolean;
      connected: boolean;
      accountName?: string;
      mode: "api-key" | "server-key";
      settingsUrl: string;
      browserSessionPersistenceAvailable: boolean;
    };
    googledocs: {
      available: boolean;
      connected: boolean;
      accountName?: string;
      mode: "picker";
      browserSessionPersistenceAvailable: boolean;
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
  transport: "fixture" | "mcp" | "rest" | "openapi" | "public";
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
  boardName?: string;
};

type WorkspaceDocument = {
  id: string;
  provider: Provider;
  title: string;
  source: string;
  updatedAt?: string;
  meta: string;
};

const DEFAULT_SETTINGS: DemoSettings = {
  liveAvailable: { notion: false, feishu: false, youmind: false, googledocs: true },
  connections: {
    notion: { transport: "mcp", available: true, connected: false, browserSessionPersistenceAvailable: false },
    feishu: {
      transport: "public",
      available: false,
      connected: false,
      mode: "public-only",
      appType: "custom"
    },
    youmind: {
      transport: "openapi",
      available: true,
      connected: false,
      mode: "api-key",
      settingsUrl: "https://youmind.com/settings/api-keys",
      browserSessionPersistenceAvailable: false
    },
    googledocs: {
      available: false,
      connected: false,
      mode: "picker",
      browserSessionPersistenceAvailable: false
    }
  }
};

const BROWSER_PERSISTABLE_PROVIDERS: BrowserPersistableProvider[] = ["notion", "youmind", "googledocs"];
const BROWSER_PERSISTENCE_CONFIG: Record<BrowserPersistableProvider, {
  endpoint: string;
  preferenceKey: string;
  sessionKey: string;
}> = {
  notion: {
    endpoint: "/api/connectors/notion/dev-session",
    preferenceKey: "tutti_notion_browser_persist_enabled",
    sessionKey: "tutti_notion_browser_session"
  },
  youmind: {
    endpoint: "/api/connectors/youmind/browser-session",
    preferenceKey: "tutti_youmind_browser_persist_enabled",
    sessionKey: "tutti_youmind_browser_session"
  },
  googledocs: {
    endpoint: "/api/connectors/google-docs/browser-session",
    preferenceKey: "tutti_google_docs_browser_persist_enabled",
    sessionKey: "tutti_google_docs_browser_session"
  }
};
const DEFAULT_BROWSER_PERSISTENCE_ENABLED: Record<BrowserPersistableProvider, boolean> = {
  notion: false,
  youmind: false,
  googledocs: false
};
const DEFAULT_BROWSER_PERSISTENCE_MESSAGES: Record<BrowserPersistableProvider, string> = {
  notion: "未在此浏览器保存 Notion 会话。",
  youmind: "未在此浏览器保存 YouMind 会话。",
  googledocs: "未在此浏览器保存 Google Docs 会话。"
};

const PUBLIC_LINK_TEST_CASES: Array<{ provider: Provider; label: string; url: string }> = [
  {
    provider: "notion",
    label: "Notion",
    url: "https://app.notion.com/p/16cb65e572f48049b4dff0a5010a637d?source=copy_link"
  },
  {
    provider: "feishu",
    label: "飞书",
    url: "https://j8luzjm9ir.feishu.cn/docx/G45Sdeoino8s6JxLQiecn5Vqnpe?from=from_copylink"
  },
  {
    provider: "youmind",
    label: "YouMind",
    url: "https://youmind.com/s/fGHbM9Si7QKJlJ"
  },
  {
    provider: "googledocs",
    label: "Google Docs",
    url: "https://docs.google.com/document/d/1y8KA-crwQsiXhpHL15rGppxWPUz0drtm/edit#bookmark=id.3u3pai97xq0r"
  }
];

export function ContentImportDemo() {
  const [provider, setProvider] = useState<Provider>("notion");
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState("");
  const [response, setResponse] = useState<PreviewResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("粘贴公开链接直接导入，或绑定来源后从工作区选择文件。");
  const [notionQuery, setNotionQuery] = useState("最近修改的页面");
  const [notionPages, setNotionPages] = useState<NotionPageSummary[]>([]);
  const [notionPagesStatus, setNotionPagesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [notionPagesMessage, setNotionPagesMessage] = useState("点击“获取页面”后才会请求 Notion MCP。");
  const [browserPersistenceEnabled, setBrowserPersistenceEnabled] = useState(DEFAULT_BROWSER_PERSISTENCE_ENABLED);
  const [browserPersistenceHydrated, setBrowserPersistenceHydrated] = useState(false);
  const [browserPersistenceMessages, setBrowserPersistenceMessages] = useState(DEFAULT_BROWSER_PERSISTENCE_MESSAGES);
  const browserRestoreAttempted = useRef<Record<BrowserPersistableProvider, boolean>>({
    notion: false,
    youmind: false,
    googledocs: false
  });
  const [youMindApiKey, setYouMindApiKey] = useState("");
  const [youMindConnectStatus, setYouMindConnectStatus] = useState<"idle" | "loading" | "error">("idle");
  const [youMindBoards, setYouMindBoards] = useState<YouMindBoardSummary[]>([]);
  const [youMindBoardId, setYouMindBoardId] = useState("");
  const [youMindFiles, setYouMindFiles] = useState<YouMindFileSummary[]>([]);
  const [youMindQuery, setYouMindQuery] = useState("");
  const [youMindFilesStatus, setYouMindFilesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [youMindFilesMessage, setYouMindFilesMessage] = useState("连接后读取个人 Board 与文件列表。");
  const [googlePickerStatus, setGooglePickerStatus] = useState<"idle" | "loading">("idle");
  const [googlePickerPreparation, setGooglePickerPreparation] = useState<"loading" | "ready" | "error">("loading");
  const [googlePickerPreparationError, setGooglePickerPreparationError] = useState("");
  const [googlePickerConfig, setGooglePickerConfig] = useState<GooglePickerConfig>();
  const [selectedGoogleDocument, setSelectedGoogleDocument] = useState<PickedGoogleDocument | undefined>();
  const [googleDocumentsStatus, setGoogleDocumentsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [googleDocumentsMessage, setGoogleDocumentsMessage] = useState("授权后自动读取已选择的 Google Docs。");
  const [notionAuthorizationRequiredSource, setNotionAuthorizationRequiredSource] = useState("");
  const [googleAuthorizationRequiredSource, setGoogleAuthorizationRequiredSource] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Provider | "all">("all");
  const [importEntryMode, setImportEntryMode] = useState<"workspace" | "link">("link");
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceSearchExpanded, setWorkspaceSearchExpanded] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [copiedTestLink, setCopiedTestLink] = useState<Provider | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  const bindingMenuRef = useRef<HTMLDivElement>(null);
  const bindingTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceSearchRef = useRef<HTMLDivElement>(null);

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
  }, []);

  useEffect(() => {
    setBrowserPersistenceEnabled({
      notion: window.localStorage.getItem(BROWSER_PERSISTENCE_CONFIG.notion.preferenceKey) === "1",
      youmind: window.localStorage.getItem(BROWSER_PERSISTENCE_CONFIG.youmind.preferenceKey) === "1",
      googledocs: window.localStorage.getItem(BROWSER_PERSISTENCE_CONFIG.googledocs.preferenceKey) === "1"
    });
    setBrowserPersistenceHydrated(true);
  }, []);

  useEffect(() => {
    if (
      sourceFilter !== "all"
      && sourceFilter !== "googledocs"
      && !settings.connections[sourceFilter].connected
    ) setSourceFilter("all");
  }, [settings.connections, sourceFilter]);

  useEffect(() => {
    if (!showConnections) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!bindingMenuRef.current?.contains(target) && !bindingTriggerRef.current?.contains(target)) {
        setShowConnections(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowConnections(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showConnections]);

  useEffect(() => {
    if (!workspaceSearchExpanded) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!workspaceSearchRef.current?.contains(event.target as Node)) setWorkspaceSearchExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceSearchExpanded(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [workspaceSearchExpanded]);

  useEffect(() => {
    if (!browserPersistenceHydrated) return;

    let cancelled = false;
    const setProviderMessage = (providerName: BrowserPersistableProvider, nextMessage: string) => {
      if (cancelled) return;
      setBrowserPersistenceMessages((current) => ({
        ...current,
        [providerName]: nextMessage
      }));
    };
    const syncBrowserSessions = async () => {
      const restoredProviders: BrowserPersistableProvider[] = [];
      for (const providerName of BROWSER_PERSISTABLE_PROVIDERS) {
        const connection = settings.connections[providerName];
        if (!connection.browserSessionPersistenceAvailable || !browserPersistenceEnabled[providerName]) continue;
        const persistence = BROWSER_PERSISTENCE_CONFIG[providerName];

        if (connection.connected) {
          const result = await fetch(persistence.endpoint, { cache: "no-store" });
          if (!result.ok) continue;
          const snapshot = await result.json();
          window.localStorage.setItem(persistence.sessionKey, JSON.stringify(snapshot));
          setProviderMessage(
            providerName,
            `${providerLabel(providerName)} 会话已保存到此浏览器，刷新后会自动恢复。`
          );
          continue;
        }

        if (browserRestoreAttempted.current[providerName]) continue;
        const serialized = window.localStorage.getItem(persistence.sessionKey);
        if (!serialized) continue;
        browserRestoreAttempted.current[providerName] = true;
        setProviderMessage(providerName, `正在从此浏览器恢复 ${providerLabel(providerName)} 会话…`);
        const result = await fetch(persistence.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized
        });
        if (!result.ok) {
          window.localStorage.removeItem(persistence.sessionKey);
          setProviderMessage(
            providerName,
            `浏览器中的 ${providerLabel(providerName)} 会话已失效，请重新绑定。`
          );
          continue;
        }
        restoredProviders.push(providerName);
        setProviderMessage(providerName, `${providerLabel(providerName)} 会话已从此浏览器恢复。`);
      }

      if (!restoredProviders.length) return;
      const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
      if (!settingsResult.ok || cancelled) return;
      setSettings(await settingsResult.json() as DemoSettings);
      setMessage(`已从此浏览器恢复 ${restoredProviders.map(providerLabel).join("、")} 会话。`);
    };
    void syncBrowserSessions().catch(() => {
      if (!cancelled) setMessage("同步浏览器会话失败，请重新绑定对应来源。");
    });
    return () => {
      cancelled = true;
    };
  }, [
    browserPersistenceEnabled,
    browserPersistenceHydrated,
    settings.connections.notion.connected,
    settings.connections.notion.browserSessionPersistenceAvailable,
    settings.connections.youmind.connected,
    settings.connections.youmind.browserSessionPersistenceAvailable,
    settings.connections.googledocs.connected,
    settings.connections.googledocs.browserSessionPersistenceAvailable
  ]);

  useEffect(() => {
    if (!settings.connections.notion.connected) return;
    void loadNotionPages("最近修改的页面");
  }, [settings.connections.notion.connected]);

  useEffect(() => {
    if (!settings.connections.youmind.connected) return;
    void loadYouMindBoards();
  }, [settings.connections.youmind.connected]);

  useEffect(() => {
    if (!settings.connections.googledocs.connected) return;
    void loadGoogleDocuments();
  }, [settings.connections.googledocs.connected]);

  useEffect(() => {
    let cancelled = false;
    setGooglePickerPreparation("loading");
    setGooglePickerPreparationError("");
    fetch("/api/connectors/google-docs/authorize", { cache: "no-store" })
      .then(async (result) => {
        const config = await result.json() as GooglePickerConfig & { error?: string };
        if (!result.ok || !config.available) {
          throw new Error(config.error || "当前站点尚未启用 Google 文档连接，请联系 Tutti 管理员。");
        }
        await prepareGoogleDocsPicker(config);
        if (cancelled) return;
        setGooglePickerConfig(config);
        setGooglePickerPreparation("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setGooglePickerConfig(undefined);
        setGooglePickerPreparation("error");
        setGooglePickerPreparationError(
          error instanceof Error ? error.message : "Google 授权组件加载失败。"
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(toDisplayDoc(response?.result.doc ?? emptyDraftDoc()));
  }, [editor, response]);

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

  const updateSource = (nextSource: string) => {
    setSource(nextSource);
    setResponse(null);
    const detectedProvider = detectImportProvider(nextSource);
    if (!detectedProvider) return;
    if (detectedProvider !== provider) setProvider(detectedProvider);
    setStatus("idle");
    setMessage(`已自动识别为 ${providerLabel(detectedProvider)} 文档。`);
  };

  async function loadNotionPages(query = notionQuery) {
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
  }

  const toggleBrowserPersistence = (providerName: BrowserPersistableProvider, enabled: boolean) => {
    const persistence = BROWSER_PERSISTENCE_CONFIG[providerName];
    setBrowserPersistenceEnabled((current) => ({ ...current, [providerName]: enabled }));
    browserRestoreAttempted.current[providerName] = false;
    window.localStorage.setItem(persistence.preferenceKey, enabled ? "1" : "0");
    if (enabled) {
      setBrowserPersistenceMessages((current) => ({
        ...current,
        [providerName]: settings.connections[providerName].connected
          ? `正在把当前 ${providerLabel(providerName)} 会话保存到此浏览器…`
          : `下次绑定 ${providerLabel(providerName)} 后会把会话保存到此浏览器。`
      }));
    } else {
      window.localStorage.removeItem(persistence.sessionKey);
      setBrowserPersistenceMessages((current) => ({
        ...current,
        [providerName]: `已关闭并清除此浏览器中的 ${providerLabel(providerName)} 会话。`
      }));
    }
  };

  const clearPersistedBrowserSession = (providerName: BrowserPersistableProvider) => {
    window.localStorage.removeItem(BROWSER_PERSISTENCE_CONFIG[providerName].sessionKey);
    browserRestoreAttempted.current[providerName] = true;
    setBrowserPersistenceMessages((current) => ({
      ...current,
      [providerName]: `${providerLabel(providerName)} 已断开，浏览器会话已清除。`
    }));
  };

  const fetchYouMindFiles = async (boardId: string, query = "") => {
    const params = new URLSearchParams({ boardId });
    if (query.trim()) params.set("q", query.trim());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await fetch(`/api/connectors/youmind/files?${params}`, { cache: "no-store" });
      const payload = await result.json().catch(() => ({})) as { files?: YouMindFileSummary[]; error?: string };
      if (result.ok) return payload.files ?? [];
      const retryable = result.status === 429 || result.status >= 500;
      if (!retryable || attempt === 2) {
        throw new Error(payload.error ? `${payload.error}（HTTP ${result.status}）` : `文件列表请求失败：${result.status}`);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
    }
    return [];
  };

  const loadYouMindFiles = async (boardId = youMindBoardId, query = youMindQuery) => {
    if (!boardId) {
      setYouMindFilesStatus("error");
      setYouMindFilesMessage("请先选择一个 YouMind Board。");
      return false;
    }
    setYouMindFilesStatus("loading");
    setYouMindFilesMessage("正在通过 YouMind OpenAPI 读取文件…");
    try {
      const files = await fetchYouMindFiles(boardId, query);
      setYouMindFiles(files);
      setYouMindFilesStatus("ready");
      setYouMindFilesMessage(files.length ? `找到 ${files.length} 个 article 文档。` : "这个 Board 中没有匹配的 article 文档。");
      return true;
    } catch (error) {
      setYouMindFiles([]);
      setYouMindFilesStatus("error");
      setYouMindFilesMessage(error instanceof Error ? error.message : "读取 YouMind 文件失败。");
      return false;
    }
  };

  const chooseGoogleDocument = async () => {
    if (googlePickerPreparation !== "ready" || !googlePickerConfig) {
      setStatus("error");
      setMessage(googlePickerPreparationError || "Google 授权组件仍在准备中，请稍后重试。");
      return;
    }
    setGooglePickerStatus("loading");
    setStatus("loading");
    setMessage("正在打开 Google 个人授权与文档选择器…");
    try {
      const pickerResult = await openGoogleDocsPicker(googlePickerConfig);
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
      setGoogleAuthorizationRequiredSource("");
      setGoogleDocumentsStatus("ready");
      setGoogleDocumentsMessage(`已读取「${pickerResult.document.name}」。`);
      setImportEntryMode("workspace");
      setSource(pickerResult.document.url);
      setMessage(`已选择「${pickerResult.document.name}」，正在生成预览…`);
      await runImport(pickerResult.document.url, "googledocs");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Google Picker 打开失败。");
    } finally {
      setGooglePickerStatus("idle");
    }
  };

  const loadGoogleDocuments = async () => {
    setGoogleDocumentsStatus("loading");
    setGoogleDocumentsMessage("正在读取 Google Picker 已授权的文档…");
    try {
      const result = await fetch("/api/connectors/google-docs/documents", { cache: "no-store" });
      const payload = await result.json() as { documents?: PickedGoogleDocument[]; error?: string };
      if (!result.ok) throw new Error(payload.error || `Google Docs 列表请求失败：${result.status}`);
      const document = payload.documents?.[0];
      setSelectedGoogleDocument(document);
      setGoogleDocumentsStatus("ready");
      setGoogleDocumentsMessage(document ? `已读取「${document.name}」。` : "当前授权中没有可读取的 Google Docs。");
    } catch (error) {
      setSelectedGoogleDocument(undefined);
      setGoogleDocumentsStatus("error");
      setGoogleDocumentsMessage(error instanceof Error ? error.message : "读取 Google Docs 失败。");
    }
  };

  const disconnectGoogleDocs = async () => {
    await fetch("/api/connectors/google-docs/authorize", { method: "DELETE" });
    clearPersistedBrowserSession("googledocs");
    const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
    setSettings(await settingsResult.json() as DemoSettings);
    setSelectedGoogleDocument(undefined);
    setGoogleDocumentsStatus("idle");
    setGoogleDocumentsMessage("授权后自动读取已选择的 Google Docs。");
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
      if (boards.length) {
        const filesById = new Map<string, YouMindFileSummary>();
        const failedBoards: Array<{ name: string; reason: string }> = [];
        for (const board of boards) {
          try {
            const boardFiles = await fetchYouMindFiles(board.id);
            for (const file of boardFiles) {
              filesById.set(file.id, { ...file, boardName: board.name });
            }
          } catch (error) {
            failedBoards.push({
              name: board.name,
              reason: error instanceof Error ? error.message : "未知错误"
            });
          }
        }
        if (failedBoards.length === boards.length) {
          throw new Error(`所有 YouMind Board 同步失败：${failedBoards.map((board) => `${board.name}（${board.reason}）`).join("；")}`);
        }
        const files = [...filesById.values()];
        setYouMindFiles(files);
        setYouMindFilesStatus("ready");
        const syncMessage = failedBoards.length
          ? `已同步 ${boards.length - failedBoards.length}/${boards.length} 个 Board，共 ${files.length} 个 article 文档；失败：${failedBoards.map((board) => `${board.name}（${board.reason}）`).join("；")}`
          : `已自动同步 ${boards.length} 个 Board，共 ${files.length} 个 article 文档。`;
        setYouMindFilesMessage(syncMessage);
        setStatus(failedBoards.length ? "error" : "ready");
        setMessage(syncMessage);
      } else {
        setYouMindFiles([]);
        setYouMindFilesStatus("ready");
        setYouMindFilesMessage("当前账号没有可访问的 Board。");
        setStatus("ready");
        setMessage("YouMind 已连接，但当前账号没有可访问的 Board。");
      }
    } catch (error) {
      setYouMindBoards([]);
      setYouMindFiles([]);
      setYouMindFilesStatus("error");
      const errorMessage = error instanceof Error ? error.message : "读取 YouMind Board 失败。";
      setYouMindFilesMessage(errorMessage);
      setStatus("error");
      setMessage(errorMessage);
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
      setImportEntryMode("workspace");
      setSourceFilter("youmind");
      setWorkspaceQuery("");
      setShowConnections(false);
    } catch (error) {
      setYouMindConnectStatus("error");
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "YouMind 连接失败。");
    }
  };

  const disconnectYouMind = async () => {
    setYouMindConnectStatus("loading");
    try {
      const result = await fetch("/api/connectors/youmind/authorize", { method: "DELETE" });
      if (!result.ok) throw new Error(`解绑失败：${result.status}`);
      clearPersistedBrowserSession("youmind");
      const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
      if (!settingsResult.ok) throw new Error(`刷新连接状态失败：${settingsResult.status}`);
      setSettings(await settingsResult.json() as DemoSettings);
      setYouMindBoards([]);
      setYouMindFiles([]);
      setYouMindBoardId("");
      setYouMindQuery("");
      setSource("");
      setResponse(null);
      setYouMindConnectStatus("idle");
      setStatus("idle");
      setMessage("YouMind 已解绑，API Key 与浏览器会话已清除。");
    } catch (error) {
      setYouMindConnectStatus("error");
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "YouMind 解绑失败。");
    }
  };

  const runImport = async (overrideSource?: string, overrideProvider?: Provider) => {
    setStatus("loading");
    setMessage("正在读取真实平台文档并转换格式…");
    setResponse(null);
    const requestSource = overrideSource ?? source;
    const requestProvider = overrideProvider ?? provider;

    try {
      const result = await fetch("/api/content-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: requestProvider, source: requestSource, mode: "live" })
      });
      const payload = (await result.json()) as PreviewResponse & {
        error?: string;
        code?: string;
        authorizationRequired?: boolean;
      };
      if (!result.ok) {
        if (requestProvider === "notion" && payload.authorizationRequired) {
          setNotionAuthorizationRequiredSource(requestSource.trim());
          setProvider("notion");
          setShowConnections(true);
          setStatus("idle");
          setMessage(payload.error || "这个 Notion 链接无法公开读取，请连接 Notion 后重试。");
          return;
        }
        if (requestProvider === "googledocs" && payload.authorizationRequired) {
          setGoogleAuthorizationRequiredSource(requestSource.trim());
          setProvider("googledocs");
          setShowConnections(true);
          setStatus("idle");
          setMessage(payload.error || "这篇 Google Docs 需要通过 Google Picker 授权后导入。");
          return;
        }
        if (requestProvider === "youmind" && payload.authorizationRequired) {
          setProvider("youmind");
          setShowConnections(true);
          setStatus("idle");
          setMessage(payload.error || "这个 YouMind 链接无法公开读取，请连接 API Key 后重试。");
          return;
        }
        throw new Error(payload.error || `请求失败：${result.status}`);
      }
      if (requestProvider === "notion") setNotionAuthorizationRequiredSource("");
      if (requestProvider === "googledocs") setGoogleAuthorizationRequiredSource("");
      setResponse(payload);
      setStatus("ready");
      setMessage(
        `${providerLabel(requestProvider)} 导入完成：${payload.result.doc.content?.length ?? 0} 个顶层 Block，${payload.result.assets.length} 个待转存素材。`
      );
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "导入预览失败。");
    }
  };

  const liveReady = settings.liveAvailable[provider];
  const notionConnection = settings.connections.notion;
  const youMindConnection = settings.connections.youmind;
  const googleDocsConnection = settings.connections.googledocs;
  const detectedProvider = detectImportProvider(source);
  const result = response?.result;
  const providers: Provider[] = ["notion", "feishu", "youmind", "googledocs"];
  const bindableProviders: BrowserPersistableProvider[] = ["notion", "youmind", "googledocs"];
  const connectedCount = providers.filter((item) => settings.connections[item].connected).length;
  const workspaceDocuments = useMemo<WorkspaceDocument[]>(() => [
    ...notionPages.map((page) => ({
      id: `notion-${page.id}`,
      provider: "notion" as const,
      title: page.title,
      source: page.url,
      updatedAt: page.timestamp,
      meta: page.highlight || formatNotionPageDate(page.timestamp)
    })),
    ...youMindFiles.map((file) => ({
      id: `youmind-${file.id}`,
      provider: "youmind" as const,
      title: file.title,
      source: file.url || file.id,
      updatedAt: file.lastEditedAt,
      meta: `${file.boardName ? `${file.boardName} · ` : ""}${file.kind || "article"} · ${formatDocumentDate(file.lastEditedAt, "无更新时间")}`
    })),
    ...(selectedGoogleDocument ? [{
      id: `googledocs-${selectedGoogleDocument.id}`,
      provider: "googledocs" as const,
      title: selectedGoogleDocument.name,
      source: selectedGoogleDocument.url,
      meta: "Google Picker 已授权"
    }] : [])
  ], [notionPages, youMindFiles, selectedGoogleDocument]);
  const filteredDocuments = useMemo(() => {
    const normalizedQuery = workspaceQuery.trim().toLocaleLowerCase();
    return workspaceDocuments.filter((document) => {
      const matchesProvider = sourceFilter === "all" || document.provider === sourceFilter;
      const matchesQuery = !normalizedQuery || `${document.title} ${document.meta}`.toLocaleLowerCase().includes(normalizedQuery);
      return matchesProvider && matchesQuery;
    });
  }, [workspaceDocuments, sourceFilter, workspaceQuery]);
  const libraryLinkAnalysis = analyzeImportSource(libraryQuery);
  const googleLinkAuthorizationRequired = libraryLinkAnalysis?.provider === "googledocs"
    && googleAuthorizationRequiredSource === libraryQuery.trim();
  const notionLinkAuthorizationRequired = libraryLinkAnalysis?.provider === "notion"
    && notionAuthorizationRequiredSource === libraryQuery.trim();
  const publicLinkAuthorizationRequired = googleLinkAuthorizationRequired || notionLinkAuthorizationRequired;
  const libraryLinkState = !libraryLinkAnalysis?.provider || libraryLinkAnalysis.resourceType === "unsupported"
    ? "blocked"
    : publicLinkAuthorizationRequired
      ? "authorization"
      : libraryLinkAnalysis.publicImportSupported
        ? "ready"
        : settings.connections[libraryLinkAnalysis.provider].connected
          ? "ready"
          : "authorization";
  const libraryLoading =
    (notionConnection.connected && notionPagesStatus === "loading")
    || (youMindConnection.connected && youMindFilesStatus === "loading")
    || (googleDocsConnection.connected && googleDocumentsStatus === "loading");
  const libraryLoadError = [
    notionConnection.connected && notionPagesStatus === "error" ? notionPagesMessage : "",
    youMindConnection.connected && youMindFilesStatus === "error" ? youMindFilesMessage : "",
    googleDocsConnection.connected && googleDocumentsStatus === "error" ? googleDocumentsMessage : ""
  ].find(Boolean);
  const chooseWorkspaceDocument = (document: WorkspaceDocument) => {
    setImportEntryMode("workspace");
    setProvider(document.provider);
    setSource(document.source);
    setLibraryQuery("");
    void runImport(document.source, document.provider);
  };

  const analyzeAndImportLink = async () => {
    setImportEntryMode("link");
    const normalizedCandidate = libraryQuery.trim();
    if (!normalizedCandidate) {
      setResponse(null);
      setStatus("error");
      setMessage("请输入要导入的文档链接。");
      return;
    }
    const analysis = analyzeImportSource(normalizedCandidate);
    if (!analysis) {
      setResponse(null);
      setStatus("error");
      setMessage("链接格式不正确，请输入完整的 Notion、飞书、YouMind 或 Google Docs 文档地址。");
      return;
    }
    if (!analysis.provider || analysis.resourceType === "unsupported") {
      setSource("");
      setResponse(null);
      setStatus("error");
      setMessage(analysis.message);
      return;
    }

    setProvider(analysis.provider);
    if (!analysis.publicImportSupported && !settings.connections[analysis.provider].connected) {
      setResponse(null);
      setStatus("idle");
      setMessage(`已识别 ${providerLabel(analysis.provider)}，请先完成来源绑定。`);
      setShowConnections(true);
      return;
    }

    if (analysis.resourceType === "container") {
      if (analysis.provider !== "youmind" || !analysis.resourceId) {
        setStatus("error");
        setMessage(analysis.message);
        return;
      }
      setSource("");
      setResponse(null);
      setSourceFilter("youmind");
      setYouMindBoardId(analysis.resourceId);
      setStatus("loading");
      setMessage("正在打开 YouMind Board 并读取其中的文章…");
      const loaded = await loadYouMindFiles(analysis.resourceId, "");
      if (loaded) {
        setImportEntryMode("workspace");
        setWorkspaceQuery("");
        setStatus("ready");
        setMessage("已打开 YouMind Board，请选择其中一篇文章进行预览。");
      } else {
        setStatus("error");
        setMessage("YouMind Board 打开失败，请检查访问权限后重试。");
      }
      return;
    }

    setSource(normalizedCandidate);
    if (analysis.provider === "notion") setNotionAuthorizationRequiredSource("");
    if (analysis.provider === "googledocs") setGoogleAuthorizationRequiredSource("");
    await runImport(normalizedCandidate, analysis.provider);
  };

  const linkNeedsAuthorization = Boolean(
    libraryLinkAnalysis?.provider && (
      libraryLinkAnalysis.provider === "notion"
        ? notionLinkAuthorizationRequired
        : libraryLinkAnalysis.provider === "googledocs"
          ? googleLinkAuthorizationRequired
        : !libraryLinkAnalysis.publicImportSupported
          && !settings.connections[libraryLinkAnalysis.provider].connected
    )
  );
  const linkCanContinue = Boolean(
    libraryLinkAnalysis?.provider && libraryLinkAnalysis.resourceType !== "unsupported"
  );
  const primaryActionLabel = (() => {
    if (status === "loading") return "处理中…";
    if (result) return "确认导入";
    if (linkNeedsAuthorization) return "去授权";
    if (libraryLinkAnalysis?.resourceType === "container") return "打开 Board";
    return importEntryMode === "link" ? "分析并预览" : "选择文档";
  })();
  const primaryActionDisabled = status === "loading"
    || (importEntryMode === "link"
      ? !linkCanContinue || (googleLinkAuthorizationRequired && googlePickerPreparation !== "ready")
      : !result);

  const runPrimaryAction = () => {
    if (result) {
      setStatus("ready");
      setMessage(`已确认导入「${result.title}」。`);
      return;
    }
    if (importEntryMode === "link" && googleLinkAuthorizationRequired) {
      setProvider("googledocs");
      void chooseGoogleDocument();
      return;
    }
    if (importEntryMode === "link" && notionLinkAuthorizationRequired) {
      setProvider("notion");
      setShowConnections(true);
      return;
    }
    if (importEntryMode === "link") void analyzeAndImportLink();
  };

  const fillTestLink = (testCase: (typeof PUBLIC_LINK_TEST_CASES)[number]) => {
    setImportEntryMode("link");
    setLibraryQuery(testCase.url);
    setSource("");
    setResponse(null);
    setNotionAuthorizationRequiredSource("");
    setGoogleAuthorizationRequiredSource("");
    setStatus("idle");
    setMessage(`已填入 ${testCase.label} 测试链接，点击“分析并预览”开始测试。`);
  };

  const copyTestLink = async (testCase: (typeof PUBLIC_LINK_TEST_CASES)[number]) => {
    if (await copyTextToClipboard(testCase.url)) {
      setCopiedTestLink(testCase.provider);
      setMessage(`已复制 ${testCase.label} 测试链接。`);
      window.setTimeout(() => setCopiedTestLink((current) => current === testCase.provider ? null : current), 1600);
    } else {
      fillTestLink(testCase);
      setMessage(`无法直接写入剪贴板，已将 ${testCase.label} 测试链接填入输入框，可在输入框中复制。`);
    }
  };

  const showWorkspaceLayout = true;
  if (showWorkspaceLayout) return (
    <main className="import-demo-shell import-workspace-shell">
      <section className="import-workspace-layout">
        <aside className="import-library-panel">
          <header className="import-panel-title">
            <h1>选择导入文档</h1>
            <a href="/">返回审阅</a>
          </header>

          <section className="import-link-entry-section" aria-labelledby="public-link-entry-title">
            <header className="import-source-section-heading">
              <div>
                <strong id="public-link-entry-title">粘贴公开链接</strong>
                <small>飞书仅支持外部公开链接，不提供账号绑定。</small>
              </div>
              <span>默认入口</span>
            </header>

            <div className="import-library-search-row single">
              <label className={detectImportProvider(libraryQuery) ? "detected" : ""}>
                <span aria-hidden="true">⌕</span>
                <input
                  value={libraryQuery}
                  onChange={(event) => {
                    setImportEntryMode("link");
                    setLibraryQuery(event.target.value);
                    setSource("");
                    setResponse(null);
                    setNotionAuthorizationRequiredSource("");
                    setGoogleAuthorizationRequiredSource("");
                    setStatus("idle");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && linkCanContinue && !primaryActionDisabled) {
                      event.preventDefault();
                      runPrimaryAction();
                    }
                  }}
                  placeholder="粘贴公开的 Notion、飞书、YouMind 或 Google Docs 链接"
                  aria-label="要导入的文档链接"
                  inputMode="url"
                  autoComplete="off"
                />
                {detectImportProvider(libraryQuery) ? (
                  <span className="import-search-provider"><ProviderIcon provider={detectImportProvider(libraryQuery)!} /></span>
                ) : null}
              </label>
            </div>

            <div className="import-public-test-links" aria-label="公开链接测试地址">
              <div className="import-public-test-links-heading">
                <strong>公开链接测试</strong>
                <small>点击平台名填入，或直接复制地址</small>
              </div>
              <div className="import-public-test-link-list">
                {PUBLIC_LINK_TEST_CASES.map((testCase) => (
                  <div className="import-public-test-link" key={testCase.provider}>
                    <button type="button" className="import-public-test-fill" onClick={() => fillTestLink(testCase)}>
                      <ProviderIcon provider={testCase.provider} />
                      <span>
                        <strong>{testCase.label}</strong>
                        <small>{testCase.url}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="import-public-test-copy"
                      aria-label={`复制 ${testCase.label} 测试链接`}
                      onClick={() => void copyTestLink(testCase)}
                    >
                      {copiedTestLink === testCase.provider ? "已复制" : "复制"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="import-platform-binding-row import-binding-menu" ref={bindingMenuRef}>
              <button
                ref={bindingTriggerRef}
                className={showConnections ? "active" : ""}
                type="button"
                aria-expanded={showConnections}
                aria-controls="import-connection-drawer"
                onClick={() => {
                  if (!showConnections && provider === "feishu") setProvider("notion");
                  setShowConnections((current) => !current);
                }}
              >
                <span aria-hidden="true">+</span>
                平台绑定
              </button>

              {showConnections ? (
                <section id="import-connection-drawer" className="import-connection-drawer" aria-label="管理来源绑定">
                  <div className="import-connection-tabs" role="tablist" aria-label="选择要管理的平台">
                    {bindableProviders.map((item) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={provider === item}
                        className={provider === item ? "active" : ""}
                        onClick={() => setProvider(item)}
                        key={item}
                      >
                        <ProviderIcon provider={item} />
                        <span>{providerLabel(item)}</span>
                        <i className={settings.connections[item].connected ? "connected" : ""} />
                      </button>
                    ))}
                  </div>

                  <div className="import-connection-action">
                    {provider === "notion" ? (
                      <>
                        <div>
                          <strong>{notionConnection.accountName || "Notion 工作区"}</strong>
                          <small>{notionConnection.connected ? "已绑定，可读取授权页面" : "通过官方 MCP OAuth 绑定"}</small>
                        </div>
                        <a href="/api/connectors/notion/authorize">{notionConnection.connected ? "重新绑定" : "绑定"}</a>
                      </>
                    ) : provider === "googledocs" ? (
                      <>
                        <div>
                          <strong>{googleDocsConnection.accountName || "Google Docs"}</strong>
                          <small>{selectedGoogleDocument ? `已选择「${selectedGoogleDocument.name}」` : "使用官方 Picker 授权单篇文档"}</small>
                        </div>
                        <button
                          type="button"
                          disabled={googlePickerStatus === "loading" || googlePickerPreparation !== "ready"}
                          onClick={() => void chooseGoogleDocument()}
                        >
                          {googlePickerStatus === "loading" ? "打开中…" : "添加到列表"}
                        </button>
                      </>
                    ) : youMindConnection.connected ? (
                      <>
                        <div>
                          <strong>{youMindConnection.accountName || "YouMind"}</strong>
                          <small>已通过 OpenAPI 绑定个人工作区</small>
                        </div>
                        <button className="disconnect" type="button" disabled={youMindConnectStatus === "loading"} onClick={() => void disconnectYouMind()}>
                          {youMindConnectStatus === "loading" ? "解绑中…" : "解绑"}
                        </button>
                      </>
                    ) : youMindConnection.mode === "server-key" ? (
                      <>
                        <div><strong>YouMind</strong><small>服务端已配置访问凭据</small></div>
                        <button type="button" onClick={() => void connectYouMind()}>绑定</button>
                      </>
                    ) : (
                      <div className="import-inline-key">
                        <input
                          type="password"
                          aria-label="YouMind API Key"
                          value={youMindApiKey}
                          onChange={(event) => setYouMindApiKey(event.target.value)}
                          placeholder="输入 YouMind API Key"
                        />
                        <button type="button" disabled={!youMindApiKey.trim()} onClick={() => void connectYouMind()}>绑定</button>
                      </div>
                    )}
                  </div>

                  {isBrowserPersistableProvider(provider) && settings.connections[provider].browserSessionPersistenceAvailable ? (
                    <label className="import-dev-persistence compact">
                      <input
                        type="checkbox"
                        checked={browserPersistenceEnabled[provider]}
                        onChange={(event) => toggleBrowserPersistence(provider, event.target.checked)}
                      />
                      <span>
                        <strong>刷新后保持 {providerLabel(provider)} 绑定（实验）</strong>
                        <small>{browserPersistenceMessages[provider]} {browserPersistenceWarning(provider)}</small>
                      </span>
                    </label>
                  ) : null}
                </section>
              ) : null}
            </div>

            {libraryLinkAnalysis ? (
              <div className={`import-link-analysis ${libraryLinkState}`} role="status">
                <span>{libraryLinkState === "ready" ? "✓" : "!"}</span>
                <div>
                  <strong>{libraryLinkAnalysis.resourceLabel}</strong>
                  <small>
                    {libraryLinkState === "authorization"
                      ? libraryLinkAnalysis.provider === "googledocs"
                        ? "公开读取失败，需要通过 Google Picker 授权这篇文档。"
                        : `公开读取失败，需要绑定 ${libraryLinkAnalysis.provider ? providerLabel(libraryLinkAnalysis.provider) : "文档来源"}。`
                      : libraryLinkAnalysis.resourceType === "container"
                        ? "这是工作区链接，绑定来源后可以打开并选择其中的文章。"
                        : libraryLinkAnalysis.publicImportSupported
                          ? "链接有效，将直接读取公开文档。"
                          : libraryLinkAnalysis.importable
                            ? "链接有效，点击右下角“分析并预览”读取文档。"
                            : libraryLinkAnalysis.message}
                  </small>
                </div>
              </div>
            ) : null}
          </section>

          {connectedCount ? (
            <section
              className="import-workspace-source-section"
              aria-labelledby="workspace-source-title"
            >
              <header className="import-source-section-heading workspace">
                <div>
                  <strong id="workspace-source-title">从工作区选择</strong>
                  <small>已绑定 {connectedCount} 个来源，可直接浏览文件列表。</small>
                </div>
              </header>

              <div className="import-filter-toolbar">
                  <div className="import-filter-row" role="tablist" aria-label="文档来源筛选">
                    <button type="button" className={sourceFilter === "all" ? "active" : ""} onClick={() => { setImportEntryMode("workspace"); setSourceFilter("all"); }}>全部</button>
                    {providers.filter((item) => settings.connections[item].connected).map((item) => (
                      <button
                        type="button"
                        className={sourceFilter === item ? "active" : ""}
                        onClick={() => {
                          setImportEntryMode("workspace");
                          setSourceFilter(item);
                          setProvider(item);
                        }}
                        key={item}
                      >
                        {providerLabel(item)}
                      </button>
                    ))}
                  </div>

                  <div className={`import-workspace-search-control ${workspaceSearchExpanded ? "expanded" : ""}`} ref={workspaceSearchRef}>
                    <button
                      type="button"
                      className={`import-workspace-search-toggle ${workspaceSearchExpanded ? "active" : ""} ${workspaceQuery ? "has-query" : ""}`}
                      aria-expanded={workspaceSearchExpanded}
                      aria-controls="workspace-document-search"
                      onClick={() => setWorkspaceSearchExpanded((expanded) => !expanded)}
                    >
                      <span aria-hidden="true">⌕</span>
                      搜索
                    </button>
                    {workspaceSearchExpanded ? (
                      <div className="import-workspace-search-popover" id="workspace-document-search" role="search">
                        <div className="import-library-search-row single">
                          <label>
                            <span aria-hidden="true">⌕</span>
                            <input
                              value={workspaceQuery}
                              onChange={(event) => { setImportEntryMode("workspace"); setWorkspaceQuery(event.target.value); }}
                              placeholder="筛选已加载的工作区文档"
                              aria-label="搜索工作区文档"
                              autoFocus
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="import-document-library" role="list" aria-label="可导入文档">
                  {filteredDocuments.length ? filteredDocuments.map((document) => (
                    <button
                      type="button"
                      role="listitem"
                      className={source === document.source ? "selected" : ""}
                      onClick={() => chooseWorkspaceDocument(document)}
                      key={document.id}
                    >
                      <ProviderIcon provider={document.provider} />
                      <span className="import-document-copy">
                        <strong>{document.title}</strong>
                        <small>来源：{providerLabel(document.provider)}<b>·</b>{document.meta}</small>
                      </span>
                      {source === document.source ? <span className="import-selected-check">✓</span> : null}
                    </button>
                  )) : (
                    <div className="import-library-empty compact">
                      <span>{libraryLoading ? "↻" : libraryLoadError ? "!" : "⌕"}</span>
                      <strong>{libraryLoading
                        ? "正在加载已授权文档…"
                        : libraryLoadError
                          ? "文档列表加载失败"
                          : "暂无可浏览的文档"}</strong>
                      <small>{libraryLoading
                        ? "正在读取已绑定平台中的文件。"
                        : libraryLoadError || "当前来源还没有可显示的文档。"}</small>
                    </div>
                  )}
                </div>
            </section>
          ) : null}

          <div className={`import-feedback import-library-feedback ${status}`} role="status" aria-live="polite">
            <span>{statusIcon(status)}</span>
            <p>{message}</p>
          </div>

          <footer className="import-library-actions">
            <button
              type="button"
              onClick={() => {
                setSource("");
                setWorkspaceQuery("");
                setLibraryQuery("");
                setResponse(null);
                setStatus("idle");
                setMessage("已取消当前选择，请重新选择文档。");
              }}
            >
              取消
            </button>
            <button
              className="primary"
              type="button"
              disabled={primaryActionDisabled}
              onClick={runPrimaryAction}
            >
              {primaryActionLabel}
            </button>
          </footer>
        </aside>

        <section className="import-workspace-preview">
          <header className="import-preview-heading">
            <h2>导入预览</h2>
            {status === "loading" ? <span>正在读取文档…</span> : null}
          </header>

          <div className={`import-preview-canvas ${result ? "has-content" : status === "loading" ? "loading" : "empty"}`}>
            {result ? (
              <>
                <div className="import-preview-document-header">
                  <h1>{result.title}</h1>
                  <div>
                    <span><ProviderIcon provider={result.source.provider} /> 来源：{providerLabel(result.source.provider)}</span>
                    <span>更新时间：{formatDocumentDate(result.sourceLastEditedAt, "刚刚")}</span>
                    <span>包含：正文 / 列表 / 表格 / 图片</span>
                  </div>
                </div>
                <EditorContent editor={editor} className="import-preview-editor import-workspace-editor" />
              </>
            ) : status === "loading" ? (
              <div className="import-preview-loading" role="status" aria-live="polite">
                <span className="import-preview-spinner" aria-hidden="true" />
                <strong>{googlePickerStatus === "loading" ? "正在打开文件选择器…" : "正在生成文档预览…"}</strong>
                <span>{message}</span>
              </div>
            ) : (
              <div className="import-empty-state">
                <div className="import-empty-icon">↗</div>
                <strong>选择一篇文档开始预览</strong>
                <span>可以浏览已绑定工作区，也可以直接粘贴文档链接。</span>
              </div>
            )}
          </div>

          <footer className="import-preview-meta">
            {result ? <span>{stats.characters.toLocaleString()} 字 · {stats.blocks} 个块</span> : <span>支持 Notion、飞书、YouMind 与 Google Docs</span>}
          </footer>
        </section>
      </section>
    </main>
  );

}
function notionMcpFeedback(outcome: string): { status: "ready" | "error"; message: string } {
  if (outcome === "connected") {
    return { status: "ready", message: "Notion MCP 连接成功，正在自动获取最近修改的页面。" };
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

function providerLabel(provider: Provider): string {
  return provider === "notion"
    ? "Notion"
    : provider === "feishu"
      ? "飞书"
      : provider === "youmind"
        ? "YouMind"
        : "Google Docs";
}

function isBrowserPersistableProvider(provider: Provider): provider is BrowserPersistableProvider {
  return provider !== "feishu";
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      const copied = navigator.clipboard.writeText(value).then(() => true, () => false);
      const timedOut = new Promise<false>((resolve) => window.setTimeout(() => resolve(false), 600));
      if (await Promise.race([copied, timedOut])) return true;
    } catch {
      // Fall through to the compatibility copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function browserPersistenceWarning(provider: BrowserPersistableProvider): string {
  return provider === "googledocs"
    ? "Access Token 会写入当前浏览器 localStorage；过期后需要重新授权，请勿在公共设备开启。"
    : "Token 会写入当前浏览器 localStorage，请勿在公共设备开启。";
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
