# 交接：phase1 修复（grok/phase1-fixes）

给接下来接手这个仓库的代理。原 phase1 开发阶段未获生产部署授权；2026-10-14 用户已授权 Codex 部署，验收记录见文末。后续生产变更仍须依据用户授权，并保留 `/var/lib/quickprice` 和运行机密。

## 这次改了什么

分支从 `origin/main`（`e0811f6`）切出，不包含 `grok/phase1-review` 的审查文档。审查 PR 仍是 https://github.com/ganchael/QuickPrice/pull/1 。

按 phase1 审查修复，**故意不做 HTTPS**。没有 TLS Nginx、没有 `Secure` Cookie、没有 `X-Forwarded-Proto` 改动、没有 HSTS。站点继续明文 HTTP。

1. 手机底栏不再挡住复制 / 导出 / 汇率按钮。避让规则在 `app/globals.css` 末尾（`z-index: 41`，一般手机 `bottom: 68px`，短屏 `50px`）。桌面 `min-width: 741px` 用固定的 `.quote-actions`，1440×900 首屏能点到按钮。
2. 明文 HTTP 的复制兼容在 `lib/legacy-clipboard.ts`，页面加载时安装。浏览器不允许时仍弹出手动复制框。
3. CSV 单价先 trim，再格式化成恰好两位小数。
4. USDT：人民币单价四舍五入到 0.01 USDT，行金额 = 该单价 × 数量，报价合计 = 各行 USDT 之和。复制文本、页面“折合”和 CSV 同一算法。人民币仍按分，行 = 单价 × 数量，合计 = 各行之和。例：75.50 元 × 2、汇率 7.2 → 单价 10.49 USDT、行 20.98（不是把 151 元整行换算成 20.97）。三条 0.01 元、汇率 2 → 合计 0.03（不是把 0.03 元总额换算成 0.02）。
5. 商品库每行有删除。确认后走现有 `PUT /api/catalog`，带当前 `revision`。冲突仍是 409，不强制覆盖。已生成的报价保留当时单价。
6. 手动汇率写入 `localStorage` 键 `quickprice:manual-usdt-cny-rate:v1`。刷新后恢复，按钮变成“恢复自动”。点击后清除记录并重新读行情。空输入清除记录；无效的半截输入保留上一次有效值。
7. `npm test` 在 Node 22.14 使用 `node --experimental-strip-types --test tests/*.test.mjs`。
8. 安全响应头：`Content-Security-Policy`（含 `frame-ancestors 'none'`、`connect-src 'self'`）和 `X-Frame-Options: DENY`。开发环境额外允许内联脚本、`unsafe-eval` 和 `ws:`/`wss:`。没有 HSTS。

`hotfix/` 仍留在仓库作历史恢复记录。2026-10-14 新 dist 已上线并验收，Nginx 注入已撤下。

## 2026-10-13 实测

`npm test`（Node v22.14.0）：84 通过，2 跳过，0 失败。`npx tsc --noEmit` 通过。浏览器没有注入 hotfix。

- 桌面 1440×900：复制、导出、恢复自动的底边都在 863px 以内，`elementFromPoint` 命中按钮本身。手动汇率 7.2 刷新后仍在，按钮为“恢复自动”。示例里把第一行数量改为 2 后，页面折合 23.76 USDT（10.49×2 = 20.98，0.01 元五行换算为 0.00，10 元两行 2.78）。
- CSV 带 UTF-8 BOM。单价 `75.50`，USDT 单价 `10.49`，行金额 `20.98`。`=1+1` 仍被加引号前缀。
- 点“恢复自动”后汇率回到已发布的 `6.686698`，按钮变回“最新”。`/api/exchange-rate` 为 200 JSON。
- 375×667、`pointer: coarse`：底栏 `bottom: 50px`、`z-index: 41`，三个按钮都点得到。
- 390×844：底栏 `bottom: 68px`、`z-index: 41`，三个按钮都点得到。
- 删除确认后商品从 4 条变为 3 条。这是本机 D1，不是生产库。
- 响应头有 CSP（`frame-ancestors 'none'`、`connect-src 'self'`）和 `X-Frame-Options: DENY`，没有 `Strict-Transport-Security`。

截图和当次 JSON 在 `docs/fixes/`。

## 怎么测

本地账号只放在 gitignore 的 `.dev.vars`，不要提交。开发服务实际听在 IPv6 `localhost`（`::1`），`127.0.0.1` 会拒绝连接。

```sh
npm test
npx tsc --noEmit
```

`npm test` 预期：全部通过，2 项跳过（商品库 API 集成需要 `QUICKPRICE_TEST_URL` / 密码；参考 xlsx 需要 `QUICKPRICE_REFERENCE_XLSX`）。仓库里没有测试 CI，只有 `.github/workflows/okx-rate.yml` 行情任务。

浏览器（不要注入 hotfix CSS）：

