# 阿里云线上版本

当前入口为 http://106.14.116.244/ 。`quickprice.nginx.conf` 是服务器正在使用的 Nginx 配置，负责提供 `hotfix/` 下的 CSS、JS，并将它们插入页面。`quickprice.service` 运行应用；`quickprice-backup.*` 和 `backup.py` 用于每日数据库备份。运行密钥、生产数据库与备份不在仓库中。

`live-dist-20260930.tgz` 是 2026-09-30 从服务器当前 `dist/` 保存的构建快照，SHA-256 为 `9168ea4c26ecc7221e5a4b733b638403e744490197581980bc9422048a164644`。它用于恢复当时实际运行的界面，解压后包含 `dist/`。移动端布局、提示避让以及 HTTP 复制兼容代码另保存在仓库根目录的 `hotfix/`。

**源码与线上构建暂不完全对应。** 本仓库同步了服务器上可维护的商品导入源码和部署配置，但当前线上界面的较新版原始组件/CSS 尚未回填到 `app/`。直接用此仓库重新构建并替换服务器 `dist/`，可能使界面回到旧版。待原始界面源码恢复后，应将 `hotfix/` 逻辑并入应用、完成测试，再移除临时注入。

恢复或发布前先备份现有数据库。部署时不要上传 `.dev.vars`、`/etc/quickprice/runtime.env`、`/var/lib/quickprice` 或 `/var/backups/quickprice` 到 GitHub；也不要用仓库中的历史商品快照覆盖在线商品库。详细步骤见 `docs/OPERATIONS.md`。
