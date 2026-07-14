# Change Proposal: Content Import Connectors

## Summary

新增第一阶段内容导入能力：统一连接器契约、官方 Notion MCP 接入和飞书连接器。连接层负责授权、解析平台文档引用、读取平台内容、规范化内容并生成 `DraftDocJSON`；宿主系统继续负责凭证加密存储、权限校验、素材落库、草稿持久化和 `doc_version` 变更。

## Why

创作者已经在 Notion、飞书等外部写作平台完成初稿。Tutti 需要在用户明确授权后直接读取这些内容，减少重复维护，同时保持现有 `DraftDocJSON`、审稿和评论定位契约不变。

## Goals

- 提供统一的 `ContentConnector` TypeScript 契约。
- 支持官方 Notion MCP OAuth/PKCE、动态客户端注册、`notion-fetch` 和 MCP Token 刷新。
- 保留 Notion REST Internal connection 作为开发和无人值守任务备用路径。
- 支持飞书 OAuth、Token 刷新、官方远程 MCP `fetch-doc`，并保留 Docx/Wiki Block API 回退。
- 支持 Google 个人 OAuth、Picker、Drive Markdown 正文导出和 Docs API 回退。
- 将平台内容规范化为与平台无关的 Canonical Document，再转换为 `DraftDocJSON`。
- 识别图片等外部素材并返回待转存清单，不把平台临时下载地址视为永久素材地址。
- 为 HTTP 错误、授权失效、不支持的资源类型和部分内容降级提供可解释错误或 warning。

## Non-Goals

- 不实现生产账号管理或文档选择器；仅提供本地授权与导入预览 Demo。
- 不保存 OAuth Token，不接生产数据库。
- 不直接把导入结果写入 draft，不修改 `doc_version`。
- 不实现复制粘贴或本地文件导入。
- 不实现 WPS、腾讯文档或语雀连接器。
- 不实现自动同步、Webhook 或冲突合并。

## Integration Boundary

宿主系统负责：

- 生成并校验 OAuth `state`。
- 管理 MCP OAuth Discovery、PKCE、动态客户端注册和连接会话。
- 加密保存并轮换 access/refresh token。
- 调用连接器并校验当前用户是否可修改目标 draft。
- 下载 `assets` 中的临时素材、校验 MIME/大小并转存到 Tutti 对象存储。
- 用永久素材 URL 替换 `tutti-import://...` 占位地址。
- 展示导入预览，并在用户确认后写入 `doc_json`、递增 `doc_version`。

连接器包负责：

- 通过官方 Notion MCP 或平台 REST OAuth 完成授权、Token 交换与刷新。
- 解析并校验 Notion/飞书链接。
- 读取远端文档和分页数据。
- 规范化受支持的文本、标题、列表、引用、代码、表格、分割线和图片。
- 返回 `DraftDocJSON`、来源版本、素材清单和降级 warning。

## Deliverables

```text
packages/content-import/
  src/types.ts
  src/errors.ts
  src/canonical.ts
  src/markdown.ts
  src/notion.ts
  src/notion-mcp.ts
  src/feishu-mcp.ts
  src/feishu.ts
  src/google-docs.ts
  src/index.ts
```
