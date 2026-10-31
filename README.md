# env-vault

给独立开发者用的环境变量与密钥保险柜。公共层、服务器层、项目层合并成生效视图，勾选后复制成 `.env` / JSON / YAML / Docker Compose / shell。云端只存密文。AI Agent 通过 CLI 使用变量，接口不返回明文。

## 本地开发

需要 Node.js 20+ 与 Docker。

```bash
npm install
docker compose up -d && npm run dev
```

另开一个终端，第一次使用云端前执行迁移：

```bash
DATABASE_URL=postgres://envvault:envvault@localhost:5432/envvault npm run db:migrate
```

浏览器打开 http://localhost:3000 。没有 `DATABASE_URL` 时云端 API 返回 `CLOUD_UNAVAILABLE`，本地模式仍可使用。

```bash
npm test
```

## 环境变量

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 云端需要 | Postgres 或 Neon 连接串。不要提交真实值。 |
| `DB_DRIVER` | 否 | `pg` 或 `neon`。URL 含 `neon.tech` 时默认 `neon`。 |
| `DEEPSEEK_API_KEY` | 否 | AI 格式助手。只放在服务端。 |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-v4-flash`。 |
| `DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com`。 |

CLI 额外使用（不写入 Vercel，写在运行 CLI 的机器上）：

| 名称 | 说明 |
| --- | --- |
| `ENV_VAULT_API` | 默认 `http://localhost:3000` |
| `ENV_VAULT_TOKEN` | 签发时只显示一次的令牌字符串 |

## 部署到 Vercel

1. 在 Neon 创建 Postgres，复制连接串。
2. 在本机对那条连接串执行 `npm run db:migrate`。Vercel 构建不会自动建表。
3. 把本仓库导入 Vercel。项目根就是仓库根，框架选 Next.js。
4. 在 Vercel 项目设置里加入上表环境变量。`DATABASE_URL` 用 Neon 的 **pooled** 连接串。不要填写令牌或用户口令。
5. 函数内存建议至少 1024 MB。登录会在服务端用 Argon2id 校验认证密钥。
6. 部署完成后：注册 → 解锁 → 建服务器/项目/变量 → 看生效视图 → 复制五种格式 → 在设置里签发令牌 → 在自己的机器上跑 CLI。

自托管不是本轮目标。原理与 Vercel 相同：Node 上跑 Next.js，前面有 Postgres，密钥仍只在浏览器和 CLI 解开。

## Shell 环境

主屏输出格式在 `.env` 旁边有 Bash/Zsh、Fish、PowerShell、CMD。它们和 JSON / YAML / Compose、内置模板共用同一套渲染器。复制后不要把结果重定向进日志。

在自己的终端里，也可以让 CLI 只把赋值语句打到标准输出（解密发生在本机，服务端仍然只给密文）：

```bash
eval "$(npm run env-vault -- shell --token \"$ENV_VAULT_TOKEN\" --api https://你的域名)"
# 或 fish：
# source (env-vault shell --shell fish | psub)
# PowerShell：
# env-vault shell --shell powershell | Invoke-Expression
```

不写 `--shell` 时看 `SHELL`；没有则看 `PSModulePath`（PowerShell）和 `ComSpec`（cmd），再没有就用 bash。这个命令要求令牌有注入权限，和 `run` 一样是给本人终端用的，不是给 Agent 回传明文的接口。

CMD 的固有限制：`%` 会写成 `%%`（给批处理用，交互式 cmd 不会把它变回单个 `%`）；引号写成成对的 `""`，真实 cmd 不一定能还原；换行、`!` 延迟展开、`& | < > ^` 都不安全。不要把 CMD 输出留在文件或日志里。

POSIX 下也可以不导出再 eval，直接注入子进程：`env-vault run --token "$ENV_VAULT_TOKEN" -- bash -c 'echo "$KEY"'`。

## CLI

```bash
npm run env-vault -- render --token "$ENV_VAULT_TOKEN" --api https://你的域名 --template ./tpl.txt --out ./out.env
npm run env-vault -- run --token "$ENV_VAULT_TOKEN" --api https://你的域名 -- npm test
```

- `render` 在本机替换 `{{vault:KEY}}` 并写入 `--out`。标准输出只有成功与路径，不打印文件内容。缺 key 时退出码 2，只打印 key 名。
- `run` 把生效变量注入子进程，再把 stdout/stderr 里的已知密钥打成 `***`。
- 令牌没有对应权限、已过期或已吊销时，服务端不下发包装密钥。

## 数据与安全模型

口令原文不上传。浏览器用 Argon2id 从口令派生主密钥，再拆成加密密钥和认证密钥。服务端只存认证密钥的 Argon2id 哈希，以及用加密密钥包装过的数据密钥（DEK）。每条变量值、备注、模板正文用 DEK 做 AES-256-GCM。

机器令牌由随机 `authSecret`（服务端只存 SHA-256）和 RSA-OAEP 私钥组成，私钥只在签发时显示一次。服务端保存公钥和被公钥包装的 DEK，因此库泄露也不能解密。CLI 在本地解开。

人工复制、下载、查看明文只发生在已解锁的浏览器里，并写审计。审计保留 180 天，只记动作、作用域、key 名和结果，不记值。本地模式的审计在 IndexedDB。

刷新页面要重新输入口令。没有邮箱验证，也没有找回密码。口令丢失等于数据丢失。

### 威胁模型（不夸大）

防的是：数据库泄露、服务端日志、审计、AI 请求，以及粗心 Agent 从工具输出里看见明文。面向机器令牌的接口没有明文端点；即使用户会话去调 `/api/agent/values`、`/api/export/plaintext` 也会 403。

不防：解锁之后的 XSS、会直接读取本机私钥文件并自己写解密程序的恶意 Agent、用户把真实密钥贴进 AI 样例。样例会按需求送给模型，但不会写入服务器日志。短密钥做子串脱敏时，可能误伤输出里的相同片段。

## 批量导入与转移

粘贴框旁可以一次选择或拖入多个 `.env`、`.json`、`.yaml/.yml` 文件。解析只在浏览器里做，确认前能改每个文件的目标作用域，并看到条数和非法行。同名 key 默认覆盖。确认后提示新增、覆盖、失败的数量，并可一步撤销。单次最多 500 条。

生效列表可以勾选后「转移到…」，每一行也有同样的入口。当前作用域的「···」可以转移该层自己的全部变量。默认是移动，也可以复制；同名默认跳过，也可以覆盖，或保留两者（新 key 加 `_copy` 后缀，避免连字符破坏 key 规则）。云端转移只改密文行的作用域，不解密。版本历史跟着被移动的那条变量走。确认框会提示生效集会变化。

## 界面

单主屏。进来记住上次作用域，看生效集，点复制。有勾选时复制勾选，否则复制当前可见生效集。被覆盖的 key 置灰，不进入输出。低频功能在设置抽屉：模式、作用域排序、令牌、审计、备份、迁云、模板。

桌面优先。窄屏改成上下堆叠，查看、复制按钮保持可见，以便在手机浏览器完成这条动线。

本地模式免账号，但要设本地口令，断网可用。云端模式换浏览器登录后，用同一口令解开同一份密文。本地迁云按名称匹配，同名 key 以本地覆盖云端，确认前只显示数量。
