import { canonicalDocumentToDraftDoc, paragraph } from "./canonical.ts";
import { ConnectorError, errorCodeForStatus, readErrorBody } from "./errors.ts";
import type {
  CanonicalDocument,
  CanonicalMark,
  CanonicalNode,
  ConnectorToken,
  ContentConnector,
  ContentImportResult,
  ExternalAsset,
  ExternalDocumentRef,
  FetchLike,
  ImportWarning
} from "./types.ts";

export type FeishuConnectorConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  apiBaseUrl?: string;
  accountsBaseUrl?: string;
  fetch?: FetchLike;
};

type FeishuApiEnvelope<T> = {
  code?: number;
  msg?: string;
  data?: T;
};

type FeishuDocument = {
  document_id: string;
  revision_id: number;
  title: string;
};

type FeishuBlock = {
  block_id: string;
  block_type: number;
  parent_id?: string;
  children?: string[];
  page?: FeishuText;
  text?: FeishuText;
  heading1?: FeishuText;
  heading2?: FeishuText;
  heading3?: FeishuText;
  heading4?: FeishuText;
  heading5?: FeishuText;
  heading6?: FeishuText;
  heading7?: FeishuText;
  heading8?: FeishuText;
  heading9?: FeishuText;
  bullet?: FeishuText;
  ordered?: FeishuText;
  code?: FeishuText;
  quote?: FeishuText;
  todo?: FeishuText;
  image?: { token?: string; width?: number; height?: number };
  file?: { token?: string; name?: string };
  table?: { cells?: string[]; property?: { row_size?: number; column_size?: number } };
};

type FeishuText = {
  style?: { language?: number; done?: boolean };
  elements?: FeishuTextElement[];
};

type FeishuTextElement = {
  text_run?: { content?: string; text_element_style?: FeishuTextElementStyle };
  mention_user?: { user_id?: string; text_element_style?: FeishuTextElementStyle };
  mention_doc?: {
    token?: string;
    url?: string;
    title?: string;
    text_element_style?: FeishuTextElementStyle;
  };
  equation?: { content?: string; text_element_style?: FeishuTextElementStyle };
  reminder?: { text?: string; text_element_style?: FeishuTextElementStyle };
};

type FeishuTextElementStyle = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  inline_code?: boolean;
  link?: { url?: string };
};

export class FeishuConnector implements ContentConnector {
  readonly provider = "feishu" as const;
  private readonly config: FeishuConnectorConfig;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly accountsBaseUrl: string;

  constructor(config: FeishuConnectorConfig) {
    this.config = config;
    this.fetchImpl = config.fetch ?? fetch;
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://open.feishu.cn").replace(/\/$/, "");
    this.accountsBaseUrl = (config.accountsBaseUrl ?? "https://accounts.feishu.cn").replace(/\/$/, "");
  }

  getAuthorizationUrl(state: string): string {
    const url = new URL(`${this.accountsBaseUrl}/open-apis/authen/v1/authorize`);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", state);
    const scopes = new Set(
      this.config.scopes ?? [
        "docx:document:readonly",
        "wiki:wiki:readonly",
        "search:docs:read",
        "docs:document.media:download"
      ]
    );
    scopes.add("offline_access");
    url.searchParams.set("scope", [...scopes].join(" "));
    return url.toString();
  }

  async exchangeAuthorization(code: string): Promise<ConnectorToken> {
    const response = await this.oauthTokenRequest({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri
    });
    return feishuTokenFromResponse(response);
  }

  async refreshAuthorization(token: ConnectorToken): Promise<ConnectorToken> {
    if (!token.refreshToken) {
      throw new ConnectorError({
        provider: "feishu",
        code: "token_refresh_failed",
        message: "飞书连接缺少 refresh token，需要用户重新授权。"
      });
    }
    const response = await this.oauthTokenRequest({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: token.refreshToken
    });
    return feishuTokenFromResponse(response);
  }

