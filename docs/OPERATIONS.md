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

依次执行 `drizzle/0000_public_dexter_bennett.sql`、`0001_tricky_nightcrawler.sql`、`0002_rename_fixed_account.sql`，由迁移工具记录已执行版本；不要在已有生产库重复执行。

- `catalogs`：用户商品 JSON、版本号、更新时间。
- `auth_sessions`：会话令牌的哈希及到期时间。
- `login_attempts`：登录限流记录。

本地开发使用 Vite 配置中的本地 D1 绑定。阿里云部署复用 Worker 构建，通过 Wrangler/Miniflare 的本地 D1 SQLite 存储运行；数据在 `/var/lib/quickprice/v3/d1/`，不依赖原 Sites。此方式沿用了开发运行器，需固定依赖版本；不是云端 D1 托管服务。原 Sites 使用平台提供的真实绑定，配置文件中的占位数据库 ID 不是数据库地址。

## 阿里云运行与发布

- 源码和构建：`/opt/quickprice`、`/opt/quickprice/dist`。
- Node 22.13.1：`/usr/local/node/bin`；应用以独立用户 `quickprice` 运行。
- systemd：`quickprice.service`，开机自启、异常退出重启，监听 `127.0.0.1:3000`。
- Nginx：`/etc/nginx/conf.d/quickprice.conf`，公网 80 反向代理到应用。
- 密码记录：`/etc/quickprice/runtime.env`，权限 `root:quickprice 0640`，通过显式 `--env-file` 加载；不能放进 Git 或构建包。
- 当前 Nginx 配置、兼容脚本、构建快照及备份脚本保存在 `deploy/aliyun/`、`hotfix/`，详见 `deploy/aliyun/README.md`。
- 服务器 glibc 2.32 无法直接执行当前 workerd；独立兼容库在 `/opt/quickprice-glibc/unpack/lib/x86_64-linux-gnu/`。`node_modules/@cloudflare/workerd-linux-64/bin/workerd` 是 loader 包装脚本，实际可执行文件为同目录 `workerd.real`。重新安装 npm 依赖会覆盖包装脚本，需要恢复后再启动；不要替换系统 glibc。

日常检查：

```sh
systemctl status quickprice nginx --no-pager
journalctl -u quickprice -n 80 --no-pager
systemctl list-timers quickprice-backup.timer
curl -I http://127.0.0.1/login
```

这台服务器只有 1 GiB 内存，不要在在线应用旁执行构建。应在本地使用相同锁文件 `npm ci`、`npm run build`，将 `dist` 上传到服务器，再短暂停服务切换目录。macOS 打包用 `COPYFILE_DISABLE=1 tar --disable-copyfile -czf quickprice-dist.tgz dist`，避免 AppleDouble 文件被识别为额外 Worker 模块。发布前执行 `systemctl start quickprice-backup.service`，保留原 `dist` 用于回滚；切换后运行 `systemctl restart quickprice`。不覆盖 `/var/lib/quickprice`、`/etc/quickprice` 或备份目录。

当前数据库最初用完整 198 项快照初始化，此后又经过在线编辑和多次价目表更新。后续发布必须保留服务器现有数据库，不能再次用初始快照覆盖。

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

参考 https://www.okx.com/zh-hans/convert/usdt-to-cny 的公开页面数据，解析 `appState` 中 USDT/CNY 的 `convertInfo.rate`，保留 6 位小数；人民币金额除以该汇率得到 USDT。

服务端短暂缓存 60 秒。页面标注获取时间而非交易所报价时间；获取失败会显示错误，允许手动输入，不冒充最新汇率。第三方页面结构或访问策略变化可能需要维护解析逻辑。

2026-09-29 验收时，上海服务器连接上述 OKX 地址超时，自动汇率接口返回 503；手动汇率和 USDT 报价正常。未以固定数值或其他来源冒充 OKX 最新汇率。

## 服务器每日备份

`quickprice-backup.timer` 每日服务器时间 03:30 后的 5 分钟内执行，错过的任务开机后补执行。脚本使用 SQLite `.backup` 取得包含 WAL 已提交数据的一致快照，并导出商品 JSON，写入 `/var/backups/quickprice/<UTC时间>/`。备份包含完整数据库（包括会话哈希），目录权限仅 root 可读，不能公开或提交 Git。

手动备份：`systemctl start quickprice-backup.service`。恢复时先停 `quickprice`，备份当前状态后，用选定备份替换对应 SQLite 文件并处理原库的 `-wal`、`-shm`，将所有者设回 `quickprice:quickprice`，再启动并登录核对。优先通过商品 API 恢复商品 JSON，可避免恢复旧会话。

备份目前与应用在同一台服务器，不能抵御整机或磁盘丢失；没有自动上传 GitHub，也没有配置自动清理旧备份。

## 备份范围

Git 历史保留此前源码变更及历史商品快照。本次还保存了当前阿里云构建快照与兼容脚本；运行密钥、生产数据库、数据库备份和本地日志未纳入版本库。云端后续编辑不会自动写回 GitHub，需另行导出备份。
