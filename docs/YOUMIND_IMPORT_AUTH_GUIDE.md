# YouMind 个人连接与导入指南

## 结论

YouMind 已提供官方 OpenAPI，可以实现“个人授权 → 获取 Board → 获取文件列表 → 选择并导入”。
当前授权形态是用户在 YouMind 设置中生成个人 API Key，不是第三方 OAuth authorization-code flow。

请在以下官方页面生成 Key：

```text
https://youmind.com/settings/api-keys
```

Key 形如 `sk-ym-...`。Demo 将 Key 发送到同源服务端校验，之后只在 Node.js 进程内存中保存；
浏览器仅持有随机的 HttpOnly、SameSite=Lax 会话 Cookie。页面状态、列表响应和导入结果都不会回传 Key。

## 已接入链路

```text
POST /api/connectors/youmind/authorize
  → 接收用户生成的 API Key
  → 调用官方 listBoards 验证 Key
  → Key 存入服务端内存会话
  → 浏览器只保存随机 HttpOnly Cookie

GET /api/connectors/youmind/boards
  → listBoards
  → 返回当前 Key 可访问的个人 Board

GET /api/connectors/youmind/files?boardId=<id>&q=<关键词>
  → 优先 listFiles
  → 兼容旧 OpenAPI：listCrafts + listMaterials
  → 返回 Board 内可导入文件

POST /api/content-import/preview
  → getFile({ id, withChildren: true })
  → 兼容旧 OpenAPI：getCraft({ id, withChildren: true })
  → Markdown/文档节点 → CanonicalDocument → DraftDocJSON
  → 图片等素材交给宿主转存
```

## 为什么不做浏览器 Cookie 授权

早期社区 MCP 方案需要从 YouMind 浏览器 Cookie 手工复制 Supabase session token，且只能按 Craft ID
读取单篇内容。这个方案依赖内部接口、无法稳定列出个人内容，也会把等同登录态的 Cookie 暴露给第三方。

现在官方已提供 API Key 与 OpenAPI，Tutti 不再需要读取 YouMind Cookie、模拟登录或逆向私有接口。

## 本地使用

启动 Demo：

```bash
npm run dev
```

打开 `http://localhost:3000/import-demo`：

1. 选择 `YouMind`。
2. 点击“先在 YouMind 生成个人 API Key”。
3. 将生成的 `sk-ym-...` Key 填入连接框。
4. 连接成功后选择 Board，再从文件列表选择一篇。
5. 点击“导入选中文档”。

无人值守或已有凭证管理服务时，可在 `apps/demo-next/.env.local` 设置：

```env
YOUMIND_IMPORT_API_KEY=sk-ym-...
# 可选；默认 https://youmind.com/openapi/v1
YOUMIND_API_BASE_URL=https://youmind.com/openapi/v1
```

## 连接器接口

```ts
import { createYouMindConnector, importConnectedDocument, youMindApiKeyToken } from "@tutti/content-import";

const connector = createYouMindConnector();
const token = youMindApiKeyToken(process.env.YOUMIND_IMPORT_API_KEY!);

const boards = await connector.listBoards(token);
const files = await connector.listFiles(token, boards[0].id);
const result = await importConnectedDocument({
  connector,
  token,
  source: files.items[0]
});
```

请求遵循 YouMind 官方 CLI 的协议：

- Base URL：`https://youmind.com/openapi/v1`
- Method：`POST /{apiName}`
- Auth header：`X-API-Key: sk-ym-...`
- Response casing：`x-use-camel-case: true`

## 生产边界

- Demo 的内存 Session 仅用于本地验证，进程重启后会丢失，最长保留 12 小时。
- 正式环境应将 API Key 与 Tutti user id 关联，并使用 KMS/envelope encryption 加密保存。
- 提供断开连接、Key 轮换、审计和撤销入口；日志与错误信息必须脱敏。
- API Key 不应写入 localStorage、前端状态持久化、URL、分析事件或客户端日志。
- 对外部素材继续执行大小、MIME、重定向、DNS/IP 与超时校验，再转存到 Tutti 对象存储。
- 当前导入是用户主动的一次性复制；若增加自动同步，应保存 source revision 并处理重复导入和冲突。

## 官方资料

- [YouMind for agents](https://youmind.com/for-agents)
- [YouMind 官方 Skill / OpenAPI 使用说明](https://github.com/YouMind-OpenLab/skills/blob/main/skills/youmind/SKILL.md)
- [YouMind API Key 设置](https://youmind.com/settings/api-keys)
- [YouMind 1.0 API 发布说明](https://youmind.com/blog/youmind-1-0-create-bolder)