  resolveDocument(urlOrId: string): ExternalDocumentRef {
    const trimmed = urlOrId.trim();
    if (/^[A-Za-z0-9_-]{16,}$/.test(trimmed)) {
      return { provider: "feishu", id: trimmed, kind: trimmed.startsWith("wik") ? "wiki" : "docx" };
    }

    try {
      const url = new URL(trimmed);
      if (!/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(url.hostname)) {
        throw new Error("host");
      }
      const match = url.pathname.match(/\/(docx|wiki)\/([A-Za-z0-9_-]+)/);
      if (!match) throw new Error("path");
      return {
        provider: "feishu",
        id: match[2],
        kind: match[1],
        url: trimmed
      };
    } catch {
      throw new ConnectorError({
        provider: "feishu",
        code: "invalid_source",
        message: "无法从输入中识别飞书 Docx 或 Wiki 文档。"
      });
    }
  }

  async fetchDocument(token: ConnectorToken, ref: ExternalDocumentRef): Promise<CanonicalDocument> {
    if (ref.provider !== "feishu") {
      throw new ConnectorError({
        provider: "feishu",
        code: "invalid_source",
        message: "文档引用不属于飞书。"
      });
    }
    const docRef = ref.kind === "wiki" ? await this.resolveWikiNode(token, ref) : ref;
    if (docRef.kind !== "docx") {
      throw new ConnectorError({
        provider: "feishu",
        code: "unsupported_resource",
        message: `暂不支持导入飞书资源类型：${docRef.kind}`
      });
    }

    const [document, blocks] = await Promise.all([
      this.fetchDocumentMetadata(token, docRef.id),
      this.fetchAllBlocks(token, docRef.id)
    ]);
    const normalized = normalizeFeishuBlocks(docRef, document, blocks);
    await this.populateAssetUrls(token, normalized.assets);
    normalized.assets.forEach((asset) => {
      if (!asset.sourceUrl) {
        normalized.warnings.push({
          code: "missing_asset",
          message: "飞书素材未返回临时下载地址，宿主可在权限补齐后重试。",
          sourceId: asset.providerToken
        });
      }
    });
    return normalized;
  }

  async importDocument(token: ConnectorToken, urlOrId: string): Promise<ContentImportResult> {
    return canonicalDocumentToDraftDoc(
      await this.fetchDocument(token, this.resolveDocument(urlOrId))
    );
  }

  /**
   * Reads an internet-shared document with the identity of a self-built app.
   *
   * Feishu public links are not anonymous OpenAPI resources: the Docx APIs still
   * require an access token. A tenant token is sufficient when the document's
   * sharing policy grants internet link viewers read access.
   */
  async importPublicDocument(urlOrId: string): Promise<ContentImportResult> {
    const token = await this.getTenantAccessToken();
    return this.importDocument(token, urlOrId);
  }

  private async resolveWikiNode(
    token: ConnectorToken,
    ref: ExternalDocumentRef
  ): Promise<ExternalDocumentRef> {
    const response = await this.apiRequest<{
      node: { obj_token: string; obj_type: string; title?: string; obj_edit_time?: string };
    }>(token, `/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(ref.id)}`);
    const objType = response.node.obj_type === "doc" ? "legacy_doc" : response.node.obj_type;
    return {
      provider: "feishu",
      id: response.node.obj_token,
      kind: objType,
      url: ref.url
    };
  }

