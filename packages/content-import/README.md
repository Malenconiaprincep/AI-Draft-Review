# `@tutti/content-import`

Notion、飞书、YouMind 和 Google Docs 内容连接器。该包只实现授权协议、远端读取和确定性内容转换，不保存 Token、素材或 draft。

## 基本用法

面向普通用户的 `Connect Notion` 推荐连接官方 `https://mcp.notion.com/mcp`。宿主负责 MCP OAuth/PKCE 和 `notion-fetch` 调用，再使用 `notionMcpFetchResultToImport(result, source)` 转换结果。

下面的 REST Connector 用法保留给 Internal connection、无人值守任务或平台没有 MCP 时的备用路径：

```ts
import {
  createNotionConnector,
  importConnectedDocument,
  type ConnectorToken
} from "@tutti/content-import";

const connector = createNotionConnector({
  clientId: process.env.NOTION_CLIENT_ID!,
  clientSecret: process.env.NOTION_CLIENT_SECRET!,
  redirectUri: "https://app.tutti.example/oauth/notion/callback"
});

// OAuth callback 中由宿主保存；不要发送到浏览器组件。
const token: ConnectorToken = await connector.exchangeAuthorization(code);

const result = await importConnectedDocument({
  connector,
  token,
  source: "https://www.notion.so/workspace/Page-<page-id>"
});
```

`result` 包含：

- `doc`: 可预览的 `DraftDocJSON`。
- `assets`: 需要宿主下载、校验并转存的图片/文件。
- `warnings`: 不支持节点、部分读取或素材权限问题。
- `sourceRevision`: 远端文档版本，用于重复导入检测。

## 素材处理

导入结果中的图片使用 `tutti-import://...` 占位地址。宿主必须：

1. 使用 `assets[].sourceUrl` 在服务端下载素材。
2. 限制响应大小、Content-Type、重定向次数和超时时间。
3. 将素材转存到 Tutti 对象存储。
4. 用永久 URL 替换 `DraftDocJSON` 中对应占位地址。
5. 用户确认预览后再写入 `doc_json` 并递增 `doc_version`。

## OAuth 边界

- 宿主负责生成和校验不可预测的 OAuth `state`。
- Access/refresh token 必须加密存储。
- Notion refresh token 和飞书 refresh token 都可能轮换，刷新成功后应原子替换旧 Token。
- Google Docs Picker 默认只申请 non-sensitive `drive.file`，只读取用户在 Picker 中主动选择的文档。
- 飞书默认申请 `docx:document:readonly`、`wiki:wiki:readonly`、`search:docs:read`、`docs:document.media:download` 和 `offline_access`；应用仍需在飞书开放平台后台开通并发布对应权限。

Notion MCP 连接、页面导入和 Internal Token 备用方案见
[`docs/NOTION_IMPORT_AUTH_GUIDE.md`](../../docs/NOTION_IMPORT_AUTH_GUIDE.md)。
飞书应用创建、OAuth 回调、权限和真实导入验证见
[`docs/FEISHU_IMPORT_AUTH_GUIDE.md`](../../docs/FEISHU_IMPORT_AUTH_GUIDE.md)。
YouMind 个人 API Key、Board/File 列表和 OpenAPI 导入见
[`docs/YOUMIND_IMPORT_AUTH_GUIDE.md`](../../docs/YOUMIND_IMPORT_AUTH_GUIDE.md)。
Google 个人 OAuth、Picker、Drive Markdown 导出与 Docs API 回退见
[`docs/GOOGLE_DOCS_IMPORT_AUTH_GUIDE.md`](../../docs/GOOGLE_DOCS_IMPORT_AUTH_GUIDE.md)。

## 当前支持

- Notion Page URL/ID、页面搜索、Enhanced Markdown、截断子树补取、图片/视频/文件素材发现。
- Notion 官方 MCP `notion-fetch` 响应到 `DraftDocJSON` 的确定性转换。
- 飞书用户 OAuth、MCP 文档搜索/选择、Docx/Wiki 导入、REST Block 回退、富文本、标题、列表、代码、引用、Todo、表格、图片/文件及素材临时地址。
- YouMind 官方 OpenAPI API Key、Board/File 列表、File/Craft ID 解析、`getFile`/`getCraft` 兼容读取和 Markdown 导入。
- Google OAuth、Drive 文档列表/标题筛选、官方 Markdown 导出、DraftDocJSON 转换，以及 Docs API 结构化回退。

账号连接 UI、文档选择器、生产落库、Webhook 自动同步和冲突合并不在此包内。
