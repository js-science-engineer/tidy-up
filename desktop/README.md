# js-pet 🐾

> 一只常驻你桌面右下角的电子宠物。养成、互动、散步——数据只保存在你自己的电脑上。

> 📦 本目录是 **TidyLab 仓库中的桌面版子项目**。仓库总说明见 [根 README](../README.md)，安装与使用总说明见 [docs/安装指南.md](../docs/安装指南.md) 与 [docs/使用手册.md](../docs/使用手册.md)。

![js-pet](build/icon.png)

## 下载使用

去 [Releases](docs/release.md) 下载对应安装包：

- **Windows 安装版** `js-pet-x.x.x-setup.exe`：双击安装，有快捷方式，可卸载（推荐）
- **Windows 绿色版** `js-pet-x.x.x-portable.exe`：单文件双击即用，不写注册表
- **macOS** `js-pet-x.x.x-arm64.dmg` / `-x64.dmg`：未签名，首次打开按[指引放行](docs/install-macos.md)

## 它能做什么

- 🖥 **常驻桌面**：置顶、透明、不挡操作——只有点在宠物身上才算点击
- 🍚 **轻度养成**：会饿、会无聊；喂食/抚摸/玩耍涨亲密度，满 30 升一级（Lv.99 封顶）
- 🖱 **互动**：单击抚摸、双击嬉戏、按住拖动、右键菜单、说话气泡、视线跟着鼠标走
- 🎨 **换装**：上传一张宠物图片自动抠图换装（绿幕/白底最稳）
- 🚶 **散步**：可以让它自己在桌面上溜达
- ⚙️ **设置**：大小 100~260px、漫游开关、开机自启、备份/恢复/导出

## 隐私承诺

- **不联网**：全程零网络请求，断网可完整使用
- **不采集**：数据只存本机 `%APPDATA%/js-pet`（Win）或
  `~/Library/Application Support/js-pet`（Mac）
- **可带走**：设置里一键导出全部数据为 JSON

## 开发

```bash
npm install        # 安装依赖
npm start          # 开发运行
npm test           # 单元测试（113 项）
npm run smoke      # Electron 冒烟自检（宠物窗口+面板探针）
npm run build:win  # 打 Windows 安装包+便携版（需配 ELECTRON_MIRROR）
```

技术栈：Electron 44 · 原生 JS（无打包器）· JSON 本地存储（原子写+自动备份）·
MIT License

## 目录速览

```
src/main/       主进程（窗口/托盘/IPC/存储/形象）
src/preload/    安全桥（contextBridge 白名单）
src/renderer/   宠物窗口 + 面板窗口
src/shared/     主/渲染共用的纯逻辑（数值/抠图/槽位/拖拽）
src/assets/     内置形象成品图 + 托盘图标
build/          应用图标三件套 + 图标原图
tools/          构建/体检/冒烟脚本
tests/          单元测试
docs/           安装指引 / 发布说明 / 验收报告
```
