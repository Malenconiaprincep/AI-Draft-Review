# 飞书匿名公开链接预览指南

## 产品边界

飞书来源只支持粘贴外部公开的 Docx 或 Wiki 链接，不提供账号绑定、应用绑定、扫码登录、lark-cli、个人文档搜索或 OAuth 回调，也不需要配置 App ID / App Secret。

支持的链接形式：

```text
https://your-tenant.feishu.cn/docx/<document-token>?from=from_copylink
https://your-tenant.feishu.cn/wiki/<wiki-node-token>?from=from_copylink
```

## 预览规则

服务端以未登录访客身份访问分享地址：

```text
用户粘贴飞书 Docx / Wiki 链接
  → 校验 HTTPS、飞书域名与文档路径
  → 匿名请求公开网页（不发送 Cookie 或 Token）
  → 网页直接包含可解析正文时生成 DraftDocJSON 预览
  → 跳转登录、要求密码或拿不到正文时返回明确提示
```

这是尽力而为的网页预览，不调用飞书 OpenAPI。复杂排版、评论、附件和部分嵌入内容可能被降级；飞书调整公开页面结构后，也可能暂时无法解析。

“当前账号可以打开”不等于“未登录访客可以打开”。文档所有者需要把分享范围设为“互联网获得链接的人可阅读”，并关闭访问密码。若匿名请求仍被飞书跳转到登录页，Tutti 只提示无法匿名预览，不会要求用户绑定飞书。

## 安全边界

- 只允许 HTTPS 的 `feishu.cn`、`larksuite.com`、`larkoffice.com` 子域名。
- 只接受 `/docx/<token>` 与 `/wiki/<token>` 路径。
- 单次请求超时 12 秒，页面最大读取 4 MB。
- 不携带浏览器 Cookie、飞书 Token 或应用凭证。

## 本地验证

```bash
npm run dev
```

打开 [http://localhost:3000/import-demo](http://localhost:3000/import-demo)，直接粘贴飞书分享链接。平台绑定抽屉中不会出现飞书。
