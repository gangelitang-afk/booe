# booe
网站维护

## 知识库问答

入口在「实验室」。Cloudflare Worker 在服务端校验访问密码，通过后签发一小时会话。每个问题为独立的 WeKnora 会话，只检索配置的知识库。

在 Cloudflare 的 `booe` Worker 中配置以下值。密码、会话签名密钥和 API 凭据使用 Worker Secrets。

| 名称 | 用途 |
| --- | --- |
| `KNOWLEDGE_PASSWORD` | 页面访问密码 |
| `KNOWLEDGE_SESSION_SECRET` | 独立生成的随机会话签名密钥 |
| `WEKNORA_ORIGIN` | Worker 能访问的 WeKnora HTTPS 源站，仅填协议和域名 |
| `WEKNORA_KB_ID` | 允许网站检索的知识库 ID |
| `WEKNORA_API_KEY` | 有权访问指定知识库并调用聊天和会话接口的 WeKnora API Key |
| `WEKNORA_ACCESS_ID` / `WEKNORA_ACCESS_SECRET` | 使用 Cloudflare Access 服务令牌保护源站时的凭据 |

WeKnora 部署在 Windows 本机时，可通过 Cloudflare Tunnel 将受 Access 服务策略保护的 HTTPS 源站反向代理到本机的 `8080` 端口。保持电脑、Docker 和隧道运行。Worker 限流绑定需要 Wrangler 4.36 或以上。

配置后测试错误密码、绕过解锁直接调用问答接口，以及能引用已知文档的一道问题。
