# Tasks: Content Import Connectors

## 1. Contract

- [x] 创建 `@tutti/content-import` 包。
- [x] 定义连接器、Token、文档引用、Canonical Document、素材和 warning 类型。
- [x] 定义宿主系统与连接器的权限、存储和落库边界。

## 2. Normalization

- [x] 实现 Canonical Document 到 `DraftDocJSON` 的安全转换。
- [x] 实现 Markdown 到 Canonical Document 的解析。
- [x] 对不支持的节点提供文本降级或 warning。
- [x] 为外部素材生成稳定的导入占位引用。

## 3. Notion

- [x] 接入官方 Notion MCP Streamable HTTP Client。
- [x] 实现 OAuth Discovery、动态客户端注册、PKCE、state 校验和 Token 刷新存储边界。
- [x] 调用 `notion-fetch` 并将响应转换为 Canonical Document。
- [x] 实现 OAuth authorization URL。
- [x] 实现 authorization code 交换和 refresh token 轮换。
- [x] 实现 Notion 页面 URL/ID 解析。
- [x] 实现页面元数据和 Enhanced Markdown 拉取。
- [x] 处理 `unknown_block_ids` 和截断页面。

## 4. Feishu

- [x] 接入官方远程 MCP `fetch-doc`，使用 OAuth UAT 和工具白名单。
- [x] 使用 `search-doc` 列出授权用户可访问的文档并提供选择器。
- [x] 将 MCP 文档响应转换为 Canonical Document，并保留 REST Block API 回退。
- [x] 实现 OAuth authorization URL。
- [x] 实现 authorization code 交换和 refresh token 轮换。
- [x] 实现 Docx/Wiki URL 解析和 Wiki Node 解析。
- [x] 实现文档元数据和 Block 分页拉取。
- [x] 转换富文本、列表、引用、代码、表格、分割线和图片。

## 5. Verification

- [x] 覆盖链接解析测试。
- [x] 覆盖 OAuth 请求测试。
- [x] 覆盖 Notion 分页 Markdown 和素材测试。
- [x] 覆盖 Notion MCP fetch 响应转换测试。
- [x] 覆盖飞书 Block 树、富文本、表格和素材测试。
- [x] 运行 workspace tests 和 typecheck。

## 6. YouMind

- [x] 使用个人 API Key 接入官方 YouMind OpenAPI，不读取浏览器 Cookie。
- [x] 实现 `listBoards` 与 `listFiles`，并兼容 `listCrafts + listMaterials`。
- [x] 实现 `getFile` 导入，并兼容旧版 `getCraft`。
- [x] 实现 File/Craft URL/ID 解析、Markdown/文档节点规范化和素材发现。
- [x] 在 Demo 中实现 API Key 服务端会话、Board/File 选择器和真实导入。
- [x] 覆盖列表、鉴权 header、链接解析和 Markdown 导入测试。

## 7. Google Docs

- [x] 使用 Google Identity Services token model 和 Google Picker 完成个人授权与选文档。
- [x] 仅申请 `drive.file`，不读取个人账号的完整 Drive 列表。
- [x] 使用 Drive API `files.get` 读取标题与版本，并用 `files.export(text/markdown)` 导入正文。
- [x] 将 Markdown 转换为 Canonical Document / DraftDocJSON，并保留 Docs API 结构化回退。
- [x] 在 Demo 中实现 Picker、短期服务端会话、断开连接和真实导入。
- [x] 覆盖 OAuth、刷新 Token、列表、链接解析、Markdown 导出和 Docs API 回退测试。
- [x] 记录 OAuth Client、受限 API Key、Project Number 和 Picker 生产配置。
