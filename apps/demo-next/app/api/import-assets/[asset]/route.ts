import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { LOCAL_IMPORT_ASSET_DIRECTORY } from "../../../../lib/local-import-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> }
) {
  const { asset } = await params;
  if (!/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(asset)) {
    return NextResponse.json({ error: "素材名称无效。" }, { status: 400 });
  }

  const filename = path.join(LOCAL_IMPORT_ASSET_DIRECTORY, asset);
  try {
    const info = await stat(filename);
    const range = parseRange(request.headers.get("range"), info.size);
    const bytes = await readFile(filename);
    const commonHeaders = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": mimeType(asset)
    };
    if (range) {
      const body = bytes.subarray(range.start, range.end + 1);
      return new Response(body, {
        status: 206,
        headers: {
          ...commonHeaders,
          "Content-Length": String(body.byteLength),
          "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`
        }
      });
    }
    return new Response(bytes, {
      headers: { ...commonHeaders, "Content-Length": String(info.size) }
    });
  } catch (error) {
    const status = (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
    return NextResponse.json({ error: status === 404 ? "素材不存在。" : "读取素材失败。" }, { status });
  }
}

function parseRange(value: string | null, size: number): { start: number; end: number } | undefined {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
  const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return undefined;
  }
  return { start, end };
}

function mimeType(filename: string): string {
  const extension = path.extname(filename).slice(1);
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
    pdf: "application/pdf", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  return types[extension] || "application/octet-stream";
}
