import { canonicalDocumentToDraftDoc, paragraph } from "./canonical.ts";
import { ConnectorError, errorCodeForStatus, readErrorBody } from "./errors.ts";
import { googleDocsMarkdownAdapter } from "./google-docs-markdown-adapter.ts";
import { parseMarkdownToCanonical } from "./markdown.ts";
import type {
  CanonicalDocument,
  CanonicalMark,
  CanonicalNode,
  ConnectorDocumentPage,
  ConnectorToken,
  ContentConnector,
  ContentImportResult,
  ExternalAsset,
  ExternalDocumentRef,
  FetchLike,
  ImportWarning,
  ListDocumentsInput
} from "./types.ts";

const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_MARKDOWN_MIME_TYPE = "text/markdown";
const GOOGLE_PUBLIC_MARKDOWN_MIME_TYPE = "text/x-markdown";
const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export type GoogleDocsConnectorConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  accountsBaseUrl?: string;
  tokenUrl?: string;
  docsApiBaseUrl?: string;
  driveApiBaseUrl?: string;
  publicDocsBaseUrl?: string;
  fetch?: FetchLike;
};

type JsonRecord = Record<string, unknown>;

type GoogleDriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  version?: string;
  webViewLink?: string;
};

type GoogleTextStyle = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  link?: { url?: string; bookmarkId?: string; tabId?: string };
  weightedFontFamily?: { fontFamily?: string };
};

type GoogleParagraphElement = {
  textRun?: { content?: string; textStyle?: GoogleTextStyle };
  inlineObjectElement?: { inlineObjectId?: string };
  horizontalRule?: JsonRecord;
  equation?: JsonRecord;
  footnoteReference?: { footnoteId?: string };
  person?: { personProperties?: { name?: string; email?: string } };
  richLink?: { richLinkProperties?: { title?: string; uri?: string } };
  pageBreak?: JsonRecord;
  columnBreak?: JsonRecord;
};

type GoogleParagraph = {
  paragraphStyle?: { namedStyleType?: string; alignment?: string };
  bullet?: { listId?: string; nestingLevel?: number };
  elements?: GoogleParagraphElement[];
};

type GoogleStructuralElement = {
  paragraph?: GoogleParagraph;
  table?: GoogleTable;
  tableOfContents?: { content?: GoogleStructuralElement[] };
  sectionBreak?: JsonRecord;
};

type GoogleTable = {
  tableRows?: Array<{
    tableCells?: Array<{ content?: GoogleStructuralElement[] }>;
  }>;
};

type GoogleInlineObject = {
  inlineObjectProperties?: {
    embeddedObject?: {
      title?: string;
      description?: string;
      imageProperties?: { contentUri?: string; sourceUri?: string };
      size?: {
        width?: { magnitude?: number; unit?: string };
        height?: { magnitude?: number; unit?: string };
      };
    };
  };
};

type GoogleList = {
  listProperties?: {
    nestingLevels?: Array<{ glyphType?: string; glyphSymbol?: string }>;
  };
};

type GoogleDocumentTab = {
  body?: { content?: GoogleStructuralElement[] };
  inlineObjects?: Record<string, GoogleInlineObject>;
  lists?: Record<string, GoogleList>;
  footnotes?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  footers?: Record<string, unknown>;
};

type GoogleTab = {
  tabProperties?: { tabId?: string; title?: string };
  documentTab?: GoogleDocumentTab;
  childTabs?: GoogleTab[];
};

export type GoogleDocsApiDocument = {
  documentId?: string;
  title?: string;
  revisionId?: string;
  body?: { content?: GoogleStructuralElement[] };
  inlineObjects?: Record<string, GoogleInlineObject>;
  lists?: Record<string, GoogleList>;
  tabs?: GoogleTab[];
  footnotes?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  footers?: Record<string, unknown>;
};

export class GoogleDocsConnector implements ContentConnector {
  readonly provider = "googledocs" as const;
  private readonly config: GoogleDocsConnectorConfig;
  private readonly fetchImpl: FetchLike;
  private readonly accountsBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly docsApiBaseUrl: string;
  private readonly driveApiBaseUrl: string;
  private readonly publicDocsBaseUrl: string;

