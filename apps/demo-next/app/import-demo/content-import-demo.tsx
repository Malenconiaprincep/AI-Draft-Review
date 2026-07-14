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

type DemoSettings = {
  liveAvailable: Record<Provider, boolean>;
  connections: {
    notion: {
      transport: "mcp";
      available: boolean;
      connected: boolean;
      accountName?: string;
      devLocalStorageAvailable: boolean;
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

type WorkspaceDocument = {
  id: string;
  provider: Provider;
  title: string;
  source: string;
  updatedAt?: string;
  meta: string;
};

const DEFAULT_SETTINGS: DemoSettings = {
  liveAvailable: { notion: false, feishu: false, youmind: false, googledocs: false },
  connections: {
    notion: { transport: "mcp", available: true, connected: false, devLocalStorageAvailable: false },
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

const NOTION_DEV_PERSISTENCE_PREFERENCE = "tutti_notion_dev_persist_enabled";
const NOTION_DEV_SESSION_STORAGE = "tutti_notion_dev_session";

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
  const [notionDevPersistenceEnabled, setNotionDevPersistenceEnabled] = useState(false);
  const [notionDevPersistenceHydrated, setNotionDevPersistenceHydrated] = useState(false);
  const [notionDevPersistenceMessage, setNotionDevPersistenceMessage] = useState("开发凭据尚未写入此浏览器。");
  const notionDevRestoreAttempted = useRef(false);
  const [feishuQuery, setFeishuQuery] = useState("最近修改的文档");
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
  const [googlePickerPreparation, setGooglePickerPreparation] = useState<"loading" | "ready" | "error">("loading");
  const [googlePickerPreparationError, setGooglePickerPreparationError] = useState("");
  const [googlePickerConfig, setGooglePickerConfig] = useState<GooglePickerConfig>();
  const [selectedGoogleDocument, setSelectedGoogleDocument] = useState<PickedGoogleDocument | undefined>();
  const [googleDocumentsStatus, setGoogleDocumentsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [googleDocumentsMessage, setGoogleDocumentsMessage] = useState("授权后自动读取已选择的 Google Docs。");
  const [sourceFilter, setSourceFilter] = useState<Provider | "all">("all");
  const [importEntryMode, setImportEntryMode] = useState<"workspace" | "link">("workspace");
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceSearchExpanded, setWorkspaceSearchExpanded] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [showConnections, setShowConnections] = useState(false);
  const bindingMenuRef = useRef<HTMLDivElement>(null);
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
    setNotionDevPersistenceEnabled(window.localStorage.getItem(NOTION_DEV_PERSISTENCE_PREFERENCE) !== "0");
    setNotionDevPersistenceHydrated(true);
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
      if (!bindingMenuRef.current?.contains(event.target as Node)) setShowConnections(false);
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
    if (
      !notionDevPersistenceHydrated
      || !settings.connections.notion.devLocalStorageAvailable
      || !notionDevPersistenceEnabled
    ) return;

    let cancelled = false;
    const syncDevSession = async () => {
      if (settings.connections.notion.connected) {
        const result = await fetch("/api/connectors/notion/dev-session", { cache: "no-store" });
        if (!result.ok) return;
        const snapshot = await result.json();
        window.localStorage.setItem(NOTION_DEV_SESSION_STORAGE, JSON.stringify(snapshot));
        if (!cancelled) setNotionDevPersistenceMessage("开发凭据已保存到此浏览器，刷新或重启服务后可恢复。");
        return;
      }

      if (notionDevRestoreAttempted.current) return;
      const serialized = window.localStorage.getItem(NOTION_DEV_SESSION_STORAGE);
      if (!serialized) return;
      notionDevRestoreAttempted.current = true;
      setNotionDevPersistenceMessage("正在从此浏览器恢复 Notion 开发凭据…");
      const result = await fetch("/api/connectors/notion/dev-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized
      });
      if (!result.ok) {
        window.localStorage.removeItem(NOTION_DEV_SESSION_STORAGE);
        if (!cancelled) setNotionDevPersistenceMessage("本地开发凭据已失效，请重新连接 Notion。");
        return;
      }
      const settingsResult = await fetch("/api/content-import/preview", { cache: "no-store" });
      if (!settingsResult.ok || cancelled) return;
      setSettings(await settingsResult.json() as DemoSettings);
      setMessage("已从 localStorage 恢复 Notion 开发会话，正在自动获取页面。");
      setNotionDevPersistenceMessage("开发凭据已从此浏览器恢复。");
    };
    void syncDevSession().catch(() => {
      if (!cancelled) setNotionDevPersistenceMessage("同步本地开发凭据失败，请重新连接 Notion。");
    });
    return () => {
      cancelled = true;
    };
  }, [
    notionDevPersistenceEnabled,
    notionDevPersistenceHydrated,
    settings.connections.notion.connected,
    settings.connections.notion.devLocalStorageAvailable
  ]);

  useEffect(() => {
    if (!settings.connections.notion.connected) return;
    void loadNotionPages("最近修改的页面");
  }, [settings.connections.notion.connected]);

  useEffect(() => {
    if (!settings.connections.feishu.connected) return;
    void loadFeishuDocuments("最近修改的文档");
  }, [settings.connections.feishu.connected]);

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

  const toggleNotionDevPersistence = (enabled: boolean) => {
    setNotionDevPersistenceEnabled(enabled);
    notionDevRestoreAttempted.current = false;
    window.localStorage.setItem(NOTION_DEV_PERSISTENCE_PREFERENCE, enabled ? "1" : "0");
    if (enabled) {
      setNotionDevPersistenceMessage(
        settings.connections.notion.connected
          ? "正在把当前 Notion 开发凭据保存到此浏览器…"
          : "下次连接 Notion 后会把开发凭据保存到此浏览器。"
      );
    } else {
      window.localStorage.removeItem(NOTION_DEV_SESSION_STORAGE);
      setNotionDevPersistenceMessage("已关闭并清除此浏览器中的 Notion 开发凭据。");
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
      return false;
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
      setGoogleDocumentsStatus("ready");
      setGoogleDocumentsMessage(`已读取「${pickerResult.document.name}」。`);
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
      const payload = (await result.json()) as PreviewResponse & { error?: string; code?: string };
      if (!result.ok) throw new Error(payload.error || `请求失败：${result.status}`);
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
  const feishuConnection = settings.connections.feishu;
  const youMindConnection = settings.connections.youmind;
  const googleDocsConnection = settings.connections.googledocs;
  const detectedProvider = detectImportProvider(source);
  const result = response?.result;
  const providers: Provider[] = ["notion", "feishu", "youmind", "googledocs"];
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
    ...feishuDocuments.map((document) => ({
      id: `feishu-${document.id}`,
      provider: "feishu" as const,
      title: document.title,
      source: document.url || document.id,
      updatedAt: document.lastEditedAt,
      meta: formatDocumentDate(document.lastEditedAt, "飞书文档")
    })),
    ...youMindFiles.map((file) => ({
      id: `youmind-${file.id}`,
      provider: "youmind" as const,
      title: file.title,
      source: file.url || file.id,
      updatedAt: file.lastEditedAt,
      meta: `${file.kind || "article"} · ${formatDocumentDate(file.lastEditedAt, "无更新时间")}`
    })),
    ...(selectedGoogleDocument ? [{
      id: `googledocs-${selectedGoogleDocument.id}`,
      provider: "googledocs" as const,
      title: selectedGoogleDocument.name,
      source: selectedGoogleDocument.url,
      meta: "Google Picker 已授权"
    }] : [])
  ], [notionPages, feishuDocuments, youMindFiles, selectedGoogleDocument]);
  const filteredDocuments = useMemo(() => {
    const normalizedQuery = workspaceQuery.trim().toLocaleLowerCase();
    return workspaceDocuments.filter((document) => {
      const matchesProvider = sourceFilter === "all" || document.provider === sourceFilter;
      const matchesQuery = !normalizedQuery || `${document.title} ${document.meta}`.toLocaleLowerCase().includes(normalizedQuery);
      return matchesProvider && matchesQuery;
    });
  }, [workspaceDocuments, sourceFilter, workspaceQuery]);
  const libraryLinkAnalysis = importEntryMode === "link" ? analyzeImportSource(libraryQuery) : null;
  const libraryLinkState = !libraryLinkAnalysis?.provider || libraryLinkAnalysis.resourceType === "unsupported"
    ? "blocked"
    : settings.connections[libraryLinkAnalysis.provider].connected
      ? "ready"
      : "authorization";
  const libraryLoading =
    (notionConnection.connected && notionPagesStatus === "loading")
    || (feishuConnection.connected && feishuDocumentsStatus === "loading")
    || (youMindConnection.connected && youMindFilesStatus === "loading")
    || (googleDocsConnection.connected && googleDocumentsStatus === "loading");
  const libraryLoadError = [
    notionConnection.connected && notionPagesStatus === "error" ? notionPagesMessage : "",
    feishuConnection.connected && feishuDocumentsStatus === "error" ? feishuDocumentsMessage : "",
    youMindConnection.connected && youMindFilesStatus === "error" ? youMindFilesMessage : "",
    googleDocsConnection.connected && googleDocumentsStatus === "error" ? googleDocumentsMessage : ""
  ].find(Boolean);

  const chooseWorkspaceDocument = (document: WorkspaceDocument) => {
    setProvider(document.provider);
    setSource(document.source);
    setLibraryQuery("");
    void runImport(document.source, document.provider);
  };

  const analyzeAndImportLink = async () => {
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
    if (!settings.connections[analysis.provider].connected) {
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
    await runImport(normalizedCandidate, analysis.provider);
  };

  const switchImportEntryMode = (nextMode: "workspace" | "link") => {
    if (nextMode === importEntryMode) return;
    setImportEntryMode(nextMode);
    setWorkspaceSearchExpanded(false);
    setSource("");
    setResponse(null);
    setStatus("idle");
    setMessage(nextMode === "link" ? "粘贴文档或 Board 链接，系统会自动识别来源与权限。" : "请从已绑定的工作区中选择一篇文档。");
  };

  const linkNeedsAuthorization = Boolean(
    libraryLinkAnalysis?.provider && !settings.connections[libraryLinkAnalysis.provider].connected
  );
  const linkCanContinue = Boolean(
    libraryLinkAnalysis?.provider && libraryLinkAnalysis.resourceType !== "unsupported"
  );
  const googlePickerAction = importEntryMode === "workspace" && sourceFilter === "googledocs" && !result;
  const primaryActionLabel = (() => {
    if (status === "loading") return "处理中…";
    if (result) return "确认导入";
    if (googlePickerAction) return "添加 Google Docs 到列表";
    if (importEntryMode === "link") {
      if (linkNeedsAuthorization) return "去授权";
      if (libraryLinkAnalysis?.resourceType === "container") return "打开 Board";
      return "分析并预览";
    }
    return "确认导入";
  })();
  const primaryActionDisabled = status === "loading"
    || (googlePickerAction
      ? googlePickerPreparation !== "ready"
      : importEntryMode === "link" ? !linkCanContinue : !result);

  const runPrimaryAction = () => {
    if (result) {
      setStatus("ready");
      setMessage(`已确认导入「${result.title}」。`);
      return;
    }
    if (googlePickerAction) {
      setProvider("googledocs");
      void chooseGoogleDocument();
      return;
    }
    if (importEntryMode === "link") void analyzeAndImportLink();
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

          <div className="import-binding-menu" ref={bindingMenuRef}>
            <button
              className={`import-binding-trigger ${showConnections ? "active" : ""}`}
              type="button"
              aria-expanded={showConnections}
              aria-controls="import-connection-drawer"
              onClick={() => setShowConnections((current) => !current)}
            >
              <span aria-hidden="true">↗</span>
              <strong>全部来源 · {connectedCount} 个已绑定</strong>
              <span className="import-binding-chevron" aria-hidden="true">⌄</span>
            </button>

            {showConnections ? (
              <section id="import-connection-drawer" className="import-connection-drawer" aria-label="管理来源绑定">
              <div className="import-connection-tabs" role="tablist" aria-label="选择要管理的平台">
                {providers.map((item) => (
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
                    <a href="/api/connectors/notion/authorize">
                      {notionConnection.connected ? "重新绑定" : "绑定"}
                    </a>
                  </>
                ) : provider === "feishu" ? (
                  <>
                    <div>
                      <strong>{feishuConnection.accountName || "飞书文档"}</strong>
                      <small>{feishuConnection.connected ? "已绑定当前用户文档" : "绑定后可搜索个人文档"}</small>
                    </div>
                    {feishuConnection.mode === "dynamic-app" && !feishuConnection.connected ? (
                      <button type="button" onClick={() => void startFeishuRegistration()}>扫码绑定</button>
                    ) : (
                      <a className={feishuConnection.available ? "" : "disabled"} href="/api/connectors/feishu/authorize">
                        {feishuConnection.connected ? "重新绑定" : "绑定"}
                      </a>
                    )}
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
                    <button type="button" onClick={() => void loadYouMindBoards()}>刷新</button>
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

              {provider === "notion" && notionConnection.devLocalStorageAvailable ? (
                <label className="import-dev-persistence compact">
                  <input
                    type="checkbox"
                    checked={notionDevPersistenceEnabled}
                    onChange={(event) => toggleNotionDevPersistence(event.target.checked)}
                  />
                  <span><strong>在此浏览器保存开发凭据</strong><small>{notionDevPersistenceMessage}</small></span>
                </label>
              ) : null}
              </section>
            ) : null}
          </div>

          <div className="import-entry-tabs" role="tablist" aria-label="选择文档添加方式">
            <button
              type="button"
              role="tab"
              aria-selected={importEntryMode === "workspace"}
              className={importEntryMode === "workspace" ? "active" : ""}
              onClick={() => switchImportEntryMode("workspace")}
            >
              从工作区选择
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importEntryMode === "link"}
              className={importEntryMode === "link" ? "active" : ""}
              onClick={() => switchImportEntryMode("link")}
            >
              粘贴链接
            </button>
          </div>

          {importEntryMode === "link" ? (
            <>
              <div className="import-library-search-row single">
                <label className={detectImportProvider(libraryQuery) ? "detected" : ""}>
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && linkCanContinue) {
                        event.preventDefault();
                        runPrimaryAction();
                      }
                    }}
                    placeholder="粘贴 Notion、飞书、YouMind 或 Google Docs 链接"
                    aria-label="要导入的文档链接"
                    inputMode="url"
                    autoComplete="off"
                  />
                  {detectImportProvider(libraryQuery) ? (
                    <span className="import-search-provider"><ProviderIcon provider={detectImportProvider(libraryQuery)!} /></span>
                  ) : null}
                </label>
              </div>

              {libraryLinkAnalysis ? (
                <div className={`import-link-analysis ${libraryLinkState}`} role="status">
                  <span>{libraryLinkState === "ready" ? "✓" : "!"}</span>
                  <div>
                    <strong>{libraryLinkAnalysis.resourceLabel}</strong>
                    <small>
                      {libraryLinkState === "authorization"
                        ? `已识别 ${libraryLinkAnalysis.provider ? providerLabel(libraryLinkAnalysis.provider) : "文档来源"}，继续前需要先完成绑定。`
                        : libraryLinkAnalysis.resourceType === "container"
                          ? "已识别 Board，点击右下角“打开 Board”后选择其中的文章。"
                          : libraryLinkAnalysis.importable
                            ? "链接有效，点击右下角“分析并预览”读取文档。"
                            : libraryLinkAnalysis.message}
                    </small>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="import-filter-toolbar">
              <div className="import-filter-row" role="tablist" aria-label="文档来源筛选">
                <button type="button" className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>全部</button>
                {providers.filter((item) => item === "googledocs" || settings.connections[item].connected).map((item) => (
                  <button
                    type="button"
                    className={sourceFilter === item ? "active" : ""}
                    onClick={() => {
                      setSourceFilter(item);
                      setProvider(item);
                    }}
                    key={item}
                  >
                    {providerLabel(item)}
                  </button>
                ))}
              </div>

              <div
                className={`import-workspace-search-control ${workspaceSearchExpanded ? "expanded" : ""}`}
                ref={workspaceSearchRef}
              >
                <button
                  type="button"
                  className={`import-workspace-search-toggle ${workspaceSearchExpanded ? "active" : ""} ${workspaceQuery ? "has-query" : ""}`}
                  aria-expanded={workspaceSearchExpanded}
                  aria-controls="workspace-document-search"
                  onClick={() => setWorkspaceSearchExpanded((expanded) => !expanded)}
                >
                  <span aria-hidden="true">⌕</span>
                  Search
                </button>
                {workspaceSearchExpanded ? (
                  <div className="import-workspace-search-popover" id="workspace-document-search" role="search">
                    <div className="import-library-search-row single">
                      <label>
                        <span aria-hidden="true">⌕</span>
                        <input
                          value={workspaceQuery}
                          onChange={(event) => setWorkspaceQuery(event.target.value)}
                          placeholder="搜索已授权工作区中的文档"
                          aria-label="搜索工作区文档"
                          autoFocus
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {importEntryMode === "workspace" ? <div className="import-document-library" role="list" aria-label="可导入文档">
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
                  <small>
                    来源：{providerLabel(document.provider)}
                    <b>·</b>
                    {document.meta}
                  </small>
                </span>
                {source === document.source ? <span className="import-selected-check">✓</span> : null}
              </button>
            )) : (
              <div className="import-library-empty">
                <span>{libraryLoading ? "↻" : libraryLoadError ? "!" : "⌕"}</span>
                <strong>{libraryLoading ? "正在加载已授权文档…" : libraryLoadError ? "文档列表加载失败" : "暂无可浏览的文档"}</strong>
                <small>
                  {libraryLoading
                    ? "进入页面后会自动读取已授权平台中的文档。"
                    : libraryLoadError || (connectedCount ? "已完成自动拉取，当前没有可显示的文档。" : "先绑定一个内容来源，即可在这里浏览文档。")}
                </small>
                {!connectedCount ? <button type="button" onClick={() => setShowConnections(true)}>管理绑定</button> : null}
              </div>
            )}
          </div> : null}

          {importEntryMode === "workspace" && provider === "youmind" && youMindConnection.connected && youMindBoards.length ? (
            <label className="import-board-select">
              <span>当前 YouMind Board</span>
              <select
                value={youMindBoardId}
                onChange={(event) => {
                  setYouMindBoardId(event.target.value);
                  void loadYouMindFiles(event.target.value, "");
                }}
              >
                {youMindBoards.map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}
              </select>
            </label>
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
          <div className="import-step-label">01 · 添加文档</div>
          <label className="import-field import-link-field">
            <span>粘贴文档链接，自动识别来源</span>
            <div className={`import-link-input ${detectedProvider ? "detected" : ""}`}>
              <input
                value={source}
                onChange={(event) => updateSource(event.target.value)}
                placeholder="粘贴 Notion、飞书、YouMind 或 Google Docs 链接"
                inputMode="url"
                autoComplete="off"
              />
              <span className={`import-detection-badge ${detectedProvider ? "ready" : ""}`}>
                {detectedProvider ? (
                  <>
                    <ProviderIcon provider={detectedProvider} />
                    已识别 {providerLabel(detectedProvider)}
                  </>
                ) : "自动识别"}
              </span>
            </div>
            <small>
              {source.trim() && !detectedProvider
                ? "暂未识别该链接，请检查地址，或从下方工作区选择。"
                : "识别后会自动切换到对应连接器，无需提前选择平台。"}
            </small>
          </label>

          <div className="import-path-divider"><span>或者</span></div>
          <div className="import-step-label">02 · 从工作区选择</div>
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
                <span className="import-provider-copy">
                  <strong>{providerLabel(item)}</strong>
                  <small>{providerConnectionLabel(item, settings)}</small>
                </span>
              </button>
            ))}
          </div>

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
                {googlePickerPreparation === "loading"
                  ? "正在预加载 Google 授权组件，完成后即可连接。"
                  : googlePickerPreparation === "error"
                    ? googlePickerPreparationError
                    : "点击连接后完成个人 Google 授权，再从官方窗口选择一篇 Docs；普通用户无需填写任何配置。"}
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

          <div className="import-step-label">03 · 授权并导入</div>
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
                disabled={googlePickerStatus === "loading" || googlePickerPreparation !== "ready"}
                onClick={() => void chooseGoogleDocument()}
              >
                <span className="provider-letter google">G</span>
                {googlePickerPreparation === "loading"
                  ? "正在准备 Google 授权…"
                  : googlePickerPreparation === "error"
                    ? "Google 授权不可用"
                    : googlePickerStatus === "loading"
                  ? "正在打开 Google Picker…"
                  : "添加 Google Docs 到列表"}
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
          {provider === "notion" && notionConnection.devLocalStorageAvailable ? (
            <label className="import-dev-persistence">
              <input
                type="checkbox"
                checked={notionDevPersistenceEnabled}
                onChange={(event) => toggleNotionDevPersistence(event.target.checked)}
              />
              <span>
                <strong>开发模式：在此浏览器保存 Notion 凭据</strong>
                <small>{notionDevPersistenceMessage} 生产环境会强制禁用。</small>
              </span>
            </label>
          ) : null}
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
                ? notionConnection.devLocalStorageAvailable && notionDevPersistenceEnabled
                  ? `已通过官方 MCP 连接${notionConnection.accountName ? `工作区「${notionConnection.accountName}」` : " Notion"}；开发凭据会同步到 localStorage。`
                  : `已通过官方 MCP 连接${notionConnection.accountName ? `工作区「${notionConnection.accountName}」` : " Notion"}。`
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

function providerConnectionLabel(provider: Provider, settings: DemoSettings): string {
  const connection = settings.connections[provider];
  if (connection.connected) return connection.accountName || "已连接";
  if (!connection.available) return "暂不可用";
  return "待授权";
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
