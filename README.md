# CoLink 话题参与统计

只读的 CoLink Applet。在话题标题栏通过 `colink.topic.actions` 提供“参与统计”按钮，统计真人成员、发言 Agent 与消息数量。

## 统计口径

- 真人成员：`GET /api/v1/topics/{id}/participants` 返回的启用真人成员，按 `userId` 去重。
- 发言 Agent：当前 Topic 消息中 `senderKind=agent` 的作者。平台暂未返回稳定 Agent ID，因此按 `senderName` 去重。
- App Token 只保存在服务端内存会话中，浏览器只持有 HttpOnly Cookie；不保存消息正文。

## 本地运行

需要 Node.js 20 或更新版本。

```powershell
$env:COLINK_PLATFORM_ORIGIN='https://colink.example'
$env:COLINK_HOST_ORIGIN='https://huawei-colink.com'
$env:COLINK_PUBLIC_ORIGIN='http://127.0.0.1:8080'
$env:COLINK_APP_ID='local-app-id'
$env:COLINK_APP_SECRET='local-secret'
$env:SESSION_COOKIE_SECURE='false'
npm start
```

```powershell
npm test
npm run check
docker build -t topic-participant-stats:local .
```

## 配置

| 变量 | 说明 |
| --- | --- |
| `COLINK_PLATFORM_ORIGIN` | CoLink API Origin，不能来自页面输入 |
| `COLINK_HOST_ORIGIN` | 允许嵌入页面的 CoLink 精确 Origin |
| `COLINK_PUBLIC_ORIGIN` | App 对外 HTTPS Origin |
| `COLINK_APP_ID` | CoLink 导入流程生成的 App ID |
| `COLINK_APP_SECRET` | CoLink 导入流程一次性领取的长期密钥 |
| `SESSION_COOKIE_SECURE` | 生产必须为 `true` |

## 部署

1. 创建 `colink-apps` Namespace，或统一替换 `deploy/` 中的命名空间。
2. 构建不可变镜像并推送 SWR。
3. 将 `deployment.yaml` 中的节点名替换为 `172.31.0.71` 对应的 Kubernetes node name。
4. 在集群外安全创建 Secret；不要提交真实值。
5. 应用 ConfigMap、Secret、Deployment 和 NodePort Service。
6. 在现有 ELB 增加 HTTPS 32000 监听器，后端为 `172.31.0.71:32000`，健康检查 `/healthz`。
7. 用 `https://<应用域名>:32000/manifest.json` 导入 CoLink，并批准 `messages:read`、`users:read`。

CoLink 主站使用 HTTPS，因此不能把 HTTP NodePort 地址直接配置成浏览器页面地址；TLS 应在 ELB 终止。