  constructor(config: GoogleDocsConnectorConfig) {
    this.config = config;
    this.fetchImpl = config.fetch ?? fetch;
    this.accountsBaseUrl = (config.accountsBaseUrl ?? "https://accounts.google.com").replace(/\/$/, "");
    this.tokenUrl = config.tokenUrl ?? "https://oauth2.googleapis.com/token";
    this.docsApiBaseUrl = (config.docsApiBaseUrl ?? "https://docs.googleapis.com/v1").replace(/\/$/, "");
    this.driveApiBaseUrl = (config.driveApiBaseUrl ?? "https://www.googleapis.com/drive/v3").replace(/\/$/, "");
    this.publicDocsBaseUrl = (config.publicDocsBaseUrl ?? "https://docs.google.com").replace(/\/$/, "");
  }

  getAuthorizationUrl(state: string): string {
    if (!this.config.redirectUri) {
      throw new ConnectorError({
        provider: "googledocs",
        code: "authorization_failed",
        message: "Google OAuth authorization code flow 缺少 redirectUri。"
      });
    }
    const url = new URL(`${this.accountsBaseUrl}/o/oauth2/v2/auth`);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", (this.config.scopes ?? DEFAULT_SCOPES).join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorization(code: string): Promise<ConnectorToken> {
    const clientSecret = this.requireClientSecret();
    const redirectUri = this.config.redirectUri;
    if (!redirectUri) {
      throw new ConnectorError({
        provider: "googledocs",
        code: "authorization_failed",
        message: "Google OAuth authorization code flow 缺少 redirectUri。"
      });
    }
    const response = await this.tokenRequest({
      code,
      client_id: this.config.clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });
    return googleTokenFromResponse(response);
  }

  async refreshAuthorization(token: ConnectorToken): Promise<ConnectorToken> {
    if (!token.refreshToken) {
      throw new ConnectorError({
        provider: "googledocs",
        code: "token_refresh_failed",
        message: "Google Docs 连接缺少 refresh token，需要用户重新授权。"
      });
    }
    const response = await this.tokenRequest({
      client_id: this.config.clientId,
      client_secret: this.requireClientSecret(),
      refresh_token: token.refreshToken,
      grant_type: "refresh_token"
    });
    return {
      ...googleTokenFromResponse(response),
      refreshToken: readString(response, "refresh_token") ?? token.refreshToken,
      accountId: token.accountId,
      accountName: token.accountName,
      metadata: token.metadata
    };
  }

  resolveDocument(urlOrId: string): ExternalDocumentRef {
    const value = urlOrId.trim();
    const id = parseGoogleDocId(value);
    if (!id) {
      throw new ConnectorError({
        provider: "googledocs",
        code: "invalid_source",
        message: "无法从输入中识别 Google Docs 文档链接或 ID。"
      });
    }
    return {
      provider: "googledocs",
      id,
      kind: "document",
      url: isGoogleDocsUrl(value) ? value : undefined
    };
  }

  async listDocuments(
    token: ConnectorToken,
    input: ListDocumentsInput = {}
  ): Promise<ConnectorDocumentPage> {
    const url = new URL(`${this.driveApiBaseUrl}/files`);
    const filters = [`mimeType = '${GOOGLE_DOC_MIME_TYPE}'`, "trashed = false"];
    if (input.query?.trim()) filters.push(`name contains '${escapeDriveQuery(input.query.trim())}'`);
    url.searchParams.set("q", filters.join(" and "));
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("pageSize", String(clampPageSize(input.pageSize)));
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,version,webViewLink)");
    url.searchParams.set("spaces", "drive");
    if (input.cursor) url.searchParams.set("pageToken", input.cursor);

