# Typefully 多平台发布调研与 Tutti X 首版方案

> 调研日期：2026-07-13  
> 目标：理解 Typefully 的多平台发布模型，并为 Tutti 设计可先落地 X、后续扩展其他平台的发布边界。

## 结论

建议不要把发布逻辑放进现有 AI Review 包，也不要让前端直接调用 X。

Tutti 应新增一个宿主侧发布域，拆成两层：

1. **纯转换 adapter**：`DraftDocJSON -> PlatformDraft`，不持有 token、不请求外部 API。
2. **渠道 provider**：`PlatformDraft -> external posts`，负责 OAuth、媒体上传、发布、重试和结果回写。

第一版只实现 `x` adapter/provider，范围控制为：

- 单条 X Post 和多条 Thread。
- 文本与图片；视频可以在第二阶段补齐异步媒体处理。
- 立即发布；定时发布先由 Tutti 自己的 job/queue 调用相同 provider，不依赖浏览器定时器。
- 只有 `approved` 版本可创建发布快照。
- 发布结果逐条保存，支持 thread 中途失败后从断点继续，不重复发布成功节点。

如果只是内部验证，可先接 Typefully API；如果 Tutti 要代表大量创作者发布，应直接接 X API。Typefully 官方明确把 Public API 定位为个人自动化和团队 workflow，并提示面向公共用户的 X app 需要直接使用更高限额的 X API。

## Typefully 是怎样支持多平台的

### 1. Social Set 管理“发布身份”

Typefully 把同一个人或品牌的一组社交账号组成一个 **Social Set**。一个 Social Set 可以连接 X、LinkedIn、Threads、Bluesky、Mastodon，每个平台至多一个账号；draft、排期、权限和分析都归属于该 Social Set。

这对 Tutti 的映射应是：

```text
publisher_connection_set
  owner: creator | brand
  x_connection
  linkedin_connection (future)
  threads_connection (future)
```

不要把 OAuth connection 直接挂在 campaign draft 上；同一创作者应该可以在多个 campaign 中复用已授权账号。

