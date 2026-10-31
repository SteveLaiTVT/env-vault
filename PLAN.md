# env-vault 实现计划

依据 `REQUIREMENTS.md`、`QUESTIONS.md` 默认答案与 `ANSWERS.md`（Q1–Q21 同意；Q22 补充移动端必须能看生效集、复制、查看明文；Q17 审计 180 天、本地审计存浏览器）。

## 架构

单仓 Next.js（App Router）+ TypeScript + Tailwind。仓库根即 Vercel 项目根。无 Redis、无队列、无组织逻辑。

```
浏览器 / CLI                         Vercel（Next.js Node 运行时）
  Argon2id + AES-256-GCM               只存密文、盐、哈希、公钥、包装后的 DEK
  明文与主密钥只在内存                  无明文接口
        |                                      |
        +-------- HTTPS 密文 + 元数据 ---------+
                                              Neon Postgres（DATABASE_URL）
```

- **本地模式**：无账号。首次设置本地口令。密文与盐放 IndexedDB。服务器零存储。断网可用。不含机器令牌。
- **云端模式**：邮箱 + 口令注册登录。换浏览器靠同一口令解开同步来的密文。刷新后会话还在，但必须重新输入口令解锁。
- **CLI `env-vault`**：`render` / `run`。用机器令牌向 API 取包装 DEK 与密文，在本机解密、合并、写文件或注入子进程。输出脱敏。不把填充结果当 API 响应返回。

### 密钥分层（零知识）

1. 随机 16 字节 `kdfSalt`。生产 KDF：Argon2id，memory 19456 KB，iterations 2，parallelism 1。
2. `master = Argon2id(口令, kdfSalt)`。口令原文永不上传。
3. HKDF-SHA256 拆分：`encKey`（info `env-vault-enc-v1`）与 `authKey`（info `env-vault-auth-v1`）。只有 `authKey` 上传。
4. 服务端用独立盐对 `authKey` 再做 Argon2id，只存哈希。
5. 随机 32 字节 DEK 加密每条值（及备注、模板正文）。DEK 由 `encKey` 用 AES-256-GCM 包装后存为 `wrappedDek`。改口令只重包 DEK（本轮 UI 不提供改口令；结构支持）。
6. 机器令牌：RSA-OAEP-2048 公钥包装同一 DEK。私钥与 `authSecret` 只在签发时组成令牌字符串显示一次。服务端存 `SHA-256(authSecret)` + SPKI 公钥 + 包装 DEK，不存私钥。
7. 令牌调用：`Authorization` 不使用。CLI POST `publicId` + `authSecret` + `op`。权限不足则 403 且不下发包装 DEK。服务端因此不能解密，权限在「给不给包装材料」上可执行。

口令最少 10 位。无邮箱验证、无找回。丢失口令即丢数据。

### 合并

项目 > 关联服务器（排序靠后者覆盖靠前者）> 公共。查看服务器只合并公共+该服务器。查看公共只显示公共层。被覆盖项置灰，不进生效集输出。

### 威胁模型（README 同文，不夸大）

- 防：库泄露、服务端运维、日志/审计/AI 请求、Agent 工具输出里出现明文。
- 不防：解锁后的 XSS、拿到本地私钥文件并自行实现解密的恶意 Agent、用户把密钥写进 AI 样例（UI 会警告，样例仍会按需求送给模型，但不写日志）。
- 机器接口不存在明文端点；即使用户会话调用这些路径也 403。

## 数据库表

| 表 | 要点 |
| --- | --- |
| `users` | email、kdf 参数与盐、auth 盐与哈希、wrappedDek、dekIv、可空 `org_id`（不用） |
| `sessions` | 会话随机串的 SHA-256，7 天过期，cookie `ev_session` httpOnly |
| `servers` | user 内 name 唯一，note，时间，可空 org_id |
| `projects` | 同上 |
| `project_servers` | project_id + server_id + sort_order |
| `variables` | scope public/server/project，key 在作用域内唯一，value/note 密文，type secret\|plain，可空 org_id |
| `variable_versions` | 最近 10 条密文版本，actor |
| `audit_logs` | action、result、scope、key 名、token_id、白名单 meta。禁止值。保留 180 天 |
| `machine_tokens` | 名称、publicId、authSecret 哈希、公钥、wrappedDek、单作用域、can_inject/can_replace、过期、吊销 |
| `templates` | 名称 + 模板正文密文（防误存值） |

无 DATABASE_URL 时云端 API 返回 503 `CLOUD_UNAVAILABLE`，本地模式仍可用。

驱动：URL 含 `neon.tech` 或 `DB_DRIVER=neon` 时用 `@neondatabase/serverless` HTTP；否则 `pg`（本地 Docker Postgres）。迁移脚本走 TCP（`pg`），在部署前于本机对 Neon 连接串执行。

