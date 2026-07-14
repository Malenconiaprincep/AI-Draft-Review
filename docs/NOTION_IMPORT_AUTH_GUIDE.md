# Notion MCP 连接与真实导入指南

## 方案结论

Tutti 的主连接方式是 Notion 官方托管 MCP：

```text
https://mcp.notion.com/mcp
```

用户点击 `Connect Notion via MCP` 后，Tutti 作为 MCP Client 完成 OAuth Discovery、动态客户端注册、PKCE 和用户授权；连接成功后调用 `notion-fetch` 读取页面，再转换为 Tutti `DraftDocJSON`。

这条链路不需要 Tutti 团队在 Notion Developer portal 手工创建 Public connection，也不需要配置 Notion Client ID 或 Client Secret。

## Demo 使用方法

1. 启动本地服务：

   ```bash
   npm run dev
   ```

2. 打开 [http://localhost:3000/import-demo](http://localhost:3000/import-demo)。
3. 选择 Notion，点击 `Connect Notion via MCP`。
4. 在 Notion 官方授权页登录并确认授权。
5. 授权完成后自动回到 Demo。
6. 粘贴 Notion 页面链接并点击“测试真实文档”。

授权取消、`state` 校验失败或 MCP 暂时不可用时，Demo 会显示对应错误，不会保存 Token。

## 实现链路

```text
GET /api/connectors/notion/authorize
  → 连接 https://mcp.notion.com/mcp
  → RFC 9728 / RFC 8414 OAuth Discovery
  → RFC 7591 Dynamic Client Registration
  → 生成 PKCE verifier/challenge 和 state
  → 跳转 Notion OAuth

GET /api/connectors/notion/callback
  → 校验 state
  → 用 code + PKCE verifier 换取 MCP Token
  → 调用 notion-fetch(id: "self") 识别工作区
  → 回到 /import-demo

POST /api/content-import/preview
  → 调用 notion-fetch(id: <page URL or ID>)
  → 解析 MCP 文本/结构化响应
  → 转为 CanonicalDocument
  → 转为 DraftDocJSON
```

## Token 安全边界

当前 Demo 只把 MCP access/refresh token、动态注册客户端信息和 PKCE verifier 保存在本地 Node.js 进程内存中：

- 浏览器只持有随机、HttpOnly、SameSite=Lax 的 Session ID。
- Token 不进入客户端 JavaScript、URL、日志或 Git。
- Demo 会话最多保留 12 小时，服务重启后自动丢失。

生产环境必须改成服务端加密持久化，并关联 Tutti 用户、Notion 工作区、动态 MCP Client 和 Token 版本；还需要支持刷新 Token 原子轮换、断开连接、撤销和审计。

## Internal connection 备用方式

Notion 官方远程 MCP 必须由真人完成 OAuth，不适合无人值守任务。开发环境、内部自动化或服务账号任务可使用现有 REST API 备用路径：

```env
# apps/demo-next/.env.local
NOTION_IMPORT_ACCESS_TOKEN=<installation-access-token>
```

使用内部连接时，新连接默认没有页面权限，还需要在 Developer portal 的 `Content access` 中选页，或在页面执行 `••• → Connections → Add connection`。

如果同时存在 Internal Token 和 MCP 会话，当前 Demo 优先使用 Internal Token；正式产品建议按连接类型显式选择，避免授权来源不透明。

## 当前限制

- Notion MCP 是用户型 OAuth，不能用 Bearer Token 做完全无人值守连接。
- `notion-fetch` 支持按页面 URL/ID读取内容；页面搜索可在后续使用 `notion-search`。
- Notion MCP 当前不支持文件上传。导入发现的远端素材仍需 Tutti 服务端下载并转存。
- 当前 Token Store 是单进程 Demo 实现，不适用于多实例或 Serverless 生产部署。

## 官方资料

- [Connecting to Notion MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp)
- [Integrating your own MCP client](https://developers.notion.com/guides/mcp/build-mcp-client)
- [Notion MCP supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Notion MCP security best practices](https://developers.notion.com/guides/mcp/mcp-security-best-practices)
- [Internal connections](https://developers.notion.com/guides/get-started/internal-connections)
