import assert from "node:assert/strict";
import test from "node:test";
import type { DraftNodeJSON } from "@tutti/draft-doc";
import { rewriteNodeAssetUrls } from "./local-import-assets.ts";

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