  private async fetchDocumentMetadata(
    token: ConnectorToken,
    documentId: string
  ): Promise<FeishuDocument> {
    const response = await this.apiRequest<{ document: FeishuDocument }>(
      token,
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`
    );
    return response.document;
  }

  private async fetchAllBlocks(
    token: ConnectorToken,
    documentId: string
  ): Promise<FeishuBlock[]> {
    const blocks: FeishuBlock[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(
        `${this.apiBaseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`
      );
      url.searchParams.set("page_size", "500");
      url.searchParams.set("document_revision_id", "-1");
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const response = await this.apiRequestAbsolute<{
        items?: FeishuBlock[];
        has_more?: boolean;
        page_token?: string;
      }>(token, url.toString());
      blocks.push(...(response.items ?? []));
      pageToken = response.has_more ? response.page_token : undefined;
    } while (pageToken);
    return blocks;
  }

  private async populateAssetUrls(token: ConnectorToken, assets: ExternalAsset[]): Promise<void> {
    const tokenAssets = assets.filter((asset) => asset.providerToken);
    for (let index = 0; index < tokenAssets.length; index += 5) {
      const chunk = tokenAssets.slice(index, index + 5);
      const url = new URL(`${this.apiBaseUrl}/open-apis/drive/v1/medias/batch_get_tmp_download_url`);
      chunk.forEach((asset) => url.searchParams.append("file_tokens", asset.providerToken!));
      try {
        const response = await this.apiRequestAbsolute<{
          tmp_download_urls?: Array<{ file_token: string; tmp_download_url: string }>;
        }>(token, url.toString());
        const urls = new Map(
          (response.tmp_download_urls ?? []).map((item) => [item.file_token, item.tmp_download_url])
        );
        chunk.forEach((asset) => {
          asset.sourceUrl = urls.get(asset.providerToken!);
        });
      } catch (error) {
        if (error instanceof ConnectorError && error.code === "access_denied") continue;
        throw error;
      }
    }
  }

  private async oauthTokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/open-apis/authen/v2/oauth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => undefined)) as
      | (Record<string, unknown> & { code?: number; data?: Record<string, unknown> })
      | undefined;
    if (!response.ok || !payload || (typeof payload.code === "number" && payload.code !== 0)) {
      throw new ConnectorError({
        provider: "feishu",
        code: body.grant_type === "refresh_token" ? "token_refresh_failed" : "authorization_failed",
        message: "飞书 OAuth 请求失败。",
        status: response.status,
        details: payload
      });
    }
    return payload.data ?? payload;
  }

  private async getTenantAccessToken(): Promise<ConnectorToken> {
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.config.clientId,
          app_secret: this.config.clientSecret
        })
      }
    );
    const payload = (await response.json().catch(() => undefined)) as
      | { code?: number; msg?: string; tenant_access_token?: string; expire?: number }
      | undefined;
    if (
      !response.ok
      || !payload
      || (typeof payload.code === "number" && payload.code !== 0)
      || typeof payload.tenant_access_token !== "string"
    ) {
      throw new ConnectorError({
        provider: "feishu",
        code: "authorization_failed",
        message: payload?.msg || "飞书应用身份授权失败。",
        status: response.status,
        details: payload
      });
    }
    return {
      accessToken: payload.tenant_access_token,
      tokenType: "bearer",
      expiresAt: typeof payload.expire === "number"
        ? new Date(Date.now() + payload.expire * 1000).toISOString()
        : undefined,
      metadata: { appIdentity: true }
    };
  }

  private async apiRequest<T>(token: ConnectorToken, path: string): Promise<T> {
    return this.apiRequestAbsolute(token, `${this.apiBaseUrl}${path}`);
  }

  private async apiRequestAbsolute<T>(token: ConnectorToken, url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token.accessToken}`
      }
    });
    if (!response.ok) {
      const code = errorCodeForStatus(response.status);
      throw new ConnectorError({
        provider: "feishu",
        code,
        message: `飞书 API 请求失败：${new URL(url).pathname}`,
        status: response.status,
        retryable: code === "rate_limited" || response.status >= 500,
        details: await readErrorBody(response)
      });
    }
    const envelope = (await response.json()) as FeishuApiEnvelope<T>;
    if (typeof envelope.code === "number" && envelope.code !== 0) {
      const rateLimited = envelope.code === 99991400;
      throw new ConnectorError({
        provider: "feishu",
        code: rateLimited ? "rate_limited" : "provider_error",
        message: envelope.msg || "飞书 API 返回错误。",
        retryable: rateLimited,
        details: envelope
      });
    }
    if (!envelope.data) {
      throw new ConnectorError({
        provider: "feishu",
        code: "invalid_provider_response",
        message: "飞书 API 响应缺少 data。",
        details: envelope
      });
    }
    return envelope.data;
  }
}

export function createFeishuConnector(config: FeishuConnectorConfig): FeishuConnector {
  return new FeishuConnector(config);
}

export function normalizeFeishuBlocks(
  ref: ExternalDocumentRef,
  document: FeishuDocument,
  blocks: FeishuBlock[]
): CanonicalDocument {
  const blockMap = new Map(blocks.map((block) => [block.block_id, block]));
  const root = blockMap.get(document.document_id) ?? blocks.find((block) => block.block_type === 1);
  const assets: ExternalAsset[] = [];
  const warnings: ImportWarning[] = [];
  const context = { blockMap, assets, warnings };
  const rootChildren = root?.children ?? blocks.filter((block) => !block.parent_id).map((block) => block.block_id);
  const content = convertFeishuChildren(rootChildren, context);

  return {
    ref: { ...ref, id: document.document_id, kind: "docx" },
    title: document.title || "Untitled Feishu document",
    revision: String(document.revision_id),
    content,
    assets,
    warnings
  };
}