参考：[Typefully Social Sets and Accounts](https://support.typefully.com/en/articles/8717684-social-sets-and-accounts)

### 2. 一个 Draft 保存多个平台版本

Typefully API 的 draft payload 以平台为 key，每个平台有独立的 `enabled`、`posts` 和 settings：

```json
{
  "platforms": {
    "x": {
      "enabled": true,
      "posts": [
        { "text": "第一条" },
        { "text": "第二条" }
      ]
    },
    "linkedin": {
      "enabled": true,
      "posts": [{ "text": "合并后的 LinkedIn 版本" }]
    }
  }
}
```

产品交互是“write once, cross-post everywhere”：新 draft 默认从 primary platform 同步到其他平台；用户关闭 sync 后，可以独立修改某个平台版本。比如 X thread 同步到 LinkedIn 时会先合并为一篇，再允许单独调整 LinkedIn 文案。

这意味着 Tutti 后续不应该只保存一份 `plainText + selectedPlatforms`，而应该保存：

- 一份审核通过的 canonical content snapshot。
- 每个平台由 adapter 生成的 platform draft。
- 用户手动修改过的平台 override。

参考：[Typefully API v2](https://typefully.com/docs/api)、[Cross-post to LinkedIn](https://support.typefully.com/en/articles/8718168-publish-cross-post-to-linkedin)

### 3. 媒体先上传，再在平台 post 中引用

Typefully 的媒体流程是三步：申请预签名 URL、上传文件、轮询处理状态；draft 的各条 post 通过 `media_ids` 引用处理完成的媒体。这让“素材处理”和“发布动作”解耦，也允许失败重试。

Tutti 也应先把 DraftDocJSON 中的 `image` / `video` 节点解析成内部 `PublishMediaRef`，再由 X provider 上传并换成 X `media_id`。本地相对 URL（例如 demo 的 `/api/demo-assets/...`）不能直接交给发布服务，宿主必须先解析为可读文件或受控对象存储 URL。

参考：[Typefully API Media](https://typefully.com/docs/api)、[X Media Upload](https://docs.x.com/x-api/media/introduction)

### 4. 发布是异步状态机

Typefully 的 `publish_at: "now"` 不代表请求返回时已经发布完成。API 会先返回 `publish_state: "in_progress"`，调用方轮询 draft，直到 `finished`，再读取整体状态和每个平台 URL；也支持 webhook 接收 `draft.published` 等事件。

Tutti 应采用同样的异步语义：UI 点击发布只创建 publish attempt，worker 执行外部调用，UI 读取状态。不要在一个 Next.js request 中等待整个 thread 和视频处理完成。

建议状态：

```text
queued -> publishing -> published
                    -> partial_failed
                    -> failed
```

参考：[Typefully API Drafts and Webhooks](https://typefully.com/docs/api)

### 5. 权限分为读、写、发布

Typefully 团队角色区分 read-only、write、write & publish、admin。Tutti 也需要把“编辑内容”和“真正对外发布”分开授权。品牌方 approve 不应自动触发外发；是否由创作者本人或品牌运营点击发布，应由 campaign policy 决定。

参考：[Typefully Collaborating in Teams](https://support.typefully.com/en/articles/8717333-collaborating-in-teams)

## X 首版技术方案

### 内部契约

建议新增独立包 `@tutti/publish-adapters`，只放纯类型和转换逻辑：

```ts
type PublishPlatform = "x"; // 后续扩 union

type PublishMediaRef = {
  sourceUrl: string;
  kind: "image" | "video" | "gif";
  altText?: string;
};

type XPostDraft = {
  clientPostId: string;
  text: string;
  media: PublishMediaRef[];
};

type XPublishDraft = {
  platform: "x";
  sourceDocVersion: number;
  posts: XPostDraft[];
};

function draftDocToXPublishDraft(
  doc: DraftDocJSON,
  options: { sourceDocVersion: number }
): XPublishDraft;
```

宿主后端实现 provider：

```ts
interface PublishProvider<TDraft> {
  publish(input: {
    attemptId: string;
    connectionId: string;
    draft: TDraft;
  }): Promise<PublishResult>;
}
```

provider 不应该存在 React 包中，也不应该接受浏览器传来的 raw access token。

### DraftDocJSON 到 X Thread 的转换规则

首版建议使用显式分段，避免自动切 280 字导致语义和 URL 计数错误：

- 一级/二级 heading 开启一个 post。
- `horizontalRule` 明确切分下一条 post。
- 普通 paragraph 追加到当前 post，中间保留空行。
- 紧跟文本块后的 image/video 附着到当前 post。
- 文档若没有显式分段且超限，返回 validation error，由创作者调整；第二阶段再增加基于 X weighted length 的安全自动分段。
- 不把 `[image]`、`[video]` 这类审稿 serializer 占位符发到 X。
- 不自动添加 `1/N`，除非 campaign 或用户显式开启。

必须在预览和服务端各校验一次：空 post、字符限制、媒体数量/类型、不可读取素材、重复发布和 doc version 是否仍为 approved version。

### X API 调用顺序

X 官方创建 Post 使用用户上下文 token 调用 `POST /2/tweets`。OAuth 可用 OAuth 1.0a User Context 或 OAuth 2.0 Authorization Code with PKCE；面向创作者授权优先 OAuth 2.0 PKCE。

Thread 发布顺序：

1. 上传第一条所需媒体，取得 `media_id`。
2. `POST /2/tweets` 创建第一条，保存返回的 post id。
3. 上传下一条媒体。
4. 创建下一条时传 `reply.in_reply_to_tweet_id = previousPostId`。
5. 每成功一条立即持久化结果；失败时标记 `partial_failed`。
6. 重试从第一条没有 external id 的节点继续。

X 支持每条最多 4 张图片，或 1 个 GIF，或 1 个视频；媒体需先上传，再把 `media_id` 放进创建 Post 的 payload。

参考：[X Create Post Quickstart](https://docs.x.com/x-api/posts/manage-tweets/quickstart)、[X Media Best Practices](https://docs.x.com/x-api/media/quickstart/best-practices)

### 建议的数据表/记录

```text
publisher_connections
  id, owner_id, platform, external_account_id
  encrypted_access_token, encrypted_refresh_token, expires_at, scopes, status

publish_drafts
  id, post_state_id, platform, source_doc_version
  payload_json, approved_snapshot_hash, created_by

publish_attempts
  id, publish_draft_id, idempotency_key, status
  requested_by, requested_at, finished_at, error_code, error_message

publish_attempt_items
  id, attempt_id, client_post_id, sequence
  external_post_id, external_url, status, error_json
```

关键唯一约束：`(connection_id, post_state_id, source_doc_version, platform)` 只能有一个成功发布结果；再次点击发布应返回已有结果，不应创建重复 X thread。

## Typefully API 还是直接 X API

| 方案 | 优点 | 风险/限制 | 建议用途 |
| --- | --- | --- | --- |
| Typefully API | 一套 draft API 已覆盖多平台、媒体、排期、webhook；验证快 | 需要用户已有 Typefully 账号/API key；平台能力受第三方限制；官方不建议拿它承载面向大量外部用户的 X 自动化 | 内部 demo、单一团队工作流、快速产品验证 |
| 直接 X API | 授权、发布状态和数据归 Tutti；适合多创作者 SaaS | 要自行实现 OAuth、token 加密、媒体处理、队列、重试、合规和成本控制 | Tutti 正式 X 发布能力 |

建议决策：**正式能力直接接 X，架构保持 provider 可替换；若需要一周内验证交互，可临时增加 Typefully provider，但不要让 Typefully payload 变成 Tutti 的领域模型。**

## 分阶段交付

### Phase 0：纯 adapter 和预览

- 新增 `@tutti/publish-adapters`。
- 实现 DraftDocJSON 到 X posts/media refs。
- 单元测试覆盖显式分段、媒体归属、空内容、超限和不输出占位符。
- approved 页面展示最终 X thread preview，但不真实发布。

### Phase 1：真实 X 文本/图片发布

- OAuth 2.0 PKCE 连接 X 账号，token 只存宿主后端并加密。
- publish attempt + worker + item checkpoint。
- 文本、图片和 thread reply chain。
- 幂等、防重复点击、部分失败恢复、external URLs 回写。
- `published` 只能由成功 publish attempt 驱动，不能由前端直接 set state。

### Phase 2：排期和视频

- 定时 job、取消排期、时区处理。
- 视频/GIF chunked upload 与 processing poll。
- webhook/状态对账、token 失效重连。

### Phase 3：第二个平台

- 保留 canonical approved snapshot。
- 生成平台 draft，并允许 platform override。
- 在同一个 publish attempt 下记录各平台独立结果，整体允许 partial success。

## 上线前必须确认

- X Developer App、所需 scopes、当前套餐/用量成本和生产限额。
- 发布主体：创作者账号还是品牌账号；谁有最终 publish 权限。
- approved 后是否允许生成 platform override；若允许，修改后是否必须重新品牌审核。
- Thread 的产品分段方式：显式 divider、每段独立 block，还是自动切分。
- 素材来源和下载权限；发布 worker 能否稳定读取原图/视频。
- 失败策略：thread 已发布前两条、第三条失败时，是续发、保留，还是人工删除重发。

## 与当前仓库边界的关系

当前 OpenSpec 明确写了第一版不包含发布 adapter，这次工作属于一个新的 change，不能悄悄塞进 `decouple-ai-draft-review-sdk`：

- `@tutti/draft-doc` 继续只提供共享文档契约。
- 新的纯 adapter 可以依赖 `@tutti/draft-doc`。
- AI/Brand/Creator React 包不持有 OAuth 或调用 X。
- 真实 provider、数据库、队列和状态机属于宿主系统。
- Demo 可以展示 preview 和 callback，但不能用本地 React state 冒充生产发布成功。

