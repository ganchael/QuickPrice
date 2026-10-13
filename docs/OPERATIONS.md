# 配置、部署与恢复

## 当前服务

- 当前入口：http://106.14.116.244/ （2026-09-29 部署至用户阿里云上海 Linux 服务器）。
- 用户选择先用公网 IP，当前没有 TLS；HTTP 下通过 `hotfix/quickprice-hotfix.js` 提供点击后直接复制的兼容方式，浏览器阻止时仍需手动复制。
- 原 Sites 入口：https://quickprice-assistant.ganchael1.chatgpt.site 。其配置保留在 `.openai/hosting.json`，与新服务器数据不会自动同步。
- D1 绑定：`DB`。
- 应用账号：`888`，商品库归属：`account:888`。
- 必要机密：`QUICKPRICE_PASSWORD_RECORD`，格式为 JSON 对象，含 `salt` 和 `hash`。
- 密码记录使用 PBKDF2-SHA256、100000 次迭代、16 字节随机盐及 32 字节结果，十六进制编码。实现见 `lib/auth-crypto.ts`。

密码与记录应在部署平台的机密设置中配置，不写入 Git。新部署须自行设置密码；仓库不提供生产密码的恢复功能。

## 数据库

新建数据库依次执行 `drizzle/0000_public_dexter_bennett.sql`、`0001_tricky_nightcrawler.sql`、`0002_rename_fixed_account.sql`、`0003_exchange_rate_cache.sql`，由迁移工具记录已执行版本；不要在已有生产库重复执行早期迁移。

`0003_exchange_rate_cache.sql` 使用 `CREATE TABLE IF NOT EXISTS` 创建独立缓存表。已有生产库只需增量执行此迁移；汇率 API 首次读写也会按需创建该表。它不删除或改写商品、会话或限流数据。

- `catalogs`：用户商品 JSON、版本号、更新时间。
- `auth_sessions`：会话令牌的哈希及到期时间。
- `login_attempts`：登录限流记录。
- `exchange_rate_cache`：`USDT-CNY:okx-scheduled-v3` 的成功市场参考汇率、来源及获取时间；用于服务重启后的恢复。旧 `USDT-CNY` 和 `USDT-CNY:market-v2` 记录不再读取。

本地开发使用 Vite 配置中的本地 D1 绑定。阿里云部署复用 Worker 构建，通过 Wrangler/Miniflare 的本地 D1 SQLite 存储运行；数据在 `/var/lib/quickprice/v3/d1/`，不依赖原 Sites。此方式沿用了开发运行器，需固定依赖版本；不是云端 D1 托管服务。原 Sites 使用平台提供的真实绑定，配置文件中的占位数据库 ID 不是数据库地址。

## 阿里云运行与发布

- 源码和构建：`/opt/quickprice`、`/opt/quickprice/dist`。
- Node 22.13.1：`/usr/local/node/bin`；应用以独立用户 `quickprice` 运行。
- systemd：`quickprice.service`，开机自启、异常退出重启，监听 `127.0.0.1:3000`。
- Nginx：`/etc/nginx/conf.d/quickprice.conf`，公网 80 反向代理到应用。
- 密码记录：`/etc/quickprice/runtime.env`，权限 `root:quickprice 0640`，通过显式 `--env-file` 加载；不能放进 Git 或构建包。
- 当前 Nginx 配置、兼容脚本、构建快照及备份脚本保存在 `deploy/aliyun/`、`hotfix/`，详见 `deploy/aliyun/README.md`。
- 服务器 glibc 2.32 无法直接执行当前 workerd；独立兼容库在 `/opt/quickprice-glibc/unpack/lib/x86_64-linux-gnu/`。`node_modules/@cloudflare/workerd-linux-64/bin/workerd` 是 loader 包装脚本，实际可执行文件为同目录 `workerd.real`。重新安装 npm 依赖会覆盖包装脚本，需要恢复后再启动；不要替换系统 glibc。

2026-10-03 已恢复完整新版界面源码，并由本机可读取的 `app/`、`components/` 和样式构建发布。2026-09-30 的 `live-dist-20260930.tgz` 属于历史恢复包，不能代表当前已修复的汇率实现。

