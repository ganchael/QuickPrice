# 阿里云线上版本

当前入口为 http://106.14.116.244/ 。`quickprice.nginx.conf` 是服务器正在使用的 Nginx 配置，公网 80 反向代理到应用，2026-10-14 已撤下 hotfix 注入。`quickprice.service` 运行应用；`quickprice-backup.*` 和 `backup.py` 用于每日数据库备份。运行密钥、生产数据库与备份不在仓库中。

`live-dist-20260930.tgz` 是 2026-09-30 从服务器当前 `dist/` 保存的构建快照，SHA-256 为 `9168ea4c26ecc7221e5a4b733b638403e744490197581980bc9422048a164644`。它用于恢复当时实际运行的界面，解压后包含 `dist/`。移动端布局、提示避让以及 HTTP 复制兼容代码另保存在仓库根目录的 `hotfix/`。

2026-10-03 已恢复完整 UI 源码，2026-10-14 已部署 Grok phase1 修复和附加桌面提示避让，移动端底栏避让与 HTTP 复制兼容由应用提供。`live-dist-20260930.tgz` 保留为历史回滚快照，不代表最新汇率实现。回滚到依赖 hotfix 的旧构建时，需同步恢复该版本的 Nginx 注入配置。最近上线记录及备份路径见 `docs/OPERATIONS.md`。

`quickprice-ca.conf` 是应用服务的证书配置，安装到 `/etc/systemd/system/quickprice.service.d/ca.conf` 后执行 `systemctl daemon-reload`、`systemctl restart quickprice`。它使 workerd 使用阿里云系统完整 CA bundle，保持 HTTPS 证书校验开启。其他发行版需要改为其实际 CA bundle 路径。

恢复或发布前先备份现有数据库。部署时不要上传 `.dev.vars`、`/etc/quickprice/runtime.env`、`/var/lib/quickprice` 或 `/var/backups/quickprice` 到 GitHub；也不要用仓库中的历史商品快照覆盖在线商品库。详细步骤见 `docs/OPERATIONS.md`。

`rate-watchdog.py`、`quickprice-rate-watchdog.service` 和 `.timer` 提供欧易报价主动检查：服务器每 2 分钟检查 GitHub feed，报价达到 4 分钟时通过专用请求分支触发 GitHub runner；达到 10 分钟标记过期。启用前必须由用户明确批准创建专用仓库写入 deploy key，私钥只在服务器 root 目录，不能上传 GitHub。目录权限、固定 SSH 主机校验和故障排查见 `docs/OPERATIONS.md`。