type FeishuConversionContext = {
  blockMap: Map<string, FeishuBlock>;
  assets: ExternalAsset[];
  warnings: ImportWarning[];
};

function convertFeishuChildren(
  childIds: string[],
  context: FeishuConversionContext
): CanonicalNode[] {
  const result: CanonicalNode[] = [];
  let index = 0;
  while (index < childIds.length) {
    const block = context.blockMap.get(childIds[index]);
    if (!block) {
      index += 1;
      continue;
    }
    if (block.block_type === 12 || block.block_type === 13) {
      const ordered = block.block_type === 13;
      const items: CanonicalNode[] = [];
      while (index < childIds.length) {
        const item = context.blockMap.get(childIds[index]);
        if (!item || item.block_type !== (ordered ? 13 : 12)) break;
        const text = ordered ? item.ordered : item.bullet;
        items.push({
          type: "listItem",
          content: [
            { type: "paragraph", content: feishuTextToInline(text) },
            ...convertFeishuChildren(item.children ?? [], context)
          ]
        });
        index += 1;
      }
      result.push({ type: ordered ? "orderedList" : "bulletList", content: items });
      continue;
    }

    result.push(...convertFeishuBlock(block, context));
    index += 1;
  }
  return result;
}

function convertFeishuBlock(
  block: FeishuBlock,
  context: FeishuConversionContext
): CanonicalNode[] {
  if (block.block_type === 2) {
    return [{ type: "paragraph", content: feishuTextToInline(block.text) }];
  }
  if (block.block_type >= 3 && block.block_type <= 11) {
    const level = block.block_type - 2;
    const text = block[`heading${level}` as keyof FeishuBlock] as FeishuText | undefined;
    return [{ type: "heading", attrs: { level }, content: feishuTextToInline(text) }];
  }
  if (block.block_type === 14) {
    return [
      {
        type: "codeBlock",
        attrs: block.code?.style?.language ? { language: String(block.code.style.language) } : undefined,
        content: [{ type: "text", text: feishuTextPlainText(block.code) }]
      }
    ];
  }
  if (block.block_type === 15) {
    return [
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: feishuTextToInline(block.quote) }]
      }
    ];
  }
  if (block.block_type === 17) {
    const prefix = block.todo?.style?.done ? "☑ " : "☐ ";
    return [paragraph(`${prefix}${feishuTextPlainText(block.todo)}`)];
  }
  if (block.block_type === 22) return [{ type: "horizontalRule" }];
  if (block.block_type === 23) {
    const token = block.file?.token;
    if (!token) {
      context.warnings.push({
        code: "missing_asset",
        message: "飞书文件块缺少素材 token。",
        sourceId: block.block_id
      });
      return [];
    }
    const id = `feishu:media:${token}`;
    const filename = block.file?.name || "attachment";
    context.assets.push({
      id,
      provider: "feishu",
      kind: "file",
      providerToken: token,
      filename
    });
    return [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `[File: ${filename}]`,
            marks: [{ type: "link", attrs: { href: `tutti-import://${encodeURIComponent(id)}` } }]
          }
        ]
      }
    ];
  }
  if (block.block_type === 27) {
    const token = block.image?.token;
    if (!token) {
      context.warnings.push({
        code: "missing_asset",
        message: "飞书图片块缺少素材 token。",
        sourceId: block.block_id
      });
      return [];
    }
    const id = `feishu:media:${token}`;
    context.assets.push({ id, provider: "feishu", kind: "image", providerToken: token });
    return [
      {
        type: "image",
        attrs: {
          src: `tutti-import://${encodeURIComponent(id)}`,
          width: block.image?.width,
          height: block.image?.height
        }
      }
    ];
  }
  if (block.block_type === 31) return [convertFeishuTable(block, context)];
  if ([19, 24, 25, 32, 34].includes(block.block_type)) {
    const children = convertFeishuChildren(block.children ?? [], context);
    if ([19, 34].includes(block.block_type)) {
      return [{ type: "blockquote", content: children }];
    }
    return children;
  }
  if (block.block_type === 1) return convertFeishuChildren(block.children ?? [], context);

  context.warnings.push({
    code: "unsupported_block",
    message: `飞书 Block ${block.block_type} 暂不支持，已保留占位说明。`,
    sourceId: block.block_id
  });
  return [paragraph(`[Unsupported Feishu block: ${block.block_type}]`)];
}