- 桌面 1440×900：有报价行时，“复制报价”“导出报价”在首屏内，`elementFromPoint` 命中按钮本身。
- 手机 375×667 与 390×844，`pointer: coarse`：复制、导出、汇率按钮不被底栏挡住；底栏 `z-index` 为 41。
- 删除商品要出现确认框；确认后列表减少，409 时保留数据并提示同步。
- 手动汇率填 7.2，刷新后仍是 7.2，按钮为“恢复自动”；点下去后变回已发布行情。
- 导出 CSV 单价是两位小数；75.50×2 @ 7.2 的 USDT 行是 20.98。
- 响应头有 CSP 和 `X-Frame-Options: DENY`，没有 `Strict-Transport-Security`。页面能打开，`/api/exchange-rate` 返回 JSON。

## 生产部署流程（2026-10-14 已执行）

不要在这台 1 GiB 服务器上构建。本机 `npm ci`、`npm run build`，上传 `dist`，保留原 dist 以便回滚，然后 `systemctl restart quickprice`。不要覆盖 `/var/lib/quickprice`、`/etc/quickprice/runtime.env` 或备份。不要用历史商品 JSON 覆盖在线商品库。

新 dist 生效并确认复制、底栏之后，编辑 `/etc/nginx/conf.d/quickprice.conf`：

- 删除 `sub_filter` 那一行（它在 `</head>` 前插入 hotfix CSS 和 JS）。
- 删除 `location = /quickprice-hotfix.js` 和 `location = /quickprice-hotfix.css`。
- `nginx -t` 后 `systemctl reload nginx`。

继续只监听 80。不要加 443 或 HSTS。

## 未做

- HTTPS / Secure Cookie / `X-Forwarded-Proto`。用户要求保留明文 HTTP。
- 登录限流仍用 `CF-Connecting-IP`（Nginx 把它设成 `$remote_addr`），不在本次修复范围。

## 2026-10-14 Codex 上线交接

生产正在运行的应用代码是 `cec6b8a`（桌面提示避让）。它基于已合并的 main `2364f0b`。文档提交 `67770e1` 只记录部署，不在 `dist` 里。之后若只合入文档，不会自动更新线上页面。

`2364f0b` 先发布到现有公网入口。验收发现桌面成功提示会遮挡固定导出按钮，于是补了 `cec6b8a`：ResizeObserver 测量 `.quote-actions` 高度，提示停在操作区上方；手机沿用原有底栏间距。Nginx 已撤下 hotfix 注入。仓库里的 `qa.env`、`qa-fixture.sql`、`deploy-grok-phase1.sh` 没有出现在这个 PR 中。

- 84 项自动测试通过，2 项因独立集成环境／参考文件未配置跳过；类型检查、构建通过。
- 公网手机两种尺寸与桌面的真实 HTTP 复制、CSV、USDT、手动汇率保存／恢复、新建报价通过。独立本地库商品删除和 revision 409 保护通过。
- 生产商品 301 条、版本 8，部署前后内容校验一致。汇率刷新、每日备份与原运行机密保留；Codex 聊天定时巡检保持用户设置的暂停状态。
- 回滚备份：`/var/backups/quickprice/grok-phase1-2364f0b-20261014T021351Z`。回滚旧 dist 时同时恢复备份里的 Nginx 配置。
- 2026-10-14 审查在独立本地环境复测：`npm test` 84 通过、2 跳过。提示动画结束后，1440×900 与 1000×800 的提示底边在导出按钮上方约 23px，复制和导出都能点到；375×667、390×844 的底栏按钮在提示出现后仍能点到。没有再次部署，也没有改生产商品库。

## 2026-10-16 双账号销售价／成本价（尚未上线）

分支 `grok/dual-account-cost-price`，从当时的 `origin/main` `1213477` 切出。生产仍是 `cec6b8a`。这次没有部署，没有连接或修改生产商品库。

### 改了什么

两个账号都能看和改同一份商品的销售价与成本价。`888` 打开报价时默认销售价，`111` 默认已确认的成本价。商品 JSON 仍只存在 `catalogs.user_id = account:888`，没有复制到 `account:111`。成本在新表 `product_cost_prices`，以分为整数；没有行或空值显示“待录入”，不会拿销售价填充，也不会写成 0。明确填写的 0 是真的零元。

- `888` 继续用 `QUICKPRICE_PASSWORD_RECORD`。`111` 只读 `QUICKPRICE_COST_PASSWORD_RECORD`。生成哈希：`printf %s 'your-password' | node scripts/hash-password.mjs`。仓库、测试和文档都没有 `111` 的初始口令。
- 两边都能 `POST /api/products` 新建商品并写初始双价，都能 `PATCH /api/products/:id/prices` 改其中一项或两项。整份商品资料的 `PUT /api/catalog`、改已有名称／规格／单位／品类／别名、删除，仍只有 `888`。客户端不能靠传入角色或 userId 提权。
- 报价有单一 `priceType`。新行只取当前类型，缺价不回退到另一种。已有行保留单价、名称、规格、单位快照。手改单价不写回价库。复制和导出在仍有待完善项时保持禁用，页面显示“N 项待完善”。`888` 的默认复制／CSV 仍是“多肽报价清单”，没有成本列。`111` 的标题是“内部成本清单”。两边都能另导出“内部售价成本对比”。USDT 规则不变：75.50 元 × 2、汇率 7.2 → 单价 10.49、行 20.98。复制文本在原有“折合：20.98 USDT”后补充单价，方便和页面、CSV 对照。
- 手动汇率按账号分开。旧的全局键只在 `888` 会话里迁移一次；`111` 不继承。公共行情缓存仍共用。
- 切换账号要先处理未保存的报价或表单，再验证目标密码。成功后才换会话并作废旧会话。密码错误或取消留在原账号。桌面用账号菜单，手机放在现有“设置”里，底栏仍是三项。
- 迁移 `drizzle/0004_cost_prices.sql` 可重复执行。`0004_cost_prices_rollback.sql` 只删新表，给独立演练用。生产回滚应用时不要跑这份 SQL。

