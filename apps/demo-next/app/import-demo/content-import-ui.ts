export type ImportProvider = "notion" | "feishu" | "youmind" | "googledocs";

export type ImportSourceAnalysis = {
  provider?: ImportProvider;
  importable: boolean;
  resourceType: "document" | "container" | "unsupported";
  resourceId?: string;
  resourceLabel: string;
  message: string;
};

const PROVIDER_HOSTS: Array<{ provider: ImportProvider; hosts: string[] }> = [
  { provider: "googledocs", hosts: ["docs.google.com"] },
  { provider: "notion", hosts: ["notion.so", "notion.site"] },
  { provider: "feishu", hosts: ["feishu.cn", "larksuite.com", "larkoffice.com"] },
  { provider: "youmind", hosts: ["youmind.com"] }
];

export function detectImportProvider(value: string): ImportProvider | null {
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    const hostname = url.hostname.toLowerCase();
    const match = PROVIDER_HOSTS.find(({ hosts }) =>
      hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    );
    return match?.provider ?? null;
  } catch {
    return null;
  }
}

export function analyzeImportSource(value: string): ImportSourceAnalysis | null {
  const candidate = value.trim();
  if (!candidate || (!/^https?:\/\//i.test(candidate) && !candidate.includes("."))) return null;
  const provider = detectImportProvider(candidate);
  if (!provider) {
    return {
      importable: false,
      resourceType: "unsupported",
      resourceLabel: "不支持的链接",
      message: "暂不支持这个链接，请粘贴 Notion、飞书、YouMind 或 Google Docs 文档地址。"
    };
  }

  const url = safeUrl(candidate);
  if (!url) {
    return { provider, importable: false, resourceType: "unsupported", resourceLabel: "链接格式错误", message: "链接格式不完整，请重新复制文档地址。" };
  }

  if (provider === "googledocs") {
    const importable = /\/document\/d\/[^/]+/i.test(url.pathname);
    return importable
      ? { provider, importable: true, resourceType: "document", resourceLabel: "Google Docs 文档", message: "链接格式有效，可以检查授权并读取文档。" }
      : { provider, importable: false, resourceType: "unsupported", resourceLabel: "Google Drive 链接", message: "当前只支持 Google Docs 文档链接，请打开具体文档后重新复制地址。" };
  }

  if (provider === "youmind") {
    if (/\/boards?\//i.test(url.pathname)) {
      const boardId = url.pathname.match(/\/boards?\/([^/?#]+)/i)?.[1];
      return {
        provider,
        importable: false,
        resourceType: "container",
        resourceId: boardId,
        resourceLabel: "YouMind Board",
        message: "这是 YouMind Board 链接，可以进入工作区后选择具体文章。"
      };
    }
    const importable = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(`${url.pathname}${url.search}`);
    return importable
      ? { provider, importable: true, resourceType: "document", resourceLabel: "YouMind 文档", message: "链接格式有效，可以检查授权并读取文档。" }
      : { provider, importable: false, resourceType: "unsupported", resourceLabel: "YouMind 链接", message: "没有识别到具体文档 ID，请从文章、Craft 或 Board 页面复制链接。" };
  }

  if (provider === "notion") {
    const compactPath = url.pathname.replace(/-/g, "");
    const importable = /[0-9a-f]{32}/i.test(compactPath);
    return importable
      ? { provider, importable: true, resourceType: "document", resourceLabel: "Notion 页面", message: "链接格式有效，可以检查授权并读取页面。" }
      : { provider, importable: false, resourceType: "unsupported", resourceLabel: "Notion 链接", message: "没有识别到 Notion 页面 ID，请打开具体页面后重新复制链接。" };
  }

  const importable = /\/(docx|docs|wiki)\//i.test(url.pathname);
  return importable
    ? { provider, importable: true, resourceType: "document", resourceLabel: "飞书文档", message: "链接格式有效，可以检查授权并读取文档。" }
    : { provider, importable: false, resourceType: "unsupported", resourceLabel: "飞书链接", message: "当前只支持飞书文档或 Wiki 页面链接。" };
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}