2026-10-13 起，手机底栏避让、短屏高度和明文 HTTP 下的复制兼容已经写进应用（`app/globals.css`、`lib/legacy-clipboard.ts`）。站点继续使用明文 HTTP，不要加 TLS、Secure Cookie 或 HSTS。生产仍在跑旧构建时，Nginx 还要注入 `hotfix/quickprice-hotfix.js` 和 CSS。新 `dist` 上传并重启、确认复制和底栏可点之后，再从 `/etc/nginx/conf.d/quickprice.conf` 去掉 `sub_filter` 注入以及 `/quickprice-hotfix.js`、`/quickprice-hotfix.css` 两个 `location`。不要在新构建上线前先删注入。`hotfix/` 留在仓库里作历史记录，不再作为线上布局来源。

### workerd 的系统 CA 配置

兼容 glibc loader 下的 workerd 未自动找到系统证书，曾导致服务器命令行可以访问 CoinGate，而应用内请求因 TLS 校验失败而不可用。已通过 `/etc/systemd/system/quickprice.service.d/ca.conf` 指定实际系统 CA 文件：

```ini
[Service]
Environment=SSL_CERT_FILE=/etc/pki/tls/certs/ca-bundle.crt
```

此处只设置 `SSL_CERT_FILE`；没有设置 `SSL_CERT_DIR`，未散列的证书目录不作为目录信任配置。保持 TLS 证书校验开启，不使用跳过证书校验的启动参数。更新配置后执行：

```sh
systemctl daemon-reload
systemctl restart quickprice
```

部署到其他 Linux 系统时，先核对该系统的实际 CA bundle 路径，不要直接沿用不存在的路径。2026-10-03 已在上海服务器验证经过该配置的应用请求返回 HTTP 200 和 CoinGate 支付换算参考；不依赖客户端 VPN。

日常检查：

```sh
systemctl status quickprice nginx --no-pager
journalctl -u quickprice -n 80 --no-pager
systemctl list-timers quickprice-backup.timer
curl -I http://127.0.0.1/login
```

这台服务器只有 1 GiB 内存，不要在在线应用旁执行构建。应在本地使用相同锁文件 `npm ci`、`npm run build`，将 `dist` 上传到服务器，再短暂停服务切换目录。macOS 打包用 `COPYFILE_DISABLE=1 tar --disable-copyfile -czf quickprice-dist.tgz dist`，避免 AppleDouble 文件被识别为额外 Worker 模块。发布前执行 `systemctl start quickprice-backup.service`，保留原 `dist` 用于回滚；切换后运行 `systemctl restart quickprice`。不覆盖 `/var/lib/quickprice`、`/etc/quickprice` 或备份目录。

2026-09-29 曾从原 Sites 恢复完整 300 项商品库，包含此前网页手动新增的记录；其后继续在线编辑。截至 2026-10-03，本次发布前后核对为 301 项、服务器版本 8。新增汇率缓存表和替换构建没有重置商品库。后续发布必须保留服务器现有数据库，不能再次用初始快照、原价目表或历史备份覆盖。

## 原 Sites 发布流程

原托管方式为 Sites + Cloudflare Worker，不能直接使用 GitHub Pages 托管后端。以下仅用于恢复或维护原 Sites 站点，不会更新当前 IP 入口。

1. 安装依赖，检查类型与相关测试，构建应用。
2. 通过 Sites 的源码仓库同步待发布版本；GitHub 是另一个源码备份远端。
3. 打包构建结果，保存版本并部署至现有 Sites 项目。
4. 等部署成功后验证登录、商品库和汇率功能。

常规构建命令为 `npm run build`；Sites 发布使用对应插件的构建和打包流程，包含 Worker 入口、静态资源、托管配置及迁移。不能仅将源码压缩作为部署包。

## 商品快照与恢复

`data/catalog-2026-09-20.json` 是 2026-09-20 经登录 API 读取的历史快照，包括当时的 198 项商品（版本 10）、归属和更新时间，不含会话。它不包含此后的在线编辑与价目表更新。恢复当前阿里云商品库应优先使用服务器的最新备份；此文件只能用于历史回溯或逐项合并，不能直接覆盖现有商品。