    const response = await this.apiRequest<{ files?: GoogleDriveFile[]; nextPageToken?: string }>(
      token,
      url.toString()
    );
    return {
      items: (response.files ?? []).flatMap((file) => {
        if (!file.id) return [];
        return [{
          provider: "googledocs" as const,
          id: file.id,
          kind: "document",
          url: file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`,
          title: file.name || "Untitled Google Doc",
          lastEditedAt: file.modifiedTime
        }];
      }),
      nextCursor: response.nextPageToken
    };
  }

  async fetchDocument(token: ConnectorToken, ref: ExternalDocumentRef): Promise<CanonicalDocument> {
    if (ref.provider !== "googledocs") {
      throw new ConnectorError({
        provider: "googledocs",
        code: "invalid_source",
        message: "文档引用不属于 Google Docs。"
      });
    }
    const metadataUrl = new URL(`${this.driveApiBaseUrl}/files/${encodeURIComponent(ref.id)}`);
    metadataUrl.searchParams.set("fields", "id,name,mimeType,modifiedTime,version,webViewLink");
    const metadata = await this.apiRequest<GoogleDriveFile>(token, metadataUrl.toString());
    if (metadata.mimeType && metadata.mimeType !== GOOGLE_DOC_MIME_TYPE) {
      throw new ConnectorError({
        provider: "googledocs",
        code: "unsupported_resource",
        message: "所选 Drive 文件不是 Google Docs 文档。"
      });
    }

    const exportUrl = new URL(`${this.driveApiBaseUrl}/files/${encodeURIComponent(ref.id)}/export`);
    exportUrl.searchParams.set("mimeType", GOOGLE_MARKDOWN_MIME_TYPE);
    try {
      const markdown = await this.apiTextRequest(token, exportUrl.toString(), GOOGLE_MARKDOWN_MIME_TYPE);
      return normalizeGoogleMarkdownDocument(ref, markdown, metadata);
    } catch (error) {
      if (!shouldFallbackToDocsApi(error)) throw error;
      const documentUrl = new URL(`${this.docsApiBaseUrl}/documents/${encodeURIComponent(ref.id)}`);
      documentUrl.searchParams.set("includeTabsContent", "true");
      const document = await this.apiRequest<GoogleDocsApiDocument>(token, documentUrl.toString());
      const fallback = normalizeGoogleDocument(ref, document, metadata);
      fallback.warnings.unshift({
        code: "format_downgraded",
        message: "Google Drive Markdown 导出暂不可用，已回退到 Docs API 结构化导入。"
      });
      return fallback;
    }
  }

  async importDocument(token: ConnectorToken, urlOrId: string): Promise<ContentImportResult> {
    return canonicalDocumentToDraftDoc(
      await this.fetchDocument(token, this.resolveDocument(urlOrId))
    );
  }

  async fetchPublicDocument(ref: ExternalDocumentRef): Promise<CanonicalDocument> {
    if (ref.provider !== "googledocs") {
      throw new ConnectorError({
        provider: "googledocs",
        code: "invalid_source",
        message: "文档引用不属于 Google Docs。"
      });
    }

    const exportUrl = this.publicExportUrl(ref, "md");
    const response = await this.fetchImpl(exportUrl.toString(), {
      headers: { Accept: `${GOOGLE_MARKDOWN_MIME_TYPE},${GOOGLE_PUBLIC_MARKDOWN_MIME_TYPE}` }
    });
    if (!response.ok) {
      const code = errorCodeForStatus(response.status);
      throw new ConnectorError({
        provider: "googledocs",
        code,
        message: "这篇 Google Docs 无法公开读取，需要通过 Google Picker 授权。",
        status: response.status,
        retryable: code === "rate_limited" || response.status >= 500,
        details: await readErrorBody(response)
      });
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes(GOOGLE_MARKDOWN_MIME_TYPE)
      && !contentType.includes(GOOGLE_PUBLIC_MARKDOWN_MIME_TYPE)
    ) {
      throw new ConnectorError({
        provider: "googledocs",
        code: "access_denied",
        message: "这篇 Google Docs 没有开放匿名导出，需要通过 Google Picker 授权。",
        status: 403,
        details: { contentType }
      });
    }

    const title = publicGoogleDocsTitle(response.headers.get("content-disposition"));
    const document = normalizeGoogleMarkdownDocument(ref, await response.text(), {
      id: ref.id,
      name: title,
      mimeType: GOOGLE_DOC_MIME_TYPE,
      webViewLink: ref.url ?? `https://docs.google.com/document/d/${ref.id}/edit`
    });
    try {
      const htmlResponse = await this.fetchImpl(this.publicExportUrl(ref, "html").toString(), {
        headers: { Accept: "text/html" }
      });
      const contentType = htmlResponse.headers.get("content-type")?.toLowerCase() ?? "";
      if (htmlResponse.ok && contentType.includes("text/html")) {
        applyGoogleHtmlParagraphAlignments(document.content, await htmlResponse.text());
      } else {
        document.warnings.push({
          code: "format_downgraded",
          message: "Google Docs 的 HTML 样式导出不可用，段落对齐方式可能未保留。"
        });
      }
    } catch {
      document.warnings.push({
        code: "format_downgraded",
        message: "Google Docs 的 HTML 样式导出失败，段落对齐方式可能未保留。"
      });
    }
    return document;
  }

  async importPublicDocument(urlOrId: string): Promise<ContentImportResult> {
    return canonicalDocumentToDraftDoc(
      await this.fetchPublicDocument(this.resolveDocument(urlOrId))
    );
  }

  private publicExportUrl(ref: ExternalDocumentRef, format: "md" | "html"): URL {
    const url = new URL(
      `${this.publicDocsBaseUrl}/document/d/${encodeURIComponent(ref.id)}/export`
    );
    url.searchParams.set("format", format);
    return url;
  }

  private async tokenRequest(body: Record<string, string>): Promise<JsonRecord> {
    const response = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString()
    });
    if (!response.ok) {
      throw new ConnectorError({
        provider: "googledocs",
        code: body.grant_type === "refresh_token" ? "token_refresh_failed" : "authorization_failed",
        message: "Google OAuth Token 请求失败。",
        status: response.status,
        details: await readErrorBody(response)
      });
    }
    return response.json() as Promise<JsonRecord>;
  }

