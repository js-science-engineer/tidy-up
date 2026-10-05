# TidyLab · 实验室物品收纳管理系统

> **拍一张照片 → AI 认出是什么 → 建议放哪个柜子哪一格 → 一键入库 → 随时搜索、随时查看每个柜子里有什么。**

TidyLab 是一套面向实验室/工作室的物品收纳管理工具，把「收拾东西」这件事变成「拍照 + 确认」两步。
本仓库同时包含 **两套可独立运行的版本**：

| 版本 | 形态 | 运行方式 | 源码位置 |
|---|---|---|---|
| 🌐 **网页版（TidyLab）** | 浏览器应用 | 本地轻后端（Express + SQLite）**或**云端托管（多用户） | `server/` + `public/` |
| 🐾 **桌面版（js-pet）** | Windows / macOS 桌面应用 | Electron，常驻桌面右下角的电子宠物 | `desktop/` |

---

## 目录

- [功能亮点](#功能亮点)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
  - [A. 网页版 · 本地运行](#a-网页版--本地运行推荐先跑这个)
  - [B. 网页版 · 在线体验](#b-网页版--在线体验)
  - [C. 桌面版 js-pet](#c-桌面版-js-pet)
- [运行测试](#运行测试)
- [仓库包含 / 不包含什么](#仓库包含--不包含什么)
- [文档索引](#文档索引)
- [技术栈](#技术栈)
- [许可](#许可)

---

## 功能亮点

**网页版 TidyLab**

- 📸 **识别入库**：上传/拍摄照片 → AI 识别物品 → 联网匹配标准名称与实物图 → 给出「区域 › 柜 › 层 › 箱」分区建议（带理由）→ 一键入库。支持 **一图一物** 与 **整层批量（一图多物）** 两种模式。
- 🗄️ **收纳空间**：用一句自然语言（如「两层，第一层 5 个柜子：1 个双开门 + 4 个单开门」）让 AI 生成四级柜体结构；支持拖拽/表单编辑与 2D 可视化下钻。
- 🔍 **搜索**：精确匹配 + **AI 语义搜索**（「那个蓝色的测电压的东西」也能搜到万用表）。
- 📦 **出库与流水**：取用后扣减数量，扣到 0 标记「已取空」，历史全程可追溯。
- 📊 **统计看板**：物品/区域/柜体总览与出入库明细。
- 💾 **数据安全**：实时落盘；一键备份 zip、启动自动备份、恢复前自动应急备份。
- 🐾 **电子宠物**：打开网站自动蹦出的桌面宠物（12 态交互、拖拽、换装、复制），可自定义形象。
- 👥 **多用户**：云端模式下邮箱注册登录，账号间数据与宠物形象完全隔离。

**桌面版 js-pet**

- 🖥 常驻桌面、置顶透明、不挡操作；🍚 轻度养成（喂食/抚摸/玩耍，满 30 升一级）；🎨 上传图片自动抠图换装；🚶 桌面溜达；⚙️ 大小/漫游/开机自启/备份导出。
- 🔒 **完全离线**：零网络请求，数据只存本机。

---

## 目录结构

```
tidy-up(2)/
├── README.md                 ← 你正在看的文件
├── CHANGELOG.md              两套产品的版本变更记录
├── LICENSE                   MIT 许可
├── .gitignore / .gitattributes
├── package.json              网页版依赖与脚本
├── start.bat                 Windows 一键启动（自动装依赖 + 开浏览器）
├── start.sh                  macOS / Linux 一键启动
│
├── .github/
│   ├── workflows/release.yml 打 tag 自动测试 + 构建安装包 + 发 Release
│   └── release.yml           Release Notes 自动分类规则
│
├── server/                   网页版 · 后端（Express + SQLite）
│   ├── index.js              服务入口（静态托管 + API + 局域网监听）
│   ├── db.js                 数据层（better-sqlite3 优先 / node:sqlite 兜底）
│   ├── schema.sql            建表语句
│   ├── config.js             API Key / 供应商 / 端口配置（Key 永不下发前端）
│   ├── routes/               items / ai / search / stats / settings / backup / structure
│   └── services/             识别、分区建议、联网匹配、结构生成、AI 供应商适配
│
├── public/                   网页版 · 前端（Vue 3 CDN + 原生 JS，无打包器）
│   ├── index.html
│   ├── css/                  设计变量 / 主样式 / 宠物样式
│   ├── js/
│   │   ├── api.js            接口分发（本地 / 云端双模式）
│   │   ├── app.js            应用入口
│   │   ├── components/       总览 / 收纳空间 / 识别入库 / 搜索 / 统计 / 设置 / 宠物 / 登录 …
│   │   └── cloud/            云端模式适配（boot 探测 + PostgREST/Storage 适配 + 共享逻辑）
│   └── pet-assets/           电子宠物成品素材（已量化压缩）
│
├── test/                     网页版自动化测试（Node 内置 test runner）
│   ├── m1~m5                 后端数据与接口
│   ├── m6.frontend          前端契约回归
│   ├── m7.cloud             云端数据层
│   └── m8.cloudapi          云适配器与鉴权隔离
│
├── docs/                     📚 全部文档（详见文末「文档索引」）
│   ├── 安装指南.md / 使用手册.md / 版本说明.md
│   ├── 发布流程.md / 发布说明_v0.7.0.md
│   ├── PRD.md / 需求文档_v1.md / 开发计划.md / 开发计划_v2.md / 测试报告.md / 下一步开发计划.md
│   └── design/               设计效果图与宠物原型页（HTML，可直接浏览器打开）
│
└── desktop/                  🐾 桌面版 js-pet（Electron，独立子项目）
    ├── README.md             桌面版专属说明
    ├── package.json / electron-builder.yml
    ├── src/                  main（窗口/托盘/IPC/存储/形象）· preload · renderer · shared · assets
    ├── build/                应用图标（png / ico / @2x）
    ├── tools/                构建、体检、冒烟脚本
    ├── tests/                单元测试（117 项）
    ├── pet-assets/           形象处理脚本
    └── docs/                 安装指引 / 发布说明 / 验收报告 / macOS 构建说明 / design/
```

---

## 快速开始

### 环境要求

| 项 | 要求 |
|---|---|
| Node.js | **≥ 22.13**（推荐 22 LTS；内置 `node:sqlite` 自 22.13 起无需额外标志） |
| 操作系统 | Windows 10+ / macOS 12+ / Linux |
| 浏览器 | Chrome / Edge / Safari 等现代浏览器 |

### A. 网页版 · 本地运行（推荐先跑这个）

```bash
# 1. 安装依赖（在仓库根目录执行）
npm install

# 2. 启动
npm start
```

也可以直接双击 `start.bat`（Windows）或执行 `./start.sh`（macOS / Linux）——脚本会自动安装依赖并打开浏览器。

启动后：

1. 浏览器打开 **http://localhost:5175**（脚本会自动打开）
2. 首次使用到「**设置**」页填入 AI Key（推荐智谱 **GLM-4V-Flash**，注册即免费），保存即生效
3. 去「**收纳空间**」用一句话生成柜体结构 → 去「**识别入库**」传照片，开始使用

> 📱 **手机上传**：手机与电脑连同一个 WiFi，用手机浏览器打开服务启动时打印的局域网地址（形如 `http://192.168.x.x:5175`）即可拍照上传。若打不开，请放行 Windows 防火墙的专用网络访问。

> ⚠️ AI Key 只存在本机 `data/config.json`，**不会下发到前端**，界面中以打码形式显示；`data/` 已被 `.gitignore` 排除，不会被提交。

### B. 网页版 · 在线体验

已部署的云端版本（多用户、邮箱注册登录）：

**https://tidylab.app.workbuddy.host/**

云端模式由托管平台提供数据库、文件存储与账号体系，账号之间数据完全隔离。注册需要邮箱验证码。

### C. 桌面版 js-pet

桌面版是独立的 Electron 应用，详细说明见 [`desktop/README.md`](desktop/README.md)。

```bash
cd desktop
npm install
npm start          # 开发运行
npm run build:win  # 打 Windows 安装包 + 便携版
npm run build:mac  # 打 macOS dmg（需在 macOS 上执行）
```

安装包请到 **[Releases](../../releases)** 下载（由 GitHub Actions 在推送 `desktop-v*` tag 时自动构建，流程见 [发布流程](docs/发布流程.md)）：

- **Windows 安装版** `js-pet-0.1.0-setup.exe`：双击安装，含桌面/开始菜单快捷方式，可卸载（卸载保留用户数据）
- **Windows 便携版** `js-pet-0.1.0-portable.exe`：单文件双击即用，不写注册表
- **macOS** `js-pet-0.1.0-arm64.dmg` / `-x64.dmg`：未签名，首次打开需右键「打开」放行（见 `desktop/docs/install-macos.md`）

---

## 运行测试

```bash
# 网页版
npm test                 # 66 项：M1~M8

# 桌面版
cd desktop && npm test   # 117 项
```

测试使用 Node 内置 test runner，无需额外依赖。

---

## 仓库包含 / 不包含什么

**✅ 包含**：全部源码、建表脚本、测试、构建配置、设计/原型稿、完整文档，以及运行所需的成品素材（`public/pet-assets/`、`desktop/build/` 图标、`desktop/src/renderer/pet/looks/` 形象图）。

**❌ 不包含**（`node_modules/`、`data/`、`backups/`、`dist/`、`.workbuddy/`、`*.genie`、`*.log` 已由 `.gitignore` 排除）：

- **依赖与构建产物** —— `npm install` / `npm run build:win` 可随时重建。
- **运行时数据** —— `data/`（SQLite 库、上传图片）与 `backups/` 属本机数据，且 `data/config.json` 含真实 API Key，**严禁提交**。
- **AI 生成的美术源文件** —— `pet-assets/` 下约 10 MB 的原始生成大图、`desktop/src/assets/builtin-looks/raw{2}/` 约 14 MB 的绿幕原图属中间素材，运行时不需要（打包配置已显式排除），故未纳入本仓库以保持体积精简；如需二次加工美术，请从原工程取用。

> 📦 **安装包不在仓库里**（每个约 90~110 MB）。Windows / macOS 安装包通过 **[Releases](../../releases)** 分发，由 GitHub Actions 在你推送 `desktop-v*` tag 时自动构建并上传（见 [发布流程](docs/发布流程.md)）。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 两套产品的版本变更记录（Keep a Changelog 格式） |
| [docs/安装指南.md](docs/安装指南.md) | 网页版本地安装、AI Key 申请配置、云端部署、桌面版安装、常见问题 |
| [docs/使用手册.md](docs/使用手册.md) | 六大模块完整操作说明、识别入库两种模式、出库、宠物玩法、备份恢复 |
| [docs/版本说明.md](docs/版本说明.md) | 网页版 / 桌面版各版本演进、版本号与提交对照、本仓库整理说明 |
| [docs/发布流程.md](docs/发布流程.md) | 改版本号 → 打 tag → CI 自动构建 → 发布 Release 的完整步骤与检查清单 |
| [docs/发布说明_v0.7.0.md](docs/发布说明_v0.7.0.md) | 网页版 v0.7.0 发布说明（Release 正文来源） |
| [docs/PRD.md](docs/PRD.md) | 产品需求文档（v1.0 基线 + v2.0 上线增补） |
| [docs/需求文档_v1.md](docs/需求文档_v1.md) | v1.1 最终确认版（功能细节、供应商对比、UI 规范） |
| [docs/开发计划.md](docs/开发计划.md) / [开发计划_v2.md](docs/开发计划_v2.md) | v1.0 / v2.0 可执行开发计划 |
| [docs/测试报告.md](docs/测试报告.md) | 各里程碑测试记录与验收结果 |
| [docs/下一步开发计划.md](docs/下一步开发计划.md) | 后续候选功能与已知小问题 |
| [docs/design/](docs/design/) | 设计效果图 v1/v2、电子宠物原型页（浏览器直接打开） |
| [desktop/README.md](desktop/README.md) | 桌面版 js-pet 说明 |
| [desktop/docs/](desktop/docs/) | 桌面版安装指引、发布说明、验收报告、macOS 构建说明 |

---

## 技术栈

| 层 | 网页版 | 桌面版 |
|---|---|---|
| 前端 | Vue 3（CDN 引入）+ 原生 JS，无打包器 | Electron 44 + 原生 JS，无打包器 |
| 后端 | Node.js + Express 4 | Electron 主进程 |
| 数据 | SQLite（`better-sqlite3` 优先，`node:sqlite` 兜底）/ 云端托管数据库 + RLS | 本地 JSON（原子写 + 自动备份） |
| AI | 智谱 GLM-4V-Flash（免费）/ 阿里云百炼 Qwen-VL，OpenAI 兼容协议，可切换 | — |
| 视觉 | 液态玻璃 + 统一蓝靛单色系，深/浅双主题 | 透明置顶窗口 |
| 测试 | Node 内置 test runner（66 项） | Node 内置 test runner（117 项） |

---

## 许可

[MIT](LICENSE)