恢复前先备份当前云端数据。登录后调用 `GET /api/catalog` 取得当前 `ownerId`、`revision` 和商品；按名称、规格、单位匹配合并快照，保留当前库里其他商品以及已匹配商品 ID。核对结果后通过 `PUT /api/catalog` 写入：

```json
{
  "ownerId": "account:888",
  "revision": 10,
  "products": []
}
```

上面只是结构示例，不能直接提交空数组。`revision` 必须采用实时读取的值，`products` 必须为经核对的完整合并结果。请求需要有效登录 Cookie、本站 Origin 和 JSON Content-Type；409 表示发生并发修改，应重新读取和合并，不能强制覆盖。写入后再次读取，逐项检查价格、ID 及手动项目是否保留。

## 汇率

浏览器只调用同源 `/api/exchange-rate`；不会直接请求交易所或页面读取代理。所有外部请求由上海服务器处理，客户端无需连接外部行情源。接口需要有效登录，响应使用 `private, no-store`，未经登录返回 401。

.github/workflows/okx-rate.yml 同时支持服务器请求分支的 push、手动 dispatch 和定时取数。服务器主动检查是正常刷新机制，GitHub cron 保留为后备。用户已选择由 GitHub runner 读取欧易。`.github/workflows/okx-rate.yml` 使用 Ubuntu 托管 runner，每小时的 2、7、12……57 分钟读取欧易换算网页使用的公开 JSON：

```
https://www.okx.com/priapi/v3/growth/convert/detail?baseCurrency=USDT&quoteCurrency=CNY
```

`scripts/fetch-okx-rate.mjs` 严格校验业务码、USDT/CNY 币对、原始价格、上游缓存时间和响应大小；每次最多等待 8 秒，最多尝试 3 次，总预算 27 秒。成功后仅更新独立 `rate-feed` 分支的 `okx-usdt-cny.json`，不修改 main、商品数据或机密。失败时任务报告失败，旧报价文件和获取时间保持不变。JSON 保留 `rawRate` 原始精度，展示与计算使用舍入后的 6 位小数 `rate`；获取时间不是市场成交时间。该官网内部接口可能变化，失败必须保留明确的缓存状态，不能改用 USD/CNY 或假设 USDT=USD。

