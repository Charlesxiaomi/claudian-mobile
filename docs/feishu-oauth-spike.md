# 飞书 OAuth 手机端可行性 Spike

**目的**：在写任何工具代码之前，用少量手工操作验证"手机上自足的飞书授权链路"是否成立。
链路断在哪一环，方案就重新设计哪一环。

**背景结论**（方案评审 + lark-cli 源码阅读，2026-08-27）：

- 一期直接做 OAuth（`user_access_token`），跳过 tenant token（应用身份读文档要逐个共享，体验是死路）。
- **lark-cli 的"扫码授权"用的是 OAuth 2.0 设备码流程（RFC 8628），不是授权码+回调**：
  `POST accounts.feishu.cn/oauth/v1/device_authorization` 拿 `device_code` + 授权 URL →
  把 URL 变成二维码给用户扫（或直接打开）→ 用户在飞书 App 里点同意 →
  客户端轮询 `POST open.feishu.cn/open-apis/authen/v2/oauth/token`
  （`grant_type=urn:ietf:params:oauth:grant-type:device_code`）直到拿到 token。
  **全程无 redirect_uri、无回调服务器**——localhost / `obsidian://` / 跳板页问题在此流程下不存在。
- lark-cli 的"一键建应用"同理：`POST accounts.feishu.cn/oauth/v1/app/registration` →
  用户打开授权 URL 点确认 → 服务端建应用 → 轮询收到 `client_id` + `client_secret`。全程不进开放平台后台。
- 网络请求必须走 Obsidian 的 `requestUrl`（webview 里裸 `fetch` 会被 CORS 拦，lint 也会报）。
- 手机场景下不需要真扫码：`verification_uri_complete` 直接作为链接点开即可拉起飞书 App 确认
  （自己扫不了自己的屏幕；二维码只服务"桌面显示、手机扫"的跨设备场景）。

## 主路径 A：设备码流程（唯一成败开关：端点是否对第三方开放）

风险集中在一点：`accounts.feishu.cn/oauth/v1/*` 这组端点目前只见于 lark-cli 源码，
**尚未确认是公开文档化的能力**。可能验 client 来源、UA 或仅对官方应用开放。

### A1 · curl 直测设备授权端点（10 分钟，零代码，桌面即可）

用任意方式先建一个自建应用拿到 app_id（此步只为测试，A3 若通过则正式产品可免）：

```bash
curl -sS -X POST https://accounts.feishu.cn/oauth/v1/device_authorization \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=<APP_ID>' \
  --data-urlencode 'scope=offline_access docx:document:readonly'
```

**通过标准**：返回 JSON 含 `device_code` / `verification_uri_complete` / `interval`。
**失败处理**：记录状态码和 body。404/403 → 端点不对外，转备选路径 B；
参数错误 → 对照 lark-cli `internal/auth/device_flow.go` 修参数再试。
同时在飞书开放平台文档站搜"设备授权 / device authorization"确认是否有公开文档，
有则以文档为准（私有接口随时可能变，公开文档才是长期依赖的底气）。

### A2 · 走通完整设备码链路（手机上，需临时代码）

在插件里加临时命令（测完删除），全部用 `requestUrl`：

1. POST device_authorization（同 A1），拿 `verification_uri_complete`；
2. `window.open(verification_uri_complete)` 或以链接形式展示，点开 → 应拉起飞书 App 授权页 → 点同意；
3. 按返回的 `interval`（默认 5s）轮询：

   ```ts
   const res = await requestUrl({
     url: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
     method: "POST",
     contentType: "application/json",
     body: JSON.stringify({
       grant_type: "urn:ietf:params:oauth:grant-type:device_code",
       client_id: APP_ID,
       client_secret: APP_SECRET,
       device_code: deviceCode,
     }),
     throw: false, // pending 期间可能返回非 2xx，别让它抛
   });
   ```

**通过标准**：点同意后一轮轮询内拿到 `access_token` + `refresh_token`，
再调 `GET /open-apis/authen/v1/user_info` 确认 token 可用。
**同时记录**：token / refresh_token 有效期（决定静默刷新策略）；
scope 是否即 URL 所传（即无需后台预开权限）；哪些 scope 被拒或要求审批。

### A3 · 应用注册端点（决定 onboarding 下限）

```bash
curl -sS -X POST https://accounts.feishu.cn/oauth/v1/app/registration \
  -H 'Content-Type: application/x-www-form-urlencoded' --data ''
```

（请求体参数对照 lark-cli `internal/auth/app_registration.go` 补齐。）

**通过** → 插件内可做到"点一个链接确认，应用自动建好，凭证自动落库"，onboarding 零门槛，
连 app_id/secret 都不用抄。
**失败** → 用户需手动建应用抄凭证（一次性），之后仍走 A2；onboarding 文档写清六步即可。