  private requireClientSecret(): string {
    if (!this.config.clientSecret) {
      throw new ConnectorError({
        provider: "googledocs",
        code: "authorization_failed",
        message: "Google OAuth authorization code flow 缺少 clientSecret。"
      });
    }
    return this.config.clientSecret;
  }

  private async apiRequest<T>(token: ConnectorToken, url: string): Promise<T> {
    const response = await this.apiResponse(token, url, "application/json");
    return response.json() as Promise<T>;
  }

  private async apiTextRequest(token: ConnectorToken, url: string, accept: string): Promise<string> {
    const response = await this.apiResponse(token, url, accept);
    return response.text();
  }

  private async apiResponse(token: ConnectorToken, url: string, accept: string): Promise<Response> {
    const response = await this.fetchImpl(url, {
      headers: { Accept: accept, Authorization: `Bearer ${token.accessToken}` }
    });
    if (!response.ok) {
      const code = errorCodeForStatus(response.status);
      throw new ConnectorError({
        provider: "googledocs",
        code,
        message: `Google Workspace API 请求失败：${new URL(url).pathname}`,
        status: response.status,
        retryable: code === "rate_limited" || response.status >= 500,
        details: await readErrorBody(response)
      });
    }
    return response;
  }
}

export function createGoogleDocsConnector(config: GoogleDocsConnectorConfig): GoogleDocsConnector {
  return new GoogleDocsConnector(config);
}

export function parseGoogleDocId(input: string): string | undefined {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (!/(^|\.)docs\.google\.com$/.test(url.hostname)) return undefined;
    const match = url.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function publicGoogleDocsTitle(contentDisposition: string | null): string {
  if (!contentDisposition) return "Untitled Google Doc";
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = contentDisposition.match(/filename="([^"]+)"/i)?.[1];
  let filename = plain;
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      filename = plain;
    }
  }
  const title = filename?.replace(/\.md$/i, "").trim();
  return title || "Untitled Google Doc";
}

type ParagraphAlignment = "left" | "center" | "right" | "justify";

type HtmlParagraphAlignment = {
  text: string;
  textAlign: ParagraphAlignment;
};

export function applyGoogleHtmlParagraphAlignments(
  content: CanonicalNode[],
  html: string
): void {
  const htmlParagraphs = extractGoogleHtmlParagraphAlignments(html);
  let htmlCursor = 0;

  const visit = (node: CanonicalNode) => {
    if (node.type === "paragraph" || node.type === "heading") {
      const lines = canonicalAlignmentLines(node);
      if (!lines.length) return;
      const matches: HtmlParagraphAlignment[] = [];
      let nextCursor = htmlCursor;
      for (const line of lines) {
        const matchIndex = htmlParagraphs.findIndex(
          (paragraph, index) => index >= nextCursor && paragraph.text === line
        );
        if (matchIndex < 0) return;
        matches.push(htmlParagraphs[matchIndex]);
        nextCursor = matchIndex + 1;
      }
      htmlCursor = nextCursor;
      const textAlign = matches[0]?.textAlign;
      if (textAlign && matches.every((match) => match.textAlign === textAlign)) {
        node.attrs = { ...node.attrs, textAlign };
      }
      return;
    }
    node.content?.forEach(visit);
  };

  content.forEach(visit);
}

