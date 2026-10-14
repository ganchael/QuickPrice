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