上海主站依次读取 GitHub raw 文件与 GitHub Contents API 的 raw 响应；固定仓库、文件和分支，每个通道最多等待 1.8 秒，严格校验来源、币对、价格精度和获取时间。两个域名网络路径不同，读取同一份欧易数据；不会把主站读取时间替换成欧易实际获取时间。API 后备使用匿名访问，有 GitHub 限流，因此优先使用 raw 文件。欧易报价达到 10 分钟未更新时优先获取新的 KuCoin 后备，并明确标注实际来源和欧易延迟原因；后备失败时将原欧易报价标为 `kind: stale`，最多使用 24 小时内的值。读取失败且欧易缓存达到 10 分钟，或没有可用欧易报价时，请求 [KuCoin EU USDT/CNY](https://api.kucoin.eu/api/v1/prices?base=CNY&currencies=USDT) 作为明确标注的后备，最多等待 4 秒。所有渠道失败且没有缓存时返回 503，支持手动填写。

GitHub 计划任务可能排队延迟，不能保证每 5 分钟准时执行。线上曾发现 cron 的实际间隔长达数小时，因此不能把 cron 表达式视为执行频率。现由服务器每 2 分钟检查，欧易报价达到 4 分钟时通过 `rate-refresh` 分支推送请求，触发 runner 补取。页面显示服务器检查频率、10 分钟过期保护及真实获取时间；不承诺 GitHub 排队或网络故障时也能保证 10 分钟内取得欧易报价。持久缓存读写各最多等待 150 毫秒，前端等待本站响应最多 9 秒。USDT 先按人民币单价换算并四舍五入到 0.01，行金额为该单价乘以数量，报价合计为各行 USDT 之和；复制文本、页面“折合”和 CSV 使用同一算法。人民币仍按分计算，行金额为单价乘数量，合计为各行之和。复制和导出使用当前输入框中的同一汇率与实际来源。参考价与 P2P 商家买卖成交价并不相同。

手动触发和排查：

```
gh workflow run okx-rate.yml --ref main
gh run list --workflow okx-rate.yml --limit 5
```

查看最近成功任务和 `rate-feed` 文件的 `fetchedAt`；任务失败时检查公开接口结构或可达性。任务需要仅限该 job 的 `contents: write`，Action 固定为官方版本 SHA；不上传服务器密码或个人 Token。服务器主动补取使用用户明确批准的专用仓库写入 deploy key，权限不能限定到单个分支，私钥仅 root 可读；该脚本只推送专用 `rate-refresh` 分支。GitHub 对长期无活动的公开仓库可能停用计划任务，届时需要重新启用工作流。

“行情来源”在新标签页打开对应供应商的前端页面：KuCoin 使用 [中文 USDT 行情页](https://www.kucoin.com/zh-hant/price/USDT)，OKX 使用上述 USDT/CNY 换算页。KuCoin 官网默认美元计价，`/converter/USDT-CNY` 目前返回 404，价格页 `?currency=CNY` 参数实测不会切换计价货币，因此不使用这些地址冒充人民币页面。接口地址仍用于取数和缓存校验，展示链接单独映射到网页，不影响汇率数值。

成功结果在服务内缓存 60 秒；点击“最新”调用 `/api/exchange-rate?refresh=1`，绕过一分钟缓存重新读取已经发布的报价，不会立即触发 GitHub 任务。并发刷新合并为一次上游请求。页面可见时每 60 秒读取同源接口，恢复前台立即读取；到欧易获取时间满 10 分钟时主动标记缓存。手动修改会取消当前页面请求并暂停自动覆盖，有效汇率写入本机 `quickprice:manual-usdt-cny-rate:v1`，刷新后恢复。按钮在手动状态下显示“恢复自动”，点击后清除该记录并重新读取行情。迟到结果不会覆盖手动值。

成功参考汇率写入独立 `exchange_rate_cache` 表，并保存在当前浏览器。服务器与浏览器只接受最多 24 小时的有效缓存，校验来源白名单和时间。2026-10-10 服务端缓存键升级为 `USDT-CNY:okx-scheduled-v3`，浏览器继续使用 `quickprice:last-usdt-cny-market-rate:v2`，两端均拒绝 CoinGate 来源。服务重启会从 D1 读取成功值；`delivery: scheduled` 保留定时抓取来源及时间，延迟或失败时明确标注缓存。没有可用缓存时返回 503，允许手动输入；不会凭空填入固定汇率或将过期值宣称为最新。

2026-10-03 曾使用 CoinGate 国内访问后备；2026-10-10 核实它的原始响应仅为 `6.7`，显示补齐为 `6.700000`，故停用。替代源在上海服务器无代理直连测试 HTTP 200，原始 USDT/CNY 为 `6.6962679300000000`，USDT/USD 为 `0.9991000000000000`。数值仅为当次验收记录，不是默认值；证书配置见上面的系统 CA 部分。

## 欧易汇率主动检查

`deploy/aliyun/rate-watchdog.py` 使用 Python 3.6 标准库和系统 Git，保留 HTTPS CA 校验和 SSH 主机密钥校验，不依赖客户端 VPN。`quickprice-rate-watchdog.timer` 开机后执行，并每 2 分钟检查固定 GitHub 文件；报价达到 4 分钟时推送刷新请求，两次尝试至少相隔 4 分钟。满 10 分钟或通道不可用时，service 返回失败并在 journal 记录 ALERT，下个 timer 周期继续检查。

运行路径：

- 脚本：`/opt/quickprice/deploy/aliyun/rate-watchdog.py`。
- 私钥：`/etc/quickprice-rate-watchdog/github_ed25519`，目录 0700、文件 0600、root:root，网站进程不能读取。
- 主机校验：同目录 `known_hosts`，root:root 0600，固定 GitHub 官方 Ed25519 公钥并使用 `HostKeyAlias=github.com`。
- 状态：`/var/lib/quickprice-rate-watchdog/status.json`，目录 0700、文件 0600，保存真实报价时间、检查结果和触发尝试时间。
- SSH 连接：`ssh.github.com:443`，不关闭校验，不使用服务器密码登录 GitHub。

脚本下载最新 main 的树，仅加入 `.rate-refresh-request.json` 请求文件；提交保留旧请求分支父链，通过普通快进 push 更新 `rate-refresh`。不 force push，不改 main 或 rate-feed，不接触商品、登录和汇率数据库。工作流始终 checkout main 执行经审查的取数代码，不执行请求文件中的命令。raw CDN 数据达到 4 分钟时也读 Contents API，选择获取时间较新的一份。整次检查预算 60 秒，每个 Git 和 HTTP 操作有独立超时。GitHub 写 deploy key 只限此仓库，但不是分支级权限；撤销时在仓库 Deploy keys 删除对应公钥，并停用检查 timer。

检查和恢复：

```sh
systemctl list-timers quickprice-rate-watchdog.timer
systemctl status quickprice-rate-watchdog.timer quickprice-rate-watchdog.service --no-pager
journalctl -u quickprice-rate-watchdog.service -n 30 --no-pager
cat /var/lib/quickprice-rate-watchdog/status.json
systemctl start quickprice-rate-watchdog.service
```

检查 `ageSeconds`、`triggerRequestedAt`、真实 `fetchedAt` 与 GitHub push 任务是否成功。触发任务成功不等于取得报价；应再次核对 `rate-feed/okx-usdt-cny.json` 的真实 `fetchedAt`。不可用时保留原报价时间并提示缓存或明确来源的后备，不能通过更新时间伪装新鲜度。

## 服务器每日备份

`quickprice-backup.timer` 每日服务器时间 03:30 后的 5 分钟内执行，错过的任务开机后补执行。脚本使用 SQLite `.backup` 取得包含 WAL 已提交数据的一致快照，并导出商品 JSON，写入 `/var/backups/quickprice/<UTC时间>/`。备份包含完整数据库（包括会话哈希），目录权限仅 root 可读，不能公开或提交 Git。

手动备份：`systemctl start quickprice-backup.service`。恢复时先停 `quickprice`，备份当前状态后，用选定备份替换对应 SQLite 文件并处理原库的 `-wal`、`-shm`，将所有者设回 `quickprice:quickprice`，再启动并登录核对。优先通过商品 API 恢复商品 JSON，可避免恢复旧会话。

备份目前与应用在同一台服务器，不能抵御整机或磁盘丢失；没有自动上传 GitHub，也没有配置自动清理旧备份。

## 备份范围

Git 历史保留此前源码变更及历史商品快照。仓库还保存阿里云部署配置、历史构建恢复包与兼容脚本；运行密钥、生产数据库、数据库备份和本地日志未纳入版本库。云端后续编辑不会自动写回 GitHub，需另行导出备份。

### 2026-10-12 主动刷新验收

- systemd 239 已验证检查 service/timer 指令兼容；timer 每 2 分钟运行、开机启用。
- 两次服务器普通 push 触发工作流均成功：真实获取时间为上海时间 01:13:32、01:19:38，间隔约 6 分钟；取数任务分别约 13 秒和 12 秒完成。时间仅为当次验收，不是固定报价或未来执行保证。
- 77 项测试通过（2 项需要独立本地集成环境的测试跳过）、类型检查和构建通过；手机 375×667 的自动轮询、手动保护、点击最新恢复、10 分钟过期提示和迟到响应保护通过。手机和桌面 HTTP 复制、CSV USDT 换算验收通过。
- 发布前后商品 301 条、版本 8，排序后的商品 JSON SHA-256 均为 `4131bd0275f005d961034455a113a2386aca3dcba5f7c5c7b9b931867771d235`。
- 旧构建备份：`/var/backups/quickprice/okx-feed-20261011T171342Z`；数据库另由现有备份 service 生成私有备份。专用私钥 0600、目录 0700，已验证网站用户不能读取。
- 当前聊天另设每 10 分钟一次的 Codex 巡检，健康状态保持安静，只报告持续异常或恢复。此本机巡检依赖电脑与应用运行；服务器的 2 分钟检查独立运行。