function extractGoogleHtmlParagraphAlignments(html: string): HtmlParagraphAlignment[] {
  const classAlignments = new Map<string, ParagraphAlignment>();
  const classRule = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;
  for (const match of html.matchAll(classRule)) {
    const textAlign = cssTextAlignment(match[2]);
    if (textAlign) classAlignments.set(match[1], textAlign);
  }

  const paragraphs: HtmlParagraphAlignment[] = [];
  const block = /<(p|h[1-6]|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(block)) {
    const attributes = match[2];
    const lines = decodeHtmlText(match[3]).split("\n").map(normalizeAlignmentText).filter(Boolean);
    if (!lines.length) continue;
    const inlineAlignment = cssTextAlignment(
      attributes.match(/\bstyle=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean)
    );
    const classes = attributes
      .match(/\bclass=(?:"([^"]*)"|'([^']*)')/i)
      ?.slice(1)
      .find(Boolean)
      ?.split(/\s+/)
      .filter(Boolean) ?? [];
    const classAlignment = classes.reduce<ParagraphAlignment | undefined>(
      (alignment, className) => classAlignments.get(className) ?? alignment,
      undefined
    );
    const textAlign = inlineAlignment ?? classAlignment ?? "left";
    paragraphs.push(...lines.map((text) => ({ text, textAlign })));
  }
  return paragraphs;
}

function canonicalAlignmentLines(node: CanonicalNode): string[] {
  const text = (node.content ?? []).map(canonicalAlignmentText).join("");
  return text.split("\n").map(normalizeAlignmentText).filter(Boolean);
}

function canonicalAlignmentText(node: CanonicalNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return node.content?.map(canonicalAlignmentText).join("") ?? "";
}

function cssTextAlignment(css: string | undefined): ParagraphAlignment | undefined {
  const value = css?.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify|start|end)\b/i)?.[1];
  if (!value) return undefined;
  if (/^start$/i.test(value)) return "left";
  if (/^end$/i.test(value)) return "right";
  return value.toLowerCase() as ParagraphAlignment;
}

