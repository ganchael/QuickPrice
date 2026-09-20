# 配置、部署与恢复

## 当前服务

- 网站：https://quickprice-assistant.ganchael1.chatgpt.site
- Sites 项目以 `.openai/hosting.json` 为准，复用现有项目，不新建替代站点。
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

本地开发使用 Vite 配置中的本地 D1 绑定。生产环境使用 Sites 提供的真实绑定；配置文件中的占位数据库 ID 不是生产数据库地址。

## 发布

当前运行方式为 Sites + Cloudflare Worker，不能直接使用 GitHub Pages 托管后端。

1. 安装依赖，检查类型与相关测试，构建应用。
2. 通过 Sites 的源码仓库同步待发布版本；GitHub 是另一个源码备份远端。
3. 打包构建结果，保存版本并部署至现有 Sites 项目。
4. 等部署成功后验证登录、商品库和汇率功能。

常规构建命令为 `npm run build`；Sites 发布使用对应插件的构建和打包流程，包含 Worker 入口、静态资源、托管配置及迁移。不能仅将源码压缩作为部署包。

## 商品快照与恢复

`data/catalog-2026-09-20.json` 是经登录 API 读取的商品库快照，包括 198 项商品（版本 10）、归属和更新时间，不含会话。原始 Excel 不包含所有手动新增项目，因此完整恢复以 JSON 快照为准。

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

## 备份范围

Git 历史保留此前源码变更。本次附带当前商品快照和最新源表；临时校验结果、浏览器截图、构建产物和本地运行日志未纳入版本库。云端后续编辑不会自动写回 GitHub，需另行导出备份。
