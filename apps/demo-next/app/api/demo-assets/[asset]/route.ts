import type { FileHandle } from "node:fs/promises";
import { open, stat } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DemoAsset = {
  path: string;
  contentType: string;
};

const DEMO_ASSETS: Record<string, DemoAsset> = {
  "acme-control.png": {
    path: "/var/folders/3d/1d8v0dgj07q2hsx0f3p22hvm0000gn/T/codex-clipboard-4a8cd909-0007-4378-b4b5-c3156d664bc9.png",
    contentType: "image/png"
  },
  "review-flow-2026-07-06.mov": {
    path: "/Users/user/Desktop/录屏2026-07-06 17.33.13.mov",
    contentType: "video/quicktime"
  },
  "review-flow-2026-07-08.mov": {
    path: "/Users/user/Desktop/录屏2026-07-08 22.05.51.mov",
    contentType: "video/quicktime"
  }
};

export async function GET(request: Request) {
  const assetId = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
  const resolvedAsset = await resolveAsset(assetId);

  if (!resolvedAsset) {
    return Response.json({ error: "Demo asset unavailable." }, { status: 404 });
  }

  const { asset, fileSize } = resolvedAsset;
  const range = request.headers.get("range");
  if (range) {
    return streamRange(asset, fileSize, range, request.signal);
  }

  return new Response(createFileStream(asset.path, { signal: request.signal }), {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(fileSize),
      "Content-Type": asset.contentType
    }
  });
}

export async function HEAD(request: Request) {
  const assetId = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
  const resolvedAsset = await resolveAsset(assetId);

  if (!resolvedAsset) {
    return new Response(null, { status: 404 });
  }

  return new Response(null, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(resolvedAsset.fileSize),
      "Content-Type": resolvedAsset.asset.contentType
    }
  });
}

function streamRange(
  asset: DemoAsset,
  fileSize: number,
  rangeHeader: string,
  signal: AbortSignal
): Response {
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!rangeMatch) {
    return rangeNotSatisfiable(fileSize);
  }

  const requestedStart = rangeMatch[1] ? Number(rangeMatch[1]) : undefined;
  const requestedEnd = rangeMatch[2] ? Number(rangeMatch[2]) : undefined;

  let start = requestedStart ?? 0;
  let end = requestedEnd ?? fileSize - 1;

  if (requestedStart === undefined && requestedEnd !== undefined) {
    start = Math.max(fileSize - requestedEnd, 0);
    end = fileSize - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return rangeNotSatisfiable(fileSize);
  }

  end = Math.min(end, fileSize - 1);

  return new Response(createFileStream(asset.path, { end, signal, start }), {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Content-Type": asset.contentType
    }
  });
}

async function resolveAsset(assetId: string): Promise<{ asset: DemoAsset; fileSize: number } | null> {
  const asset = DEMO_ASSETS[assetId];
  if (!asset) return null;

  const fileStat = await stat(asset.path).catch(() => null);
  if (!fileStat?.isFile()) return null;

  return { asset, fileSize: fileStat.size };
}

function createFileStream(
  path: string,
  options: { start?: number; end?: number; signal?: AbortSignal } = {}
): ReadableStream<Uint8Array> {
  const chunkSize = 64 * 1024;
  let fileHandle: FileHandle | null = null;
  let position = options.start ?? 0;
  let cancelled = false;
  let closing: Promise<void> | null = null;
  let abort = () => undefined;

  const closeFile = async () => {
    options.signal?.removeEventListener("abort", abort);
    if (closing) return closing;
    const handle = fileHandle;
    fileHandle = null;
    if (!handle) return undefined;
    closing = handle.close().catch(() => undefined);
    return closing;
  };

  abort = () => {
    cancelled = true;
    void closeFile();
  };

  return new ReadableStream<Uint8Array>({
    async start() {
      options.signal?.addEventListener("abort", abort, { once: true });
      fileHandle = await open(path, "r");
      if (cancelled) {
        await closeFile();
      }
    },
    async pull(controller) {
      if (cancelled || !fileHandle) return;

      const remainingBytes =
        options.end === undefined ? chunkSize : Math.min(chunkSize, options.end - position + 1);

      if (remainingBytes <= 0) {
        await closeFile();
        if (!cancelled) controller.close();
        return;
      }

      const buffer = Buffer.allocUnsafe(remainingBytes);
      let bytesRead = 0;

      try {
        const result = await fileHandle.read(buffer, 0, remainingBytes, position);
        bytesRead = result.bytesRead;
      } catch (error) {
        await closeFile();
        if (!cancelled) controller.error(error);
        return;
      }

      if (cancelled) return;

      if (bytesRead === 0) {
        await closeFile();
        if (!cancelled) controller.close();
        return;
      }

      position += bytesRead;

      try {
        controller.enqueue(buffer.subarray(0, bytesRead));
      } catch {
        cancelled = true;
        await closeFile();
      }
    },
    async cancel() {
      cancelled = true;
      options.signal?.removeEventListener("abort", abort);
      await closeFile();
    }
  });
}

function rangeNotSatisfiable(fileSize: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      "Content-Range": `bytes */${fileSize}`
    }
  });
}