## API 表面

通用错误：`{ error, message }`，message 为固定中文，不回显值或请求体。

### 账号（会话，不返回明文变量）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 邮箱、authKey、kdf、wrappedDek。设会话 |
| POST | `/api/auth/prelogin` | 按邮箱返回 kdf 盐与参数。未知邮箱 404 |
| POST | `/api/auth/login` | 校验 authKey 哈希，设会话，返回 wrappedDek（仍是密文） |
| POST | `/api/auth/logout` | 清会话 |
| GET | `/api/auth/session` | 是否登录、邮箱、kdf、wrappedDek。不含明文 |

### 保险库（会话，全程密文）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 作用域、变量密文、版本、模板密文 |
| POST/PATCH/DELETE | `/api/servers`、`/api/servers/:id` | 服务器 CRUD |
| POST/PATCH/DELETE | `/api/projects`、`/api/projects/:id` | 项目 CRUD，body 含有序 serverIds |
| POST/PATCH/DELETE | `/api/variables`、`/api/variables/:id` | 变量密文 CRUD。更新时把旧密文推进版本并裁到 10 |
| GET | `/api/variables/:id/versions` | 密文版本列表 |
| POST | `/api/variables/:id/restore` | 用指定版本密文覆盖，不解密 |
| POST/DELETE | `/api/templates`、`/api/templates/:id` | 模板密文 |
| POST | `/api/migrate` | 按名称匹配作用域，同名 key 以请求中的密文覆盖。返回数量，不返回值 |
| POST | `/api/audit` | 客户端动作（查看、复制、下载、备份）。meta 白名单过滤 |
| GET | `/api/audit` | 分页，顺带删除 180 天前记录 |

### 机器令牌

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/tokens` | 列表 / 签发。响应只含一次用的令牌字符串（由客户端组好后自己展示；服务端不回显私钥）。创建 body 含公钥、wrappedDek、authSecretHash、publicId |
| POST | `/api/tokens/:id/revoke` | 吊销 |
| POST | `/api/agent/material` | 令牌 + op。校验哈希、过期、吊销、权限、作用域。返回包装 DEK + 各层密文 + key 名。**无值字段** |
| GET/POST | `/api/agent/values` | **永不返回明文，403 `PLAINTEXT_FORBIDDEN`** |
| GET | `/api/agent/plaintext` | **同上** |
| GET | `/api/variables/:id/plaintext` | **同上**（即使用户会话） |
| POST | `/api/export/plaintext` | **同上** |

人工导出只在浏览器解密后复制/下载，不经上述路径。

### 其他

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ai/template` | 代理 DeepSeek。只转发 description、sample、key 名。无密钥则 503 |
| GET | `/api/health` | `{ ok, cloud }`，不回显连接串 |

## 页面结构

单路由 `/`。深色、中文、等宽 key。

- 顶栏：产品名、模式、锁定、设置。
- 未解锁：同一背景上的登录/设口令卡（不是营销站）。云端未配置数据库时说明并留在本地模式。
- 主屏（`lg` 双栏，窄屏上下堆叠，复制/查看按钮始终可见）：
  1. 作用域选择（记住上次）+ 搜索（key 与备注）
  2. 粘贴框 → 解析预览 → 确认入库 → 一步撤销
  3. 生效列表：勾选、来源、打码、查看（确认弹窗）、行内历史恢复、单条增删改
  4. 输出：五种格式 + 三个内置模板 + 我的模板；实时预览；**复制**（有勾选则子集，否则整组生效集）、下载、复制占位模板
- 设置抽屉：账户与模式、作用域与排序、令牌、审计、备份导入导出、迁云、我的模板。

移动浏览器不做专项视觉，但核心动线（选作用域、看生效集、复制、查看明文）必须能点完。

## 输出与 CLI

- `.env` / JSON 扁平对象 / YAML 扁平映射 / Compose `services.app.environment` 片段 / `export KEY='...'`。
- 占位符仅 `{{vault:KEY}}`。K8s Secret 在客户端填充时 base64。
- CLI：`npm run env-vault -- render --template f --out f` 与 `npm run env-vault -- run -- cmd`。令牌来自 `--token` 或 `ENV_VAULT_TOKEN`，API 来自 `--api` 或 `ENV_VAULT_API`。缺失 key 只打印 key 名，退出码 2，不写文件、不启动子进程。`run` 捕获 stdout/stderr 后脱敏再打印。

## 环境变量

| 名称 | 说明 |
| --- | --- |
| `DATABASE_URL` | Postgres/Neon 连接串。缺省则仅本地模式 |
| `DB_DRIVER` | 可选 `neon` 或 `pg`，默认识别 URL |
| `DEEPSEEK_API_KEY` | 可选。缺省则 AI 不可用 |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-v4-flash` |
| `DEEPSEEK_BASE_URL` | 可选，默认 `https://api.deepseek.com` |

