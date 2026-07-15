import {
  ConnectorError,
  canonicalDocumentToDraftDoc,
  parseMarkdownToCanonical,
  type ContentImportResult,
  type FetchLike
} from "@tutti/content-import";

const MAX_PUBLIC_PAGE_BYTES = 4 * 1024 * 1024;
const MIN_PUBLIC_CONTENT_LENGTH = 20;
const MAX_PUBLIC_REDIRECTS = 12;
const PUBLIC_FETCH_TIMEOUT_MS = 20_000;
const FEISHU_PUBLIC_DOMAINS = ["feishu.cn", "larksuite.com", "larkoffice.com"];

export function getFeishuConnection() {
  return {
    available: false,
    connected: false,
    mode: "public-only" as const,
    appType: "custom" as const
  };
}

/**
 * Best-effort anonymous import for Feishu/Lark public share pages.
 *
 * This deliberately does not use OpenAPI, an app identity or an end-user
 * session. Feishu's public guest flow sets short-lived cookies while redirecting
 * through its account pages, so those cookies are kept only for this request.
 */
export async function importPublicFeishuDocument(
  _request: Request,
  source: string,
  fetchImpl: FetchLike = fetch
): Promise<ContentImportResult> {
  const ref = resolvePublicFeishuSource(source);
  let response: Response;
  try {
    response = await fetchPublicFeishuPage(ref.url!, fetchImpl);
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError({
      provider: "feishu",
      code: "provider_error",
      message: "匿名访问飞书公开链接失败，请稍后重试。",
      status: 502,
      retryable: true,
      details: error instanceof Error ? error.message : error
    });
  }

  const finalUrl = safeUrl(response.url || ref.url!);
  if (isFeishuLoginUrl(finalUrl)) {
    throw anonymousPreviewUnavailable(
      "飞书把这个链接跳转到了登录页，未向匿名访客返回文档内容。请确认分享范围是“互联网获得链接的人可阅读”，且没有开启密码。"
    );
  }
  if (!response.ok) {
    throw new ConnectorError({
      provider: "feishu",
      code: response.status === 404 ? "not_found" : response.status === 401 || response.status === 403 ? "access_denied" : "provider_error",
      message: response.status === 404
        ? "飞书公开链接不存在或已失效。"
        : "飞书没有向匿名访客开放这篇文档，暂时无法生成预览。",
      status: response.status,
      retryable: response.status >= 500
    });
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw anonymousPreviewUnavailable("飞书公开链接没有返回可解析的网页内容，暂时无法生成预览。");
  }

  const html = await readResponseText(response, MAX_PUBLIC_PAGE_BYTES);
  const extracted = extractPublicFeishuPage(html);
  if (!extracted || extracted.markdown.replace(/[#*_`>\-\s]/g, "").length < MIN_PUBLIC_CONTENT_LENGTH) {
    throw anonymousPreviewUnavailable(
      "飞书公开页没有提供可匿名解析的正文，可能需要登录、访问密码，或当前页面结构暂不支持预览。"
    );
  }

  const parsed = parseMarkdownToCanonical(extracted.markdown, "feishu", { breaks: true });
  return canonicalDocumentToDraftDoc({
    ref,
    title: extracted.title || "飞书公开文档",
    content: parsed.content,
    assets: parsed.assets,
    warnings: [
      ...parsed.warnings,
      {
        code: "format_downgraded",
        message: "此预览来自匿名公开网页，复杂排版、评论和部分嵌入内容可能被降级。"
      }
    ]
  });
}

function resolvePublicFeishuSource(source: string) {
  const url = safeUrl(source.trim());
  const hostname = url?.hostname.toLowerCase();
  const allowedHost = hostname && isAllowedFeishuHost(hostname);
  const match = url?.pathname.match(/^\/(docx|wiki)\/([A-Za-z0-9_-]{8,128})\/?$/i);
  if (!url || url.protocol !== "https:" || !allowedHost || !match) {
    throw new ConnectorError({
      provider: "feishu",
      code: "invalid_source",
      message: "请输入完整的飞书 Docx 或 Wiki HTTPS 公开链接。",
      status: 400
    });
  }
  return {
    provider: "feishu" as const,
    id: match[2],
    kind: match[1].toLowerCase(),
    url: url.toString()
  };
}

async function fetchPublicFeishuPage(source: string, fetchImpl: FetchLike): Promise<Response> {
  const cookies = new Map<string, string>();
  const signal = AbortSignal.timeout(PUBLIC_FETCH_TIMEOUT_MS);
  let currentUrl = new URL(source);

  for (let redirectCount = 0; redirectCount <= MAX_PUBLIC_REDIRECTS; redirectCount += 1) {
    const headers = new Headers({
      Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
      "User-Agent": "Mozilla/5.0 (compatible; TuttiPublicDocumentPreview/1.0)"
    });
    if (cookies.size) headers.set("Cookie", [...cookies.values()].join("; "));

    const response = await fetchImpl(currentUrl.toString(), {
      redirect: "manual",
      signal,
      headers
    });
    rememberResponseCookies(response.headers, cookies);

    if (!isRedirectStatus(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const nextUrl = safeUrl(location, currentUrl);
    if (!nextUrl || nextUrl.protocol !== "https:" || !isAllowedFeishuHost(nextUrl.hostname)) {
      await response.body?.cancel();
      throw anonymousPreviewUnavailable("飞书公开链接跳转到了不受信任的地址，已停止预览。");
    }

    await response.body?.cancel();
    currentUrl = nextUrl;
  }

  throw anonymousPreviewUnavailable("飞书公开链接重定向次数过多，暂时无法生成预览。");
}

function rememberResponseCookies(headers: Headers, cookies: Map<string, string>) {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const setCookieValues = typeof extendedHeaders.getSetCookie === "function"
    ? extendedHeaders.getSetCookie()
    : splitCombinedSetCookie(headers.get("set-cookie"));

  for (const setCookie of setCookieValues) {
    const nameValue = setCookie.split(";", 1)[0]?.trim();
    const separator = nameValue?.indexOf("=") ?? -1;
    if (!nameValue || separator <= 0) continue;
    const name = nameValue.slice(0, separator);
    if (/;\s*max-age=0(?:;|$)/i.test(setCookie)) cookies.delete(name);
    else cookies.set(name, nameValue);
  }
}

function splitCombinedSetCookie(value: string | null): string[] {
  return value ? value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : [];
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isAllowedFeishuHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return FEISHU_PUBLIC_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

function isFeishuLoginUrl(url: URL | undefined): boolean {
  if (!url) return false;
  const hostname = url.hostname.toLowerCase();
  return hostname === "accounts.feishu.cn"
    || hostname === "login.feishu.cn"
    || hostname === "accounts.larksuite.com"
    || /\/accounts\/(?:page\/login|trap)|\/login(?:\/|$)/i.test(url.pathname);
}

function extractPublicFeishuPage(html: string): { title: string; markdown: string } | undefined {
  const normalized = html.replace(/\r\n?/g, "\n");
  const title = firstDecodedHtmlValue([
    metaContent(normalized, "property", "og:title"),
    metaContent(normalized, "name", "twitter:title"),
    tagContent(normalized, "h1"),
    tagContent(normalized, "title")
  ]).replace(/\s*[-|]\s*(?:飞书|Feishu|Lark).*$/i, "").trim();
  const description = firstDecodedHtmlValue([
    metaContent(normalized, "property", "og:description"),
    metaContent(normalized, "name", "description"),
    metaContent(normalized, "name", "twitter:description")
  ]);

  const withoutExecutableContent = normalized
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(header|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const feishuPage = tagContentByAttribute(withoutExecutableContent, "data-block-type", "page");
  const focused = feishuPage
    || tagContent(withoutExecutableContent, "article")
    || tagContent(withoutExecutableContent, "main")
    || tagContent(withoutExecutableContent, "body");
  const markdown = htmlFragmentToMarkdown(focused || "");
  const cleanedMarkdown = feishuPage ? stripFeishuDocumentChrome(markdown, title) : markdown;
  const fallback = description.length >= MIN_PUBLIC_CONTENT_LENGTH ? description : "";
  const content = cleanedMarkdown.length >= MIN_PUBLIC_CONTENT_LENGTH ? cleanedMarkdown : fallback;
  if (!content || looksLikeLoginPage(`${title}\n${content}`)) return undefined;
  return { title, markdown: content };
}

function htmlFragmentToMarkdown(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<h([1-6])\b[^>]*>/gi, (_match, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<(blockquote)\b[^>]*>/gi, "\n\n> ")
    .replace(/<\/(blockquote)>/gi, "\n\n")
    .replace(/<(p|div|section|article|main|tr|pre)\b[^>]*>/gi, "\n\n")
    .replace(/<\/(p|div|section|article|main|tr|pre)>/gi, "\n\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<\/(td|th)>/gi, "")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripFeishuDocumentChrome(markdown: string, title: string): string {
  const blocks = markdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const normalizedTitle = normalizeMarkdownBlock(title);
  const titleIndex = blocks.findIndex((block) => normalizeMarkdownBlock(block) === normalizedTitle);
  if (titleIndex < 0) return markdown;

  let contentStart = titleIndex + 1;
  const metadataBoundary = Math.min(blocks.length, contentStart + 3);
  while (
    contentStart < metadataBoundary
    && isFeishuPageMetadata(normalizeMarkdownBlock(blocks[contentStart]))
  ) {
    contentStart += 1;
  }
  return blocks.slice(contentStart).join("\n\n").trim() || markdown;
}

function normalizeMarkdownBlock(value: string): string {
  return value.replace(/^#{1,6}\s*/, "").replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim();
}

function isFeishuPageMetadata(value: string): boolean {
  return /^(?:刚刚|今天|昨天|\d{1,2}月\d{1,2}日)\s*修改$/.test(value)
    || /^(.{1,80})\s+\1$/u.test(value);
}

function metaContent(html: string, attribute: "name" | "property", value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forward = new RegExp(`<meta\\b[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const reverse = new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${escaped}["'][^>]*>`, "i");
  return forward.exec(html)?.[1] || reverse.exec(html)?.[1] || "";
}

function tagContent(html: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\/${escaped}>`, "i").exec(html)?.[1] || "";
}

function tagContentByAttribute(html: string, attribute: string, value: string): string {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opening = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\b${escapedAttribute}=["']${escapedValue}["'][^>]*>`,
    "i"
  ).exec(html);
  if (!opening || opening.index === undefined) return "";

  const tag = opening[1];
  const contentStart = opening.index + opening[0].length;
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else if (!match[0].endsWith("/>")) depth += 1;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  return "";
}

function firstDecodedHtmlValue(values: string[]): string {
  return values.map((value) => decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).trim()).find(Boolean) || "";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function looksLikeLoginPage(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").toLowerCase();
  return /扫码登录|登录飞书|账号登录|手机号登录|sign in to lark|log in to lark/.test(normalized);
}

async function readResponseText(response: Response, limit: number): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > limit) {
    throw anonymousPreviewUnavailable("飞书公开页面过大，无法安全生成预览。");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw anonymousPreviewUnavailable("飞书公开页面过大，无法安全生成预览。");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function anonymousPreviewUnavailable(message: string) {
  return new ConnectorError({
    provider: "feishu",
    code: "access_denied",
    message,
    status: 422
  });
}

function safeUrl(value: string, base?: URL): URL | undefined {
  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
}
