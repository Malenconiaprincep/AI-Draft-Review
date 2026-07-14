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
        markdown: "# Launch\n\nA **real** YouMind draft.\n\n![Hero](https://cdn.example/hero.png)"
      }
    })) as FetchLike
  });

  const result = await connector.importDocument(token, id);
  assert.equal(result.title, "Launch draft");
  assert.equal(result.source.provider, "youmind");
  assert.equal(result.sourceRevision, "2026-07-13T12:00:00.000Z");
  assert.equal(result.doc.content?.some((node) => node.type === "heading"), true);
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