## 里程碑

1. **核心库**：合并、格式、dotenv、加解密、脱敏、备份 diff、令牌策略。Vitest 通过并提交。
2. **数据与 API**：Drizzle schema、迁移、认证、CRUD、审计、明文拒绝路由。提交。
3. **工作台**：本地模式全流程 + 云端同步 UI。提交。
4. **令牌与 CLI**：签发、material、render/run、脱敏。提交。
5. **AI、README、构建**：代理、部署说明、威胁模型、`next build` 与测试通过。提交。

## 实现中裁定

1. 令牌认证用高熵 `authSecret` 的 SHA-256，而不是签名挑战。私钥只参与 RSA-OAEP 解包，不上传。少一轮状态，仍然零知识；权限靠「拒绝下发 wrappedDek」执行。
2. 备注与模板正文同样 AES-GCM 加密。搜索在解锁后的客户端做。key 名明文，供审计、缺失 key 与合并。
3. 未知邮箱 prelogin 返回 404，换明确中文错误（个人工具，接受枚举）。
4. 会话 7 天。加密密钥只放内存，不进 localStorage / sessionStorage。
5. 主按钮「复制」：有勾选复制子集，否则复制整组生效集，保证 3 步。
6. 粘贴先预览再确认（Q21）。非法行标行号。只撤销最近一批。
7. 值最长 64KB，备注 2000 字，key 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。
8. 审计 meta 只允许 `format`、`count`、`missingKeys`、`op`、`reason`、`imported`、`overwritten`。出现 `value` 等字段直接丢弃。
9. 备份文件含 kdf 参数与 wrappedDek，变量仍是 DEK 密文。导入时用备份口令解开再重加密进当前库。迁云按名称匹配，本地覆盖云端，确认前只显示数量。
10. 服务端 Argon2id 校验的是 authKey 不是口令。生产参数与客户端一致。测试可注入小内存 KDF 参数（只影响单测速度，不降低线上参数）。
11. Compose 片段服务名固定 `app`。
12. AI 样例原样转发（需求允许贴样例）但不写入日志；UI 警告不要包含真实值。key 名不合法则 400。
13. 本地模式不做机器令牌与 CLI 解锁。CLI 只对云端 API。
14. 移动端用单栏堆叠 + 全宽主按钮，不用 hover 才出现的操作。
15. 迁移用手写 SQL（`npm run db:migrate`），不引入 drizzle-kit。
16. AI 代理必须已登录，避免把部署上的模型密钥变成公开代理。本地模式若浏览器里仍有云端会话，可以调用；否则提示先登录。完全断网时只用内置模板。
17. 令牌使用审计把涉及的 key 名放在 meta.keys（仍不是值）。
18. 搜索过滤后，未勾选时「复制」复制当前可见生效集，而不是被搜索藏起来的项。
19. 切换本地/云端会锁定，避免两套 DEK 在内存里混用。
20. CLI `render` 的标准输出不包含填充后的文件内容，只报告成功和路径。
21. 增补 1 的文件导入只在客户端解析 `.env` / 扁平 JSON / 扁平 YAML。JSON 的数字和布尔转成字符串；对象、数组和嵌套 YAML 记为非法行。未知扩展名整文件失败。超过 500 条有效记录则阻止确认。
22. 保留两者的后缀用 `_copy`、`_copy2`，不用文档里的 `-copy`。已确立的 key 规则不允许连字符，带连字符的 key 无法输出成合法 env。
23. 移动覆盖时删除目标行，再把源行改到目标作用域；源行 id 不变，版本历史随该 id 走。复制不复制版本。复制覆盖只把源密文写到目标行，覆盖前的目标密文进入目标的版本历史。
24. 转移到同一作用域且 key 不变视为跳过。勾选置灰项只用于转移，不改变「复制输出只认生效项」的规则。
25. 批量导入审计动作是 `import`，按目标作用域各记一条，meta 含 imported / overwritten / failed / keys。转移审计动作是 `transfer`，含 source、target、mode 和计数。值仍不进审计。
26. Bash 与 Zsh 共用 POSIX 单引号渲染。旧格式 id `shell` 仍等价于 bash，界面改显示 Bash / Zsh。
27. `env-vault shell` 要求 inject 权限，只把赋值语句写到 stdout，不写日志或文件。探测顺序是 `SHELL`，然后 `PSModulePath`，然后 `ComSpec`，最后默认 bash。
28. PowerShell 把换行写成 `` `n `` / `` `r ``，否则一条赋值语句无法还原原值。
29. CMD 把 `%` 写成 `%%`、`"` 写成 `""`。README 写明交互式 cmd、换行、延迟展开和特殊符无法安全还原。
