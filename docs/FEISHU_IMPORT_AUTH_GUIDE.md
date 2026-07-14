# 飞书商店应用连接与真实导入指南

## 已接入链路

Demo 使用飞书 OAuth 2.0 的 `user_access_token` 读取当前用户有权访问的 Docx/Wiki 文档：

```text
GET /api/connectors/feishu/authorize
  → 生成随机 state 和服务端会话
  → 跳转飞书授权页

GET /api/connectors/feishu/callback
  → 校验 state
  → 用 code 换取 access/refresh token
  → 回到 /import-demo

POST /api/content-import/preview
  → 必要时刷新并原子替换 refresh token
  → 使用 X-Lark-MCP-UAT 调用官方远程 MCP fetch-doc
  → MCP 不可用或响应无法规范化时回退 REST Block API
  → REST 回退时解析 Wiki token、分页读取 Block 和素材临时地址
  → CanonicalDocument → DraftDocJSON

GET /api/connectors/feishu/documents?q=<关键词>
  → 使用同一用户 UAT 调用 MCP search-doc
  → 只返回该用户自身有权访问的文档
  → 用户选择文档后再调用导入预览
```

Token 仅保存在本地 Node.js 进程内存中，浏览器只持有随机的 HttpOnly、SameSite=Lax
会话 Cookie。Demo 会话最多保留 12 小时，服务重启后会丢失；生产环境必须改为按用户加密持久化。

## 应用形态

Tutti 面向不同组织及飞书个人版用户，因此正式接入使用 **商店应用**。浏览器 OAuth、
`user_access_token`、远程 MCP 与 REST 文档读取代码同时支持自建应用和商店应用，切换应用类型
不需要改写导入解析逻辑。

本地无凭据时，非生产环境默认启用飞书官方动态应用注册：页面生成一次性链接，用户确认后为当前
用户或租户创建独立自建应用，再进入用户 OAuth。设置真实商店应用 App ID/Secret 后会自动切换为
商店应用模式；如只想跑 UI，可显式设置 `FEISHU_LOCAL_DEMO=true`。

## 飞书开放平台配置

1. 在飞书开放平台创建商店应用，取得 App ID 和 App Secret。
2. 在“开发配置 → 权限管理”开通以下用户身份权限：

   - `docx:document:readonly`：查看新版文档。
   - `wiki:wiki:readonly`：查看知识库并解析 Wiki Node。
   - `search:docs:read`：授权后搜索当前用户可访问的云文档。
   - `docs:document.media:download`：下载文档内图片和附件。
   - `offline_access`：获取 refresh token。

3. 在“安全设置”添加重定向 URL：

   ```text
   http://localhost:3000/api/connectors/feishu/callback
   ```

4. 如果后台提供“刷新 user_access_token”开关，请开启它。
5. 开发阶段将应用关联测试企业，在测试版中免审验证；正式发布前再同步配置并提交商店审核。

当前导入链路只使用用户身份 UAT，不调用商店应用的 app/tenant access token，所以本地阶段无需接入
`app_ticket`。以后若增加应用身份 API、安装事件或租户级任务，再增加 app_ticket 的接收与持久化。

权限和回调修改通常需要重新发布应用后才生效。知识库除 API scope 外还受资源权限控制；授权用户本身必须能阅读目标节点。

## 本地配置与测试

在 `apps/demo-next/.env.local` 配置：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_REDIRECT_URI=http://localhost:3000/api/connectors/feishu/callback
# 可选，默认即为该地址
FEISHU_MCP_SERVER_URL=https://mcp.feishu.cn/mcp
```

然后启动：

```bash
npm run dev
```

打开 [http://localhost:3000/import-demo](http://localhost:3000/import-demo)，选择飞书，点击
`连接个人飞书文档` 完成授权，再粘贴如下任一地址：

```text
https://your-tenant.feishu.cn/docx/<document-token>
https://your-tenant.feishu.cn/wiki/<wiki-node-token>
```

导入结果会展示标题、正文、列表、引用、代码、Todo、表格、图片/附件占位符、来源 revision
以及转换 warning，并标记本次使用 `MCP` 还是 `REST fallback`。素材临时地址只返回服务端，
API 响应会隐藏地址本身并仅标记是否成功获取。

远程 MCP 只允许发现 `search-doc,fetch-doc,fetch-file,list-docs` 四个文档工具。选择器调用
`search-doc`，导入调用 `fetch-doc`；素材仍由
REST 回退或宿主转存链路处理，避免把 MCP 的可变输出结构当作永久存储契约。

### 无凭据本地演示

开发环境没有 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 时，默认显示“扫码连接个人飞书”。服务端通过
`@larksuiteoapi/node-sdk` 的 `registerApp` 生成飞书官方动态链接，只申请文档读取和离线授权权限；
用户确认后，App ID/Secret 仅保存在当前 Node 会话内，再自动进入用户 OAuth。

动态注册可显式开关：

```env
FEISHU_DYNAMIC_APP=true
```

如需完全离线的 UI 模拟：

```env
FEISHU_LOCAL_DEMO=true
```

## 备用 Token 模式

无人值守任务或已有凭证管理服务可以直接设置：

```env
FEISHU_IMPORT_ACCESS_TOKEN=<caller-managed-token>
```

该模式优先于浏览器 OAuth 会话。Token 可以是满足目标 API 权限的 user access token 或 tenant access
token；生命周期与刷新由调用方负责。

## 生产边界

- 将 access/refresh token 与 Tutti 用户、飞书租户、应用版本关联并加密保存。
- 当前 Demo 用随机 HttpOnly Cookie 区分本地浏览器会话；接入 Tutti 登录后，必须改为以 Tutti user id
  作为授权归属，Cookie 只能保存会话标识。
- 动态注册返回的 App Secret 与用户 Token 同等级保护；生产环境必须加密持久化，禁止写日志或返回浏览器。
- 刷新成功后必须在同一事务中替换旧 refresh token；飞书 v2 refresh token 只能使用一次。
- 下载 `assets[].sourceUrl` 时限制响应大小、MIME、重定向和超时，再转存到 Tutti 对象存储。
- 用永久素材 URL 替换 `tutti-import://...`，待用户确认预览后再写入 draft 并递增 `doc_version`。
- 实现断开连接、撤销、审计以及多实例共享 Session/Token Store。

## 官方资料

- [获取授权码](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)
- [刷新 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token)
- [开发者调用官方远程 MCP](https://open.feishu.cn/document/mcp_open_tools/developers-call-remote-mcp-server)
- [远程 MCP 支持的工具](https://open.feishu.cn/document/mcp_open_tools/supported-tools)
- [获取文档所有块](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/list)
- [获取知识空间节点信息](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node)
- [获取素材临时下载链接](https://open.feishu.cn/document/server-docs/docs/drive-v1/media/batch_get_tmp_download_url)