function convertFeishuTable(
  tableBlock: FeishuBlock,
  context: FeishuConversionContext
): CanonicalNode {
  const cellIds = tableBlock.table?.cells ?? tableBlock.children ?? [];
  const columns = Math.max(1, tableBlock.table?.property?.column_size ?? cellIds.length);
  const rows: CanonicalNode[] = [];
  for (let index = 0; index < cellIds.length; index += columns) {
    const rowIds = cellIds.slice(index, index + columns);
    rows.push({
      type: "tableRow",
      content: rowIds.map((cellId) => {
        const cell = context.blockMap.get(cellId);
        return {
          type: rows.length === 0 ? "tableHeader" : "tableCell",
          content: cell ? convertFeishuChildren(cell.children ?? [], context) : [paragraph("")]
        };
      })
    });
  }
  return { type: "table", content: rows };
}

function feishuTextToInline(text: FeishuText | undefined): CanonicalNode[] {
  return (text?.elements ?? []).flatMap((element): CanonicalNode[] => {
    if (element.text_run) {
      return [styledText(element.text_run.content ?? "", element.text_run.text_element_style)];
    }
    if (element.mention_user) {
      return [
        styledText(`@${element.mention_user.user_id ?? "user"}`, element.mention_user.text_element_style)
      ];
    }
    if (element.mention_doc) {
      const label = element.mention_doc.title || element.mention_doc.url || "Referenced document";
      const marks = marksFromFeishuStyle(element.mention_doc.text_element_style);
      if (element.mention_doc.url) {
        marks.push({ type: "link", attrs: { href: safeDecodeUrl(element.mention_doc.url) } });
      }
      return [{ type: "text", text: label, marks }];
    }
    if (element.equation) {
      return [styledText(element.equation.content ?? "", element.equation.text_element_style)];
    }
    if (element.reminder) {
      return [styledText(element.reminder.text ?? "[reminder]", element.reminder.text_element_style)];
    }
    return [];
  });
}

function feishuTextPlainText(text: FeishuText | undefined): string {
  return feishuTextToInline(text).map((node) => node.text ?? "").join("");
}

function styledText(value: string, style: FeishuTextElementStyle | undefined): CanonicalNode {
  return { type: "text", text: value, marks: marksFromFeishuStyle(style) };
}

function marksFromFeishuStyle(style: FeishuTextElementStyle | undefined): CanonicalMark[] {
  const marks: CanonicalMark[] = [];
  if (style?.bold) marks.push({ type: "bold" });
  if (style?.italic) marks.push({ type: "italic" });
  if (style?.strikethrough) marks.push({ type: "strike" });
  if (style?.inline_code) marks.push({ type: "code" });
  if (style?.link?.url) {
    marks.push({ type: "link", attrs: { href: safeDecodeUrl(style.link.url) } });
  }
  return marks;
}

function safeDecodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function feishuTokenFromResponse(response: Record<string, unknown>): ConnectorToken {
  if (typeof response.access_token !== "string") {
    throw new ConnectorError({
      provider: "feishu",
      code: "invalid_provider_response",
      message: "飞书 OAuth 响应缺少 access_token。",
      details: response
    });
  }
  const now = Date.now();
  const expiresIn = typeof response.expires_in === "number" ? response.expires_in : undefined;
  const refreshExpiresIn =
    typeof response.refresh_token_expires_in === "number"
      ? response.refresh_token_expires_in
      : typeof response.refresh_expires_in === "number"
        ? response.refresh_expires_in
        : undefined;
  return {
    accessToken: response.access_token,
    refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : undefined,
    tokenType: "bearer",
    expiresAt: expiresIn ? new Date(now + expiresIn * 1000).toISOString() : undefined,
    refreshExpiresAt: refreshExpiresIn
      ? new Date(now + refreshExpiresIn * 1000).toISOString()
      : undefined,
    accountId:
      typeof response.open_id === "string"
        ? response.open_id
        : typeof response.user_id === "string"
          ? response.user_id
          : undefined,
    metadata: {
      scope: response.scope,
      tenantKey: response.tenant_key
    }
  };
}