## 备选路径 B：授权码 + 重定向（仅当 A1 失败时启用）

设备码端点不对外时，退回标准授权码流程，待验证点：

| # | 问题 | 失败的后果 |
|---|------|-----------|
| B1 | 重定向 URL 白名单是否接受 `obsidian://claudian-feishu-auth` | 加 GitHub Pages 纯静态跳板页（无后端），JS 把 `?code=...` 原样转拼到 `obsidian://` 跳转；code 途经公开页面，必须验证并启用 PKCE（`code_challenge`） |
| B2 | 深链能否把 `code` 带回插件（`registerObsidianProtocolHandler`） | 降级为授权页显示 code、用户手动粘贴 |
| B3 | 开放平台后台在手机浏览器能否完成建应用/配置 | onboarding 如实写"首次配置建议在电脑完成" |
| B4 | `requestUrl` 调 `POST /open-apis/authen/v2/oauth/token`（`grant_type=authorization_code`）能否换到 token | 换 token 也得出壳，方案重估 |

授权 URL 参考（参数以[官方文档](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code)为准）：
`https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=...&redirect_uri=...&scope=...&state=...`

## 结果记录（2026-08-27 实测，全链路走通）

| 测试 | 结果 | 备注 |
|------|------|------|
| A1 device_authorization 端点 | ✅ 通过 | **无公开文档**（官方只文档化授权码流程），属"可用但未承诺"接口 |
| A2 完整设备码链路 | ✅ 通过 | access_token 7200s / refresh_token 604800s；refresh_token grant 亦实测可用（返回新 token 对）；user_info 调用成功 |
| A3 应用注册端点 | ✅ 通过 | 手机浏览器确认两步（建应用→安全提示），轮询拿到 client_id/secret；scope 无需后台预开 |
| B1–B4 | 未启用 | A1 通过，无需备选路径 |

### 实测修正与要点（相对本文最初假设）

1. **A1 的 curl 少了认证头**：`device_authorization` 请求需带
   `Authorization: Basic base64(app_id:app_secret)`（lark-cli 实际带了）；
   scope 里没有 `offline_access` 时 lark-cli 会自动补上（没有它就拿不到 refresh_token）。
2. **verification_uri 必须原样使用**：响应里带 `message` 字段明确警告
   "Do not modify, reconstruct, re-encode, append to, or normalize these URLs"。
   larksuite/cli#1004 报的 verify 404 很可能就是自己拼 URL 导致——我们原样打开没有踩到。
3. **注册端点参数**（对照 lark-cli `internal/auth/app_registration.go`）：
   begin：`action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id tenant_brand`；
   轮询：`action=poll&device_code=...`（同一端点）。注意 lark-cli 还有 lark/feishu
   双品牌域名切换逻辑（轮询响应里 `user_info.tenant_brand` 与当前品牌不符时切域名重试），
   国内版可先只做 feishu。
4. **scope 即 URL 所传，自动通过**：`docx:document:readonly` 无需后台预开；
   授权页默认预勾选"附带 Drive/Docs 自动通过权限包"（约 40 项），用户确认后
   token scope 即为全量勾选项 + `offline_access`。
5. **token 轮询**用 form-urlencoded（`grant_type=urn:ietf:params:oauth:grant-type:device_code`），
   pending 时返回 `{"error":"authorization_pending"}`，还有 `slow_down` / `access_denied` /
   `expired_token` 分支；device_code 有效期：注册流程 3600s、授权流程 600s，interval 5s。
6. **尚未在插件内跑过**：本次链路用 curl 验证协议本身；`requestUrl` 发同样的
   form-urlencoded POST 属常规能力，风险低，留到工具开发第一步顺手验证。
7. 测试应用：`小米's AI Assistant`（client_id `cli_aa1aadff4db85d06`），
   凭证在本次会话 scratchpad，未入库；不需要时可在开放平台或
   App Authorization Management 删除/收回。

## 判定

- **A1 + A2 通过** → 最优解成立：无回调、无跳板、无深链，onboarding 对齐 lark-cli；
  A3 再通过则连建应用都免了。直接进入工具开发。
- **A1 通过但仅见于源码、无公开文档** → 链路可用但属未承诺接口，实现时做好失败降级
  （检测到端点 4xx 时引导走路径 B），并在代码里注明来源。
- **A1 失败** → 启用路径 B，按 B1–B4 逐项验证；B1/B2 再失败则降级手动贴 code。

**最终判定（2026-08-27）：A1+A2+A3 全部通过 → 最优解成立，直接进入工具开发。**
同时命中第二条：设备码/注册端点均无公开文档，实现时按"未承诺接口"处理——
检测到端点 4xx/结构变化时给出清晰报错并引导路径 B，代码注明参数来源为
larksuite/cli `internal/auth/{device_flow,app_registration}.go`。
