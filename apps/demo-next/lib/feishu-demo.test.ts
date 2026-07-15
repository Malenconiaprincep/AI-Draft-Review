import assert from "node:assert/strict";
import test from "node:test";
import { ConnectorError, type FetchLike } from "@tutti/content-import";
import { importPublicFeishuDocument } from "./feishu-demo.ts";

const request = new Request("http://localhost/api/content-import/preview");
const source = "https://example.feishu.cn/docx/G45Sdeoino8s6JxLQiecn5Vqnpe?from=from_copylink";

test("previews parseable Feishu HTML without an app or user session", async () => {
  const fetchImpl: FetchLike = async (_input, init) => {
    assert.equal(init?.headers && new Headers(init.headers).has("Authorization"), false);
    assert.equal(init?.headers && new Headers(init.headers).has("Cookie"), false);
    return responseAt(source, `<!doctype html><html><head>
      <meta property="og:title" content="公开活动方案 - 飞书文档">
    </head><body><main>
      <h1>公开活动方案</h1>
      <p>这是一篇无需登录即可读取的飞书公开文档正文，用于验证匿名预览。</p>
      <ul><li>第一项</li><li>第二项</li></ul>
    </main></body></html>`);
  };

  const result = await importPublicFeishuDocument(request, source, fetchImpl);
  assert.equal(result.title, "公开活动方案");
  assert.equal(result.source.id, "G45Sdeoino8s6JxLQiecn5Vqnpe");
  assert.equal(result.doc.content?.[0]?.type, "heading");
  assert.match(JSON.stringify(result.doc), /无需登录即可读取/);
  assert.equal(result.warnings.at(-1)?.code, "format_downgraded");
});

test("keeps transient guest cookies across Feishu public redirects", async () => {
  let step = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    step += 1;
    const url = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(init?.redirect, "manual");

    if (step === 1) {
      assert.equal(url, source);
      assert.equal(headers.has("Cookie"), false);
      return responseAt(source, "", {
        status: 302,
        headers: {
          Location: "https://accounts.feishu.cn/accounts/page/login?with_guest=1",
          "Set-Cookie": "guest_session=abc; Domain=.feishu.cn; Path=/; HttpOnly"
        }
      });
    }
    if (step === 2) {
      assert.match(headers.get("Cookie") ?? "", /guest_session=abc/);
      return responseAt(url, "", {
        status: 302,
        headers: { Location: source }
      });
    }
    if (step === 3) {
      assert.equal(url, source);
      assert.match(headers.get("Cookie") ?? "", /guest_session=abc/);
      return responseAt(source, `<!doctype html><html><body><main>
        <h1>游客公开文档</h1>
        <p>飞书返回游客 Cookie 后，可以继续匿名读取公开正文。</p>
      </main></body></html>`);
    }
    throw new Error("unexpected redirect");
  };

  const result = await importPublicFeishuDocument(request, source, fetchImpl);
  assert.equal(step, 3);
  assert.equal(result.title, "游客公开文档");
  assert.match(JSON.stringify(result.doc), /继续匿名读取公开正文/);
});

test("prefers the Feishu SSR page block over surrounding document chrome", async () => {
  const fetchImpl: FetchLike = async () => responseAt(source, `<!doctype html><html><body>
    <div>工作区名称 添加快捷方式 最近修改 分享</div>
    <div data-block-type="page">
      <div>输入“/”快速插入内容</div>
      <div><h1>干净的正文标题</h1></div>
      <div>用户9394 用户9394</div>
      <div>昨天修改</div>
      <div data-block-type="text"><div><p>这里只保留公开文档正文，并排除页面外壳噪音。</p></div></div>
    </div>
  </body></html>`);

  const result = await importPublicFeishuDocument(request, source, fetchImpl);
  const serialized = JSON.stringify(result.doc);
  assert.match(serialized, /这里只保留公开文档正文/);
  assert.doesNotMatch(serialized, /工作区名称|添加快捷方式|最近修改|分享|快速插入|用户9394|昨天修改/);
});

test("reports a hint when Feishu redirects an anonymous request to login", async () => {
  const fetchImpl: FetchLike = async () => responseAt(
    "https://accounts.feishu.cn/accounts/page/login?with_guest=1",
    "<html><body>登录飞书</body></html>"
  );

  await assert.rejects(
    () => importPublicFeishuDocument(request, source, fetchImpl),
    (error) => error instanceof ConnectorError
      && error.code === "access_denied"
      && error.status === 422
      && error.message.includes("跳转到了登录页")
  );
});

test("reports a hint when a public page exposes no parseable body", async () => {
  const fetchImpl: FetchLike = async () => responseAt(
    source,
    "<html><head><title>飞书文档</title></head><body><div id=\"app\"></div><script>load()</script></body></html>"
  );

  await assert.rejects(
    () => importPublicFeishuDocument(request, source, fetchImpl),
    (error) => error instanceof ConnectorError
      && error.code === "access_denied"
      && error.message.includes("没有提供可匿名解析的正文")
  );
});

test("rejects non-Feishu URLs before making a request", async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return new Response();
  };

  await assert.rejects(
    () => importPublicFeishuDocument(request, "https://example.com/docx/abcdefghi", fetchImpl),
    (error) => error instanceof ConnectorError && error.code === "invalid_source"
  );
  assert.equal(called, false);
});

function responseAt(url: string, body: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "text/html; charset=utf-8");
  const response = new Response(body, {
    ...init,
    status: init?.status ?? 200,
    headers
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