function decodeHtmlText(value: string): string {
  const withoutTags = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return withoutTags.replace(/&(#x?[0-9a-f]+|nbsp|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === "nbsp") return " ";
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    const radix = normalized.startsWith("#x") ? 16 : 10;
    const codePoint = Number.parseInt(normalized.replace(/^#x?/, ""), radix);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
  });
}

function normalizeAlignmentText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeGoogleMarkdownDocument(
  ref: ExternalDocumentRef,
  markdown: string,
  metadata: GoogleDriveFile = {}
): CanonicalDocument {
  const parsed = parseMarkdownToCanonical(
    markdown.replace(/^\uFEFF/, ""),
    "googledocs",
    googleDocsMarkdownAdapter
  );
  return {
    ref: {
      ...ref,
      url: metadata.webViewLink ?? ref.url ?? `https://docs.google.com/document/d/${ref.id}/edit`
    },
    title: metadata.name || "Untitled Google Doc",
    revision: metadata.version,
    lastEditedAt: metadata.modifiedTime,
    content: parsed.content.length ? parsed.content : [paragraph("")],
    assets: parsed.assets,
    warnings: [
      ...parsed.warnings,
      ...(!markdown.trim()
        ? [{
            code: "partial_document" as const,
            message: "Google Docs 的 Markdown 导出内容为空。"
          }]
        : [])
    ]
  };
}

function shouldFallbackToDocsApi(error: unknown): boolean {
  return error instanceof ConnectorError
    && error.code !== "access_denied"
    && error.code !== "not_found"
    && error.code !== "rate_limited";
}

export function normalizeGoogleDocument(
  ref: ExternalDocumentRef,
  document: GoogleDocsApiDocument,
  metadata: GoogleDriveFile = {}
): CanonicalDocument {
  const assets: ExternalAsset[] = [];
  const warnings: ImportWarning[] = [];
  const tabs = flattenTabs(document.tabs ?? []);
  let content: CanonicalNode[];

  if (tabs.length) {
    content = tabs.flatMap((tab, index) => {
      const context = conversionContext(tab.documentTab, assets, warnings);
      const tabContent = convertStructuralElements(tab.documentTab?.body?.content ?? [], context);
      if (tabs.length === 1) return tabContent;
      return [
        { type: "heading", attrs: { level: tab.depth === 0 ? 2 : 3 }, content: textInline(tab.title || `Tab ${index + 1}`) },
        ...tabContent
      ];
    });
    if (tabs.length > 1) {
      warnings.push({
        code: "format_downgraded",
        message: `Google Docs 的 ${tabs.length} 个 Tab 已按顺序合并，并用标题标记边界。`
      });
    }
  } else {
    const rootTab: GoogleDocumentTab = {
      body: document.body,
      inlineObjects: document.inlineObjects,
      lists: document.lists,
      footnotes: document.footnotes,
      headers: document.headers,
      footers: document.footers
    };
    content = convertStructuralElements(document.body?.content ?? [], conversionContext(rootTab, assets, warnings));
  }

  return {
    ref: {
      provider: "googledocs",
      id: document.documentId || metadata.id || ref.id,
      kind: "document",
      url: metadata.webViewLink ?? ref.url ?? `https://docs.google.com/document/d/${ref.id}/edit`
    },
    title: document.title || metadata.name || "Untitled Google Doc",
    revision: document.revisionId || metadata.version,
    lastEditedAt: metadata.modifiedTime,
    content: content.length ? content : [paragraph("")],
    assets,
    warnings
  };
}

type ConversionContext = {
  inlineObjects: Record<string, GoogleInlineObject>;
  lists: Record<string, GoogleList>;
  assets: ExternalAsset[];
  warnings: ImportWarning[];
};

function conversionContext(
  tab: GoogleDocumentTab | undefined,
  assets: ExternalAsset[],
  warnings: ImportWarning[]
): ConversionContext {
  if ((tab?.footnotes && Object.keys(tab.footnotes).length) ||
      (tab?.headers && Object.keys(tab.headers).length) ||
      (tab?.footers && Object.keys(tab.footers).length)) {
    warnings.push({
      code: "partial_document",
      message: "Google Docs 的页眉、页脚或脚注未并入正文。"
    });
  }
  return {
    inlineObjects: tab?.inlineObjects ?? {},
    lists: tab?.lists ?? {},
    assets,
    warnings
  };
}

function convertStructuralElements(
  elements: GoogleStructuralElement[],
  context: ConversionContext
): CanonicalNode[] {
  const result: CanonicalNode[] = [];
  let index = 0;
  while (index < elements.length) {
    const element = elements[index];
    const bullet = element.paragraph?.bullet;
    if (element.paragraph && bullet?.listId) {
      const ordered = googleListIsOrdered(context.lists[bullet.listId], bullet.nestingLevel ?? 0);
      const items: CanonicalNode[] = [];
      while (index < elements.length) {
        const candidate = elements[index].paragraph;
        if (!candidate?.bullet?.listId || candidate.bullet.listId !== bullet.listId) break;
        const candidateOrdered = googleListIsOrdered(
          context.lists[candidate.bullet.listId],
          candidate.bullet.nestingLevel ?? 0
        );
        if (candidateOrdered !== ordered) break;
        const textAlign = googleParagraphAlignment(candidate.paragraphStyle?.alignment);
        items.push({
          type: "listItem",
          content: [{
            type: "paragraph",
            ...(textAlign ? { attrs: { textAlign } } : {}),
            content: inlineParagraphContent(candidate, context)
          }]
        });
        index += 1;
      }
      result.push({ type: ordered ? "orderedList" : "bulletList", content: items });
      continue;
    }
    result.push(...convertStructuralElement(element, context));
    index += 1;
  }
  return result;
}

function convertStructuralElement(
  element: GoogleStructuralElement,
  context: ConversionContext
): CanonicalNode[] {
  if (element.paragraph) return convertParagraph(element.paragraph, context);
  if (element.table) return [convertTable(element.table, context)];
  if (element.tableOfContents) {
    return [{
      type: "blockquote",
      content: convertStructuralElements(element.tableOfContents.content ?? [], context)
    }];
  }
  if (element.sectionBreak) return [];
  context.warnings.push({ code: "unsupported_block", message: "Google Docs 中存在未识别的结构元素。" });
  return [];
}

function convertParagraph(paragraphValue: GoogleParagraph, context: ConversionContext): CanonicalNode[] {
  const elements = paragraphValue.elements ?? [];
  if (elements.some((element) => element.horizontalRule)) return [{ type: "horizontalRule" }];
  const inline = paragraphInlineContent(paragraphValue, context);
  const style = paragraphValue.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
  const textAlign = googleParagraphAlignment(paragraphValue.paragraphStyle?.alignment);
  const heading = style.match(/^HEADING_([1-6])$/);
  const blockType = heading || style === "TITLE" || style === "SUBTITLE" ? "heading" : "paragraph";
  const level = heading ? Number(heading[1]) : style === "TITLE" ? 1 : style === "SUBTITLE" ? 2 : undefined;
  const result: CanonicalNode[] = [];
  let currentInline: CanonicalNode[] = [];
  const flush = () => {
    if (!currentInline.length && result.length) return;
    result.push({
      type: blockType,
      ...(level || textAlign ? { attrs: { ...(level ? { level } : {}), ...(textAlign ? { textAlign } : {}) } } : {}),
      content: currentInline
    });
    currentInline = [];
  };
  for (const node of inline) {
    if (node.type !== "image") {
      currentInline.push(node);
      continue;
    }
    if (currentInline.length) flush();
    result.push(node);
  }
  if (currentInline.length || result.length === 0) flush();
  return result;
}

function googleParagraphAlignment(value: string | undefined): ParagraphAlignment | undefined {
  if (!value) return undefined;
  if (value === "CENTER") return "center";
  if (value === "END" || value === "RIGHT") return "right";
  if (value === "JUSTIFIED" || value === "JUSTIFY") return "justify";
  if (value === "START" || value === "LEFT") return "left";
  return undefined;
}

function paragraphInlineContent(
  paragraphValue: GoogleParagraph,
  context: ConversionContext
): CanonicalNode[] {
  const nodes = (paragraphValue.elements ?? []).flatMap((element) => convertParagraphElement(element, context));
  const last = nodes.at(-1);
  if (last?.type === "hardBreak") {
    nodes.pop();
  } else if (last?.type === "text" && last.text?.endsWith("\n")) {
    last.text = last.text.slice(0, -1);
    if (!last.text) nodes.pop();
  }
  return nodes;
}

function inlineParagraphContent(
  paragraphValue: GoogleParagraph,
  context: ConversionContext
): CanonicalNode[] {
  return paragraphInlineContent(paragraphValue, context).map((node) => {
    if (node.type !== "image") return node;
    const href = typeof node.attrs?.src === "string" ? node.attrs.src : undefined;
    return {
      type: "text",
      text: `[Image: ${String(node.attrs?.alt || "Google Docs image")}]`,
      marks: href ? [{ type: "link", attrs: { href } }] : []
    };
  });
}

function convertParagraphElement(
  element: GoogleParagraphElement,
  context: ConversionContext
): CanonicalNode[] {
  if (element.textRun) return styledTextNodes(element.textRun.content ?? "", element.textRun.textStyle);
  if (element.inlineObjectElement?.inlineObjectId) {
    return convertInlineObject(element.inlineObjectElement.inlineObjectId, context);
  }
  if (element.equation) {
    context.warnings.push({ code: "unsupported_block", message: "Google Docs 公式已转换为文本占位。" });
    return textInline("[Equation]");
  }
  if (element.footnoteReference) return textInline("[Footnote]");
  if (element.person?.personProperties) {
    const person = element.person.personProperties;
    return textInline(`@${person.name || person.email || "person"}`);
  }
  if (element.richLink?.richLinkProperties) {
    const richLink = element.richLink.richLinkProperties;
    return [{
      type: "text",
      text: richLink.title || richLink.uri || "Rich link",
      marks: richLink.uri ? [{ type: "link", attrs: { href: richLink.uri } }] : []
    }];
  }
  if (element.pageBreak) return textInline("\n");
  if (element.columnBreak) return textInline(" ");
  return [];
}

function convertInlineObject(id: string, context: ConversionContext): CanonicalNode[] {
  const embedded = context.inlineObjects[id]?.inlineObjectProperties?.embeddedObject;
  const image = embedded?.imageProperties;
  if (!image?.contentUri) {
    context.warnings.push({
      code: "unsupported_block",
      message: "Google Docs 内嵌对象不是可下载图片，已保留占位。",
      sourceId: id
    });
    return textInline(`[Embedded object: ${embedded?.title || id}]`);
  }
  const assetId = `googledocs:image:${id}`;
  context.assets.push({
    id: assetId,
    provider: "googledocs",
    kind: "image",
    providerToken: id,
    sourceUrl: image.contentUri,
    filename: embedded?.title
  });
  return [{
    type: "image",
    attrs: {
      src: `tutti-import://${encodeURIComponent(assetId)}`,
      alt: embedded?.description || embedded?.title,
      width: embedded?.size?.width?.magnitude,
      height: embedded?.size?.height?.magnitude
    }
  }];
}

function convertTable(table: GoogleTable, context: ConversionContext): CanonicalNode {
  return {
    type: "table",
    content: (table.tableRows ?? []).map((row, rowIndex) => ({
      type: "tableRow",
      content: (row.tableCells ?? []).map((cell) => ({
        type: rowIndex === 0 ? "tableHeader" : "tableCell",
        content: convertStructuralElements(cell.content ?? [], context)
      }))
    }))
  };
}

function styledTextNodes(value: string, style: GoogleTextStyle | undefined): CanonicalNode[] {
  if (!value) return [];
  const marks: CanonicalMark[] = [];
  if (style?.bold) marks.push({ type: "bold" });
  if (style?.italic) marks.push({ type: "italic" });
  if (style?.strikethrough) marks.push({ type: "strike" });
  if (/mono|courier|consolas|code/i.test(style?.weightedFontFamily?.fontFamily ?? "")) {
    marks.push({ type: "code" });
  }
  if (style?.link?.url) marks.push({ type: "link", attrs: { href: style.link.url } });
  return value.split(/(\n)/).flatMap((part): CanonicalNode[] => {
    if (!part) return [];
    if (part === "\n") return [{ type: "hardBreak" }];
    return [{ type: "text", text: part, marks }];
  });
}

function textInline(value: string): CanonicalNode[] {
  return value ? [{ type: "text", text: value }] : [];
}

function googleListIsOrdered(list: GoogleList | undefined, nestingLevel: number): boolean {
  const level = list?.listProperties?.nestingLevels?.[nestingLevel];
  if (level?.glyphSymbol) return false;
  const type = level?.glyphType ?? "";
  return /DECIMAL|ALPHA|ROMAN/.test(type);
}

function flattenTabs(tabs: GoogleTab[], depth = 0): Array<GoogleTab & { depth: number; title?: string }> {
  return tabs.flatMap((tab) => [
    { ...tab, depth, title: tab.tabProperties?.title },
    ...flattenTabs(tab.childTabs ?? [], depth + 1)
  ]);
}

function googleTokenFromResponse(response: JsonRecord): ConnectorToken {
  const accessToken = readString(response, "access_token");
  if (!accessToken) {
    throw new ConnectorError({
      provider: "googledocs",
      code: "invalid_provider_response",
      message: "Google OAuth 响应缺少 access_token。",
      details: response
    });
  }
  const expiresIn = typeof response.expires_in === "number" ? response.expires_in : Number(response.expires_in);
  return {
    accessToken,
    refreshToken: readString(response, "refresh_token"),
    tokenType: "bearer",
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    metadata: { scope: readString(response, "scope") }
  };
}

function readString(record: JsonRecord, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] as string : undefined;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function clampPageSize(value: number | undefined): number {
  return Math.max(1, Math.min(100, Math.floor(value ?? 50)));
}

function isGoogleDocsUrl(value: string): boolean {
  try {
    return /(^|\.)docs\.google\.com$/.test(new URL(value).hostname);
  } catch {
    return false;
  }
}
