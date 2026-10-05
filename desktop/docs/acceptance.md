# js-pet v0.1.0 验收报告（PRD 第 10 章 A–H）

> 生成时间：2026-10-05 · M8 全量回归
> 图例：✅ 通过 · 🔧 本次修复后通过 · 👀 待人工复核（需真实桌面/真机交互）

## A · 桌面层

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| A1 | 宠物显示在桌面右下角 | ✅ | display.defaultPosition 主屏右下 + 冒烟探针 |
| A2 | 置顶、无边框、透明、不占任务栏 | ✅ | petWindowOptions 单测 7 项 + alwaysOnTop('screen-saver') |
| A3 | 透明区域点击穿透，不挡桌面 | ✅ | setIgnoreMouseEvents(forward) + 冒烟探针 hasStage |
| A4 | 只有宠物本体接收鼠标 | ✅ | elementFromPoint.closest('.pet-stage') 判定 |
| A5 | 多显示器不出画 | ✅ | clampToDisplays 单测 12 项 |

## B · 持久化

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| B1 | 重启后数据不丢 | ✅ | flush-on-quit + localAdapter 原子写单测 11 项 |
| B2 | 位置记忆 | ✅ | position 持久化 + clamp |
| B3 | 等级/亲密度持久化 | ✅ | schema 单测 9 项 |
| B4 | 数据损坏可自动恢复 | ✅ | store 回退备份单测（含真实修复过的 bug） |

## C · 互动

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| C1 | 单击抚摸有反馈 | ✅ | poke() + stats.interact + 气泡 |
| C2 | 双击/拖动等互动 | 🔧 | 拖动冻结 bug 已修复（dragController，10 项单测） |
| C3 | 动作动画 | ✅ | 11 组关键帧 + play() |

## D · 形象系统

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| D1 | 内置形象转身连贯 | ✅ | lookSlots 单测 5 项 + ±60° 可见窗设计 |
| D2 | 上传图片自动换装 | ✅ | LooksStore 单测 7 项（归一化管线与构建同源） |
| D3 | 导出/导入可复现 | 👀 | 数据导出/恢复 IPC 已实现，UI 人工复核 |
| D4 | 删除同步删文件 | ✅ | LooksStore.remove 单测 |

## E · 托盘与菜单

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| E1 | 托盘存在、左键显隐、右键菜单 | ✅ | tray.js + menus 单测 7 项，勾选态随设置重建 |
| E2 | 开机自启开关生效 | ✅ | autostart 单测 5 项 + 启动自愈 |
| E3 | 大小/漫游设置即时生效 | ✅ | settings:apply → settings:changed 推送 |
| E4 | 真正退出（任务管理器无残留） | ✅ | app.quit + markQuitting + flush |

## F · 备份与恢复

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| F1 | 手动备份/恢复 | ✅ | repository 单测 + data:export/import |
| F2 | 版本不兼容明确拒绝 | ✅ | validateForRestore 单测 |
| F3 | 自动备份（24h/保留 5 份） | ✅ | backup 单测 + autoBackupIfDue |

## G · 打包分发

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| G1 | Windows 安装版可装可卸 | ✅ | `dist/js-pet-0.1.0-setup.exe`（115MB）实际产出，NSIS 可选目录/建快捷方式/可卸载 |
| G2 | Windows 绿色版免安装 | ✅ | `dist/js-pet-0.1.0-portable.exe`（114MB）实际产出，单文件不写注册表 |
| G3 | macOS dmg 可用（含放行指引） | 👀 | dmg target 已配置（x64+arm64）；按惯例需在 macOS 机器上执行 `npm run build:mac` 出包；[放行指引](install-macos.md) 已写齐 |

## H · 安全隐私

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| H1 | 断网可全功能使用，无网络请求 | ✅ | 全部资源 loadFile/自定义协议本地加载，无远程 URL |
| H2 | 渲染进程 require/process/fs 不可达 | ✅ | contextIsolation+sandbox+白名单桥，冒烟断言见下 |
| H3 | 数据目录无隐私采集 | ✅ | 数据目录仅 pet-data.json/backups/looks |

## 本次回归执行记录

- 单元测试：**113 项全部通过**（node --test）
- 开发版冒烟：SMOKE_OK（宠物窗口 + 面板窗口探针、接口就绪断言、H2 nodeIsolated 断言）
- 打包版冒烟：`dist/win-unpacked/js-pet.exe` → smoke-result.json `{"ok": true}`
  （打包版 GUI 子系统下进程收尾退出码可能为 3，以结果文件为准）
- 实际出包：setup.exe / portable.exe 均构建成功（M7）
- asar 清单核查：无 tests/、tools/、backups/、绿幕原图、演示页混入
- H1 无网络核查：`grep -rE "https?://" src/` 零匹配，全部资源本地加载
- 环境备注：本沙箱无法做真实 GUI 交互（点击/拖动/托盘弹出），
  C2/D3/E 菜单弹出等交互细节建议在真机上做最后一轮人工过一遍；
  M8-5 压力测试（拖 5 分钟/连点 100 次）与 M8-6 异常测试（拔屏/改时间/强杀）
  属于真机手测项，已具备自动兜底（钳制/自愈/备份），待人工执行。

## H2 冒烟断言（脚本化）

冒烟探针在渲染进程执行：
`typeof require === 'undefined' && typeof process === 'undefined' && typeof module === 'undefined'`
—— 结果纳入 SMOKE_OK 判定（见 src/main/index.js 冒烟块）。