### 测试

2026-10-16，Node v22.14.0：`npm test` 95 通过，2 跳过，0 失败。跳过项仍是需要 `QUICKPRICE_TEST_URL` 的登录集成，以及需要 `QUICKPRICE_REFERENCE_XLSX` 的参考表。`npx tsc --noEmit` 通过。

验收 A01–A31 的数据规则在 `tests/dual-account.test.mjs`，用内存 SQLite 和合成商品，不读生产库。A21 在没有成本表的库上确认销售价仍可改，并演练迁移重跑和回滚 SQL 后商品 JSON 还在。

独立本地 D1（不是生产）上，用合成商品“多肽甲”分别以 `888` 和 `111` 在 1440×900、375×667、390×844 走了登录、报价、复制、CSV、汇率 7.2、账号切换和商品库。截图在当次 artifacts：`dual-888-*`、`dual-111-*`。结果：

- 1440×900：销售合计 ¥151.00，页面、复制和 CSV 都有 USDT 单价 10.49 与行 20.98；销售 CSV 无“成本”。对比可见价差。错误密码后仍是 `888` 且清单还在。切换到 `111` 后清单清空，成本合计 ¥80.00，复制标题为“内部成本清单”。`111` 的商品库没有删除按钮。
- 375×667 与 390×844：底栏仍是“报价 / 商品库 / 设置”。复制、导出按钮可见且可点，设置项不被底栏挡住。两个账号的报价、复制和切换同样通过。
- 本机迁移 `0000`–`0004` 后，`888` 与 `111` 登录成功；错误口令被拒绝。

### 按文档采用的默认

- 一份共享商品库，成本单独成表。销售价更新时间放在 `product_price_meta`，不用商品库的 `updated_at` 冒充某一行的改价时间。历史商品在第一次用新接口改销售价之前，这个时间是空的。
- 两边都能新建和改双价；只有 `888` 能改已有主档和删除。`PUT /api/catalog` 仍是整份维护。
- 导入前由用户选择销售、成本或双价，不按当前账号猜测。
- 同一清单不能混用两种价格。旧报价行没有快照时，沿用原来的复制和 CSV，避免旧测试被破坏；快照为 `null` 表示待确认。
- 并发改不同价格时，过期版本返回 409，核对后重试；一次双价请求不会只写成一项。
- 左右并排的价格表只在表头重复出现两个名称锚点或两个商品 ID 时拆开。
- 成本读失败显示“加载失败”，不显示“待录入”。这时 `888` 仍可改销售价；依赖这次失败读取的成本写入会拒绝，不会用空值覆盖。

### 待办

- 功能还没上生产。线上仍是 `cec6b8a`，直到有人按下面的步骤构建并上传。
- 真实成本由用户稍后用预览导入，不要用测试数据灌生产库。
- 没有自助改密、没有订单、没有 HTTPS。不要恢复已暂停的 Codex 巡检，也不要新增 cron。

### 生产上线步骤（本次不要执行）

1. 备份当前应用、`/var/lib/quickprice` 数据库和 `/etc/quickprice/runtime.env`。用当时线上数据计算商品 ID、销售价和主档字段的校验摘要，不要用仓库里的历史 JSON。
2. 只对生产库增量执行 `drizzle/0004_cost_prices.sql`。它可重复执行，不改现有商品、会话和汇率缓存。先在独立库用合成数据演练；演练回滚可以用 `0004_cost_prices_rollback.sql`，生产应用回滚不要执行这份删除脚本。
3. 用 `scripts/hash-password.mjs` 生成 `111` 的密码记录，把 `QUICKPRICE_COST_PASSWORD_RECORD` 追加进现有 runtime env。不要覆盖整份文件，不要改 `888` 已有的 `QUICKPRICE_PASSWORD_RECORD`。
4. 在内存足够的机器上 `npm ci`、`npm test`、`npm run build`，上传 `dist`。不要在 1 GiB 服务器上构建。保留上一版 dist。重启 `quickprice`。不要动 Nginx 的明文 HTTP，不要加 HSTS。
5. 先用 `888` 核对销售库摘要与升级前一致，再登录 `111`。确认未录入成本显示“待录入”。真实成本等用户预览后再写入。

应用回滚：恢复上一版 dist，从 runtime env 去掉 `111` 的密码记录，保留新的成本表和变更记录。不要用历史全库备份覆盖这期间新增的商品或价格。
