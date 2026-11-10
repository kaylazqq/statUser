# CoLink 话题参与统计

独立只读应用，在话题操作菜单提供“参与统计”。2.0 使用官方 App SDK 0.11.0、Manifest/Events 2.0、Bridge 1.0；不再使用旧 loginCode/session-exchanges 或第三方 Cookie。

## 操作与口径

页面自动连接宿主。点击“统计公共话题”后登录，以**当前安装 A**读取；点击“统计私密话题”后登录并申请 `messages:read-private`，以**当前使用者 U**读取。身份在调用前确定，失败不切换身份。刷新沿用当前授权；失败立即清空旧数字，不显示为零。

服务端逐请求在线鉴权；安装、用户、频道和话题仅采用 SDK 确认的来源，不采用 query/body 自报资源。浏览器只有内存 App 会话；平台 Token、Refresh Token、客户端密钥在服务端加密保存。

| 项目 | 口径 |
| --- | --- |
| 真人成员 | 平台当前话题 participants 接口返回的真人，按 userId 去重；不是在线人数 |
| 发言 Agent | 消息 senderKind=agent，按显示名称去重；同名可能合并 |
| 消息数 | 逐页读取当前话题，按稳定消息 ID 去重；包括其他类型 |
| 真人 / Agent 消息 | 按 senderKind 分类；未知类型单独计数，不猜身份 |
| 一致性 | 实时分页，不是数据库快照；返回 startedAt/computedAt，失败不返回部分统计 |

每个集合最多 1000 页，每页 100；重复游标、异常页和达到上限均失败。只保留本次计数及去重 ID，不持久化正文。并发统计默认上限 32，满时明确返回 429，不建立无界队列；取消后不再发下一页，已发 SDK 请求仍等待其有界超时。两路扫描均结束后才释放名额。

## 安装与本地验证

需要 Node.js >=24.15.0。SDK 生成包不提交，固定版本和 SHA-256；npm 锁文件还校验完整性：

```sh
npm run prepare:sdk
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
docker build -t topic-participant-stats:local .
```

`prepare:sdk` 默认下载官方固定版本包，拒绝重定向和摘要不符。离线构建可显式设置 `COLINK_SDK_SOURCE_ROOT` 为已审核 CoLink checkout，用其唯一分发构建器生成包；仍必须匹配同一个固定归档摘要，不复制 SDK 源码、不使用目录链接。构建镜像前先准备 `.sdk`；镜像按锁安装，运行时不下载。

配置由服务管理器/Secret 注入，不能提交真实配置：

| 变量 | 说明 |
| --- | --- |
| COLINK_ISSUER | 精确可信 HTTPS 平台 origin；API 固定为它的 /api/v1 |
| COLINK_HOST_ORIGIN | 精确可信 HTTPS 网页宿主 origin，不从 URL/referrer 推断 |
| COLINK_APP_ORIGIN | 本应用公开 HTTPS origin；旧配置 COLINK_PUBLIC_ORIGIN 作为别名，二者并存时必须一致 |
| COLINK_APP_ID / COLINK_APP_INSTANCE_ID | 正常登记回执中的应用和部署身份 |
| COLINK_CLIENT_ID / COLINK_CLIENT_SECRET | 仅服务端 OAuth 凭据 |
| COLINK_SIGNING_SECRET | 独立安装通知验签密钥，不能复用客户端密钥 |
| COLINK_STATE_FILE / COLINK_CREDENTIAL_KEY | 独占持久状态路径 / 稳定的 32 字节十六进制加密密钥 |
| STATS_MAX_CONCURRENCY / PORT | 1–256（默认 32）/ 默认 8080 |
| STATS_TELEMETRY_ENABLED | 显式 true 开启内存分段统计；默认关闭。/metrics 仅回环地址可访问 |
| COLINK_ALLOW_INSECURE_ISSUER | 仅本机回环联调 true，不能用于公网 HTTP |

自有接口 `POST /api/v1/topic-stats?mode=public|private` 使用 SDK App 会话 Bearer、精确 Origin 和空 JSON。POST 保证浏览器携带 Origin，满足可信 U 客户端校验；它没有写业务数据。保留 GET 供公共读取；私密 U 调用仍必须具有正确 Origin。匿名、来源缺失、撤权、读取失败不算业务成功。

开启统计时，HTML、登录 start/complete、私密授权 start/complete、统计及退出分别记录完整本端 HTTP 耗时、结果、在途数量和最长驻留。SDK 使用公开 fetcher 注入点观察上游 Token、会话校验、执行查询及 JWKS 的响应头耗时；`*_headers` 不包含响应正文读取或本地验签，不能当成整段兑换耗时，也不能与父阶段直接相加。有限阶段标签不含 URL 参数、用户、消息、凭据或资源 ID；内存缓冲有界，未采集显示未知，不写业务数据库。SDK 的 1000 个事务/会话容量保持原值，监控容量不代表已提高容量。

## 登记、升级和回退

1. 使用**独立实例与独立状态卷/密钥**；模板不是某个现网部署事实，替换 namespace、节点、PVC、镜像和 Service 后再检查差异。
2. 首次登记可显式 `COLINK_BOOTSTRAP=true`，只提供 SDK 官方 bootstrap Manifest 和 awaiting_credentials 健康入口；要求状态文件不存在、没有任何部分身份凭据。不是安装 ready，不开放业务。
3. 正常领取新版部署凭据后停止 bootstrap，注入配置并启动 SDK；完成平台 finalize、项目安装、控制通知和 ready，再做真实业务核验。
4. 旧 Manifest 1.0/长期 appSecret 不兼容新版。保留旧实例和历史；仅在获准实例做正常登记/安装更新，不能把旧授权文件原地当作新版状态。
5. SDK 文件存储只支持单进程独占。模板单副本 Recreate、专用持久卷；不能滚动重叠，也不能多副本共享文件。进程存活不代表安装 ready。
6. 升级/回退前停止当前进程并备份匹配状态、密钥、配置、不可变镜像和平台登记版本。不要删除原状态，不要靠重启丢弃历史；平台授权更新不能仅靠换旧镜像回退。

## 验收边界

`npm test` 覆盖 SDK 方法调用、分页/去重、异常不当零、来源隔离、撤权、A/U 不降级。使用打包后的 Playground `verify` 检查正常安装和浏览器握手，不能直接运行依赖平台 TypeScript 的源码 CLI。

真实平台必须另验：公共/私密话题、使用者不是安装人、已知参与人和消息数、分页、撤权后清空、页面关闭、刷新、重新打开。压测中统计业务成功须核对固定夹具的 topicId 和独立预期计数，不仅看 HTTP 200；协议执行器不能代替真实浏览器初始化及人工已读。
