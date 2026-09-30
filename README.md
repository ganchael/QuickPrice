# QuickPrice · 多肽快速计价助手

面向手机操作的商品报价工具，支持商品简称/全称检索、批量计价、Excel 导入、在线商品管理和人民币/USDT 换算。

- 当前线上地址：http://106.14.116.244/
- 原 Sites 地址：https://quickprice-assistant.ganchael1.chatgpt.site
- 源码仓库：https://github.com/ganchael/QuickPrice
- 历史商品备份：`data/catalog-2026-09-20.json`
- 原始价目表：`data/source/9.18多肽批发价.xlsx`

## 功能

- 登录后使用，商品库在云端保存，多设备共享。
- 手动添加报价项目为默认入口，也支持批量输入。
- 同时检索和展示产品简称、全称、规格；没有简称时展示全称。
- 商品支持在线增删改和 Excel 导入；不同规格分别计价。
- 复制“多肽报价清单”，导出包含日期、时分的 CSV（可用 Excel 打开）。
- 人民币金额自动换算为 USDT；参考欧易公开页面，可手动修改汇率。
- 标题逐字显示，内置多条文案轮换；布局针对移动端触控优化。

## 技术与目录

React 19、TypeScript、Vinext/Vite、Tailwind CSS、Cloudflare Workers/D1、SheetJS。

| 目录 | 内容 |
| --- | --- |
| `app/` | 页面、登录、商品库和汇率 API |
| `components/` | 商品管理、选择器、标题和界面组件 |
| `lib/` | 计价、表格解析、汇率、报价导出、密码校验 |
| `db/`、`drizzle/` | 数据模型和迁移 |
| `tests/` | 计价、导入、导出、登录相关检查 |
| `.openai/hosting.json` | 现有 Sites 项目标识与数据库绑定 |
| `data/` | 商品快照与原始 Excel |
| `deploy/aliyun/`、`hotfix/` | 阿里云运行配置、当前线上构建快照与浏览器兼容修复 |
| `docs/OPERATIONS.md` | 配置、部署与数据恢复说明 |

## 本地开发

需要 Node.js 22.13 或更高版本。

```sh
npm ci
npm run dev
```

登录和商品管理还需要初始化本地 D1 数据库，并配置 `QUICKPRICE_PASSWORD_RECORD`，见运维说明。单独启动开发服务器不等于配置完成。

```sh
npx tsc --noEmit
node --test tests/*.test.mjs
npm run build
```

API 集成测试只针对本地测试服务；未设置测试地址、密码时会跳过。现有该测试仍使用旧账号 `zlw`，运行前需调整为当前账号 `888`。运行测试会操作测试商品库，请使用独立的本地数据库。

## 数据与发布

`data/catalog-2026-09-20.json` 是 9 月 20 日的历史快照，不代表当前线上商品库；不要用它覆盖在线编辑后的商品。当前阿里云运行配置和构建快照见 `deploy/aliyun/README.md`。

GitHub 保存源码、开发历史及历史数据快照；它不会自动同步云端商品修改，也不会自动部署现有网站。当前线上服务运行在阿里云服务器。

本仓库不包含生产密码、密码校验记录、登录会话、访问令牌、本地环境文件、依赖目录或生成的部署文件。
