import assert from "node:assert/strict";
import test from "node:test";
import type { DraftNodeJSON } from "@tutti/draft-doc";
import {
  isTrustedPrivateDnsAssetHost,
  resolveImportAssetDirectory,
  rewriteNodeAssetUrls
} from "./local-import-assets.ts";

test("uses writable temporary storage on Vercel", () => {
  assert.equal(
    resolveImportAssetDirectory({
      cwd: "/var/task/apps/demo-next",
      tempDirectory: "/tmp",
      vercel: "1"
    }),
    "/tmp/tutti-import-assets"
  );
});

test("keeps local assets under the project directory outside Vercel", () => {
  assert.equal(
    resolveImportAssetDirectory({
      cwd: "/workspace/apps/demo-next",
      tempDirectory: "/tmp",
      vercel: ""
    }),
    "/workspace/apps/demo-next/.local/import-assets"
  );
});

test("rewrites imported media nodes and file links to local preview URLs", () => {
  const assetId = "notion:url:https://files.example/image.png";
  const placeholder = `tutti-import://${encodeURIComponent(assetId)}`;
  const node: DraftNodeJSON = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: placeholder, alt: "Preview" } },
      {
        type: "paragraph",
        content: [{ type: "text", text: "File", marks: [{ type: "link", attrs: { href: placeholder } }] }]
      }
    ]
  };

  const rewritten = rewriteNodeAssetUrls(
    node,
    new Map([[assetId, "/api/import-assets/a.png"]])
  );
  assert.equal(rewritten.content?.[0]?.attrs?.src, "/api/import-assets/a.png");
  assert.equal(rewritten.content?.[1]?.content?.[0]?.marks?.[0]?.attrs?.href, "/api/import-assets/a.png");
});

test("allows only Notion's known asset hosts through a private local DNS proxy", () => {
  assert.equal(
    isTrustedPrivateDnsAssetHost("notion", "prod-files-secure.s3.us-west-2.amazonaws.com"),
    true
  );
  assert.equal(isTrustedPrivateDnsAssetHost("notion", "secure.notion-static.com"), true);
  assert.equal(isTrustedPrivateDnsAssetHost("notion", "metadata.internal"), false);
  assert.equal(
    isTrustedPrivateDnsAssetHost("youmind", "prod-files-secure.s3.us-west-2.amazonaws.com"),
    false
  );
});
