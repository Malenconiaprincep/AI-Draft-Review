import assert from "node:assert/strict";
import test from "node:test";
import { ConnectorError } from "./errors.ts";
import {
  feishuMcpFetchResultToImport,
  feishuMcpSearchResultToDocuments
} from "./feishu-mcp.ts";

test("converts a Feishu MCP fetch-doc response into DraftDocJSON", () => {
  const result = feishuMcpFetchResultToImport(
    {
      content: [{
        type: "text",
        text: JSON.stringify({
          data: {
            document: {
              document_id: "doxcnMcpDocument",
              revision_id: 19,
              title: "MCP Campaign"
            },
            markdown: "# MCP Campaign\n\nHello **Tutti**.\n\n- One\n- Two"
          }
        })
      }]
    },
    "https://acme.feishu.cn/docx/doxcnMcpDocument"
  );

  assert.equal(result.source.id, "doxcnMcpDocument");
  assert.equal(result.sourceRevision, "19");
  assert.equal(result.title, "MCP Campaign");
  assert.equal(result.doc.content?.[0]?.type, "heading");
  assert.equal(result.doc.content?.some((node) => node.type === "bulletList"), true);
});

test("rejects Feishu MCP tool errors so the host can use REST fallback", () => {
  assert.throws(
    () => feishuMcpFetchResultToImport({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: "permission denied" }) }]
    }, "doxcnMcpDocument"),
    (error) => error instanceof ConnectorError && error.message === "permission denied"
  );
});

test("normalizes Feishu MCP search-doc results for a user document picker", () => {
  const documents = feishuMcpSearchResultToDocuments({
    content: [{
      type: "text",
      text: JSON.stringify({
        data: {
          items: [{
            document_id: "doxcnOwnedByUser",
            title: "User campaign draft",
            url: "https://acme.feishu.cn/docx/doxcnOwnedByUser",
            update_time: "2026-07-13T10:00:00.000Z"
          }]
        }
      })
    }]
  });

  assert.deepEqual(documents, [{
    provider: "feishu",
    id: "doxcnOwnedByUser",
    kind: "docx",
    url: "https://acme.feishu.cn/docx/doxcnOwnedByUser",
    title: "User campaign draft",
    lastEditedAt: "2026-07-13T10:00:00.000Z"
  }]);
});
