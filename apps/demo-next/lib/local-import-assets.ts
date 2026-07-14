import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ContentImportResult, ExternalAsset } from "@tutti/content-import";
import type { DraftNodeJSON } from "@tutti/draft-doc";

const MAX_ASSET_BYTES = 80 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const DOWNLOAD_TIMEOUT_MS = 20_000;

export const LOCAL_IMPORT_ASSET_DIRECTORY = resolveImportAssetDirectory();

export function resolveImportAssetDirectory(input: {
  cwd?: string;
  tempDirectory?: string;
  vercel?: string;
} = {}): string {
  const cwd = input.cwd ?? process.cwd();
  const tempDirectory = input.tempDirectory ?? tmpdir();
  const vercel = input.vercel ?? process.env.VERCEL;
  return vercel === "1"
    ? path.join(tempDirectory, "tutti-import-assets")
    : path.join(cwd, ".local", "import-assets");
}

type LocalAsset = ExternalAsset & { sourceUrl: string };

export async function localizeImportAssets(
  result: ContentImportResult
): Promise<ContentImportResult> {
  if (result.assets.length === 0) return result;

  await mkdir(LOCAL_IMPORT_ASSET_DIRECTORY, { recursive: true });
  const localizedById = new Map<string, string>();
  const warnings = [...result.warnings];
  const assets = await Promise.all(
    result.assets.map(async (asset): Promise<ExternalAsset> => {
      if (!asset.sourceUrl) return asset;
      try {
        const localUrl = await downloadAsset(asset);
        localizedById.set(asset.id, localUrl);
        return { ...asset, sourceUrl: localUrl } satisfies LocalAsset;
      } catch (error) {
        warnings.push({
          code: "missing_asset",
          sourceId: asset.id,
          message: `${asset.filename || asset.kind} 未能保存到本地：${errorMessage(error)}`
        });
        return { ...asset, sourceUrl: undefined };
      }
    })
  );

  return {
    ...result,
    assets,
    warnings,
    doc: {
      ...result.doc,
      content: result.doc.content?.map((node) => rewriteNodeAssetUrls(node, localizedById))
    }
  };
}

export function rewriteNodeAssetUrls(
  node: DraftNodeJSON,
  localizedById: ReadonlyMap<string, string>
): DraftNodeJSON {
  const attrs = node.attrs ? rewriteAttributes(node.attrs, localizedById) : undefined;
  const marks = node.marks?.map((mark) => ({
    ...mark,
    attrs: mark.attrs ? rewriteAttributes(mark.attrs, localizedById) : undefined
  }));
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(marks ? { marks } : {}),
    ...(node.content
      ? { content: node.content.map((child) => rewriteNodeAssetUrls(child, localizedById)) }
      : {})
  };
}

async function downloadAsset(asset: ExternalAsset): Promise<string> {
  let currentUrl = new URL(asset.sourceUrl!);
  let response: Response | undefined;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHttpUrl(currentUrl, asset.provider);
    response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { Accept: acceptHeader(asset.kind) }
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("素材下载重定向缺少地址");
    currentUrl = new URL(location, currentUrl);
  }

  if (!response?.ok) {
    throw new Error(`素材服务器返回 ${response?.status ?? "未知状态"}`);
  }
  const announcedSize = Number(response.headers.get("content-length") || 0);
  if (announcedSize > MAX_ASSET_BYTES) throw new Error("素材超过 80 MB 限制");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("素材超过 80 MB 限制");
  if (bytes.byteLength === 0) throw new Error("素材内容为空");

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const extension = assetExtension(contentType, currentUrl.pathname, asset.filename);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const filename = `${digest}.${extension}`;
  const existing = await readdir(LOCAL_IMPORT_ASSET_DIRECTORY);
  if (!existing.includes(filename)) {
    await writeFile(path.join(LOCAL_IMPORT_ASSET_DIRECTORY, filename), bytes, { flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      }
    );
  }
  return `/api/import-assets/${filename}`;
}

async function assertPublicHttpUrl(url: URL, provider: ExternalAsset["provider"]): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 HTTP/HTTPS 素材地址");
  }
  if (url.username || url.password) throw new Error("素材地址不能包含登录凭据");

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0
    || (addresses.some(({ address }) => isPrivateAddress(address)) && !isTrustedPrivateDnsAssetHost(provider, url.hostname))
  ) {
    throw new Error("素材地址指向了不可访问的内部网络");
  }
}

export function isTrustedPrivateDnsAssetHost(
  provider: ExternalAsset["provider"],
  hostname: string
): boolean {
  if (provider !== "notion") return false;
  const normalized = hostname.toLowerCase();
  return normalized === "secure.notion-static.com"
    || /^prod-files-secure\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(normalized);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized);
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function rewriteAttributes(
  attrs: Record<string, unknown>,
  localizedById: ReadonlyMap<string, string>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [key, rewritePlaceholder(value, localizedById)])
  );
}

function rewritePlaceholder(value: unknown, localizedById: ReadonlyMap<string, string>): unknown {
  if (typeof value !== "string" || !value.startsWith("tutti-import://")) return value;
  try {
    return localizedById.get(decodeURIComponent(value.slice("tutti-import://".length))) ?? value;
  } catch {
    return value;
  }
}

function assetExtension(contentType: string | undefined, pathname: string, filename?: string): string {
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
  };
  if (contentType && byMime[contentType]) return byMime[contentType];
  const candidate = path.extname(filename || pathname).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(candidate) ? candidate : "bin";
}

function acceptHeader(kind: ExternalAsset["kind"]): string {
  if (kind === "image") return "image/*";
  if (kind === "video") return "video/*";
  if (kind === "audio") return "audio/*";
  return "application/octet-stream,application/pdf,*/*;q=0.5";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "下载超时";
  return error instanceof Error ? error.message : "未知下载错误";
}
