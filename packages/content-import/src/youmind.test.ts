import assert from "node:assert/strict";
import test from "node:test";
import { YouMindConnector, parseYouMindFileId } from "./youmind.ts";
import type { ConnectorToken, FetchLike } from "./types.ts";

const token: ConnectorToken = { accessToken: "sk-ym-test-key-123", tokenType: "bearer" };

test("parses YouMind file IDs and links", () => {
  const id = "019bc6bc-e1cc-79a2-a6fd-448b711a8895";
  assert.equal(parseYouMindFileId(id), id);
  assert.equal(parseYouMindFileId(`https://youmind.com/crafts/${id}`), id);
  assert.equal(parseYouMindFileId("https://example.com/not-youmind"), undefined);
});

test("lists boards and files with the official OpenAPI headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/listBoards")) {
      return Response.json({ data: { boards: [{ id: "board-1", name: "Campaign", isFavorite: true }] } });
    }
    return Response.json({
      files: [{ id: "019bc6bc-e1cc-79a2-a6fd-448b711a8895", title: "Launch draft", type: "document" }]
    });
  }) as FetchLike;
  const connector = new YouMindConnector({ fetch: fetchMock });

  const boards = await connector.listBoards(token);
  const files = await connector.listFiles(token, "board-1");

  assert.equal(boards[0]?.name, "Campaign");
  assert.equal(files.items[0]?.title, "Launch draft");
  assert.equal(files.items[0]?.url, "https://youmind.com/crafts/019bc6bc-e1cc-79a2-a6fd-448b711a8895");
  assert.equal(new Headers(calls[0]?.init?.headers).get("X-API-Key"), token.accessToken);
  assert.equal(new Headers(calls[0]?.init?.headers).get("x-use-camel-case"), "true");
});

test("imports YouMind Markdown through getFile", async () => {
  const id = "019bc6bc-e1cc-79a2-a6fd-448b711a8895";
  const connector = new YouMindConnector({
    fetch: (async () => Response.json({
      file: {
        id,
        title: "Launch draft",
        updatedAt: "2026-07-13T12:00:00.000Z",
        markdown: [
          "# Launch",
          "",
          "A **real** YouMind draft.",
          "",
          "```typescript",
          "function greet(name: string) {",
          "  return `hello, ${name}`",
          "}",
          "```",
          "",
          "![Hero](https://cdn.example/hero.png)"
        ].join("\n")
      }
    })) as FetchLike
  });

  const result = await connector.importDocument(token, id);
  assert.equal(result.title, "Launch draft");
  assert.equal(result.source.provider, "youmind");
  assert.equal(result.sourceRevision, "2026-07-13T12:00:00.000Z");
  assert.equal(result.doc.content?.some((node) => node.type === "heading"), true);
  const codeBlock = result.doc.content?.find((node) => node.type === "codeBlock");
  assert.equal(codeBlock?.attrs?.language, "typescript");
  assert.equal(codeBlock?.content?.[0]?.text, [
    "function greet(name: string) {",
    "  return `hello, ${name}`",
    "}"
  ].join("\n"));
  assert.equal(result.assets.length, 1);
});

test("combines crafts and materials returned by listFiles", async () => {
  const connector = new YouMindConnector({
    fetch: (async () => Response.json({
      data: {
        crafts: [{ id: "019bc6bc-e1cc-79a2-a6fd-448b711a8895", title: "Draft" }],
        materials: [{ id: "019bc6bc-e1cc-79a2-a6fd-448b711a8896", title: "Reference" }]
      }
    })) as FetchLike
  });
  const page = await connector.listFiles(token, "board-1");
  assert.deepEqual(page.items.map((item) => item.title), ["Draft", "Reference"]);
});

test("restores escaped YouMind callouts and single-item toggles", async () => {
  const id = "019bc6bc-e1cc-79a2-a6fd-448b711a8895";
  const connector = new YouMindConnector({
    fetch: (async () => Response.json({
      file: {
        id,
        title: "Structured blocks",
        markdown: [
          "\\<aside\\>",
          "",
          '\\<img src="i" alt="i" width="40px" /\\>',
          "",
          "Important **bold** content.",
          "",
          "\\</aside\\>",
          "",
          "- Toggle title",
          "",
          "  Hidden paragraph.",
          "",
          "  - Nested item"
        ].join("\n")
      }
    })) as FetchLike
  });

  const result = await connector.importDocument(token, id);
  const callout = result.doc.content?.find((node) => node.type === "callout");
  const toggle = result.doc.content?.find((node) => node.type === "toggle");
  assert.equal(callout?.attrs?.icon, "i");
  assert.equal(callout?.content?.[0]?.content?.[1]?.marks?.[0]?.type, "bold");
  assert.deepEqual(toggle?.content?.map((node) => node.type), [
    "toggleSummary",
    "paragraph",
    "bulletList"
  ]);
  assert.equal(toggle?.content?.[0]?.content?.[0]?.text, "Toggle title");
});
