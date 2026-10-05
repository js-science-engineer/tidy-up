# js-pet 开发计划（DEV_PLAN v1）

> 依据：`PRD.md` v1.0　｜　日期：2026-10-04
> 原则：**每个里程碑都能独立跑起来、独立验收**。不做"全部写完再一起测"。
> 工作量标记：**S** ≈ 半天内　**M** ≈ 1–2 天　**L** ≈ 3 天以上

---

## 0. 总览

| 里程碑 | 名称 | 覆盖 PRD 必做项 | 验收条款 | 工作量 |
|---|---|---|---|---|
| **M0** | 工程骨架 + Electron 空壳 | P0-1 | A1–A5 | M |
| **M1** | 宠物上桌面（复用 v3 渲染） | P0-2, P0-3 | A2, A4, A5 | L |
| **M2** | 数据层与持久化 | P0-8, P0-9 | B1–B5, F1, F2 | L |
| **M3** | 养成系统 | P0-6, P0-7 | C1–C5 | L |
| **M4** | 形象系统 + 原创形象产出 | P0-5, P0-10 | D1–D4 | L |
| **M5** | 面板窗口与设置 | P0-11 | E2, E3 | M |
| **M6** | 托盘与右键菜单 | P0-4 | E1, E4 | M |
| **M7** | 打包与分发 | P0-12, P0-13 | G1–G3 | M |
| **M8** | 打磨、安全自查与全量回归 | — | H1–H3 + 全量 | M |

**依赖链**：M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
（M4 的「AI 生成原创形象」可与 M2/M3 并行，不阻塞）

---

## 1. 技术选型与工程约定

| 项 | 选择 | 理由 |
|---|---|---|
| 运行时 | Electron 最新稳定版 | PRD 附录 A 决策 1 |
| 主进程语言 | **CommonJS** | 最稳，避开 ESM 在 Electron 里的坑 |
| 渲染进程 | **传统 `<script>`，不引入打包器** | `file://` 下 ES Module 会被 CORS 拦截；传统脚本可直接复用 `pet-demo-v3.html` 的代码 |
| 打包 | `electron-builder` | 一次配置出 NSIS / 便携版 / dmg |
| 数据存储 | **自研轻量 JSON Store**（不用 electron-store） | 需要完全掌控"原子写 + 节流 + 失败回退"，第三方库不满足 |
| 开机自启 | Electron 内置 `app.setLoginItemSettings()` | 跨平台，无额外依赖 |
| 测试 | Node 内置 `node:test` | 零依赖，只测纯函数（养成结算 / 版本迁移） |

**依赖清单（共 2 个生产依赖之外的开发依赖）**

```bash
npm i -D electron@latest electron-builder@latest
```

**npm scripts**

```json
{
  "start": "electron .",
  "test": "node --test tests/",
  "build:win": "electron-builder --win",
  "build:mac": "electron-builder --mac",
  "build:all": "electron-builder --win --mac"
}
```

---

## 2. 目标目录结构

```
js-pet/
├─ package.json
├─ electron-builder.yml
├─ PRD.md
├─ DEV_PLAN.md
├─ tests/
│  ├─ stats.test.js              养成结算单元测试
│  └─ schema.test.js             版本迁移单元测试
├─ build/                        打包用图标（icon.ico / icon.icns / icon.png）
└─ src/
   ├─ main/
   │  ├─ index.js                入口：单实例锁、启动顺序、生命周期
   │  ├─ windowPet.js            L1 宠物窗口（透明/置顶/穿透）
   │  ├─ windowPanel.js          L2 面板窗口（单例、复用）
   │  ├─ tray.js                 系统托盘
   │  ├─ contextMenu.js          右键菜单
   │  ├─ ipc.js                  IPC 路由（白名单）
   │  ├─ autostart.js            开机自启读写
   │  ├─ display.js              多屏 / DPI 边界校验与钳制
   │  └─ store/
   │     ├─ repository.js        仓储层抽象（本地适配器）
   │     ├─ localAdapter.js      JSON 原子写 + 节流
   │     ├─ backup.js            自动/手动备份与恢复
   │     └─ schema.js            默认值 + schemaVersion 迁移
   ├─ preload/
   │  └─ index.js                contextBridge 白名单 API
   ├─ shared/
   │  ├─ stats.js                养成数值模型（纯函数，主/渲染共用）
   │  └─ look-lib.js             ← 从 pet-assets/ 原样搬入
   ├─ renderer/
   │  ├─ pet/                    L1 宠物窗口页面
   │  │  ├─ index.html
   │  │  ├─ pet.js               ← 从 pet-demo-v3.html 抽出的渲染逻辑
   │  │  ├─ pet.css
   │  │  └─ looks/               贴图资源（原创形象）
   │  └─ panel/                  L2 面板页面
   │     ├─ index.html
   │     ├─ panel.js
   │     ├─ panel.css
   │     └─ tabs/
   │        ├─ grow.js           养成面板
   │        ├─ looks.js          形象管理
   │        └─ settings.js       设置
   └─ assets/
      ├─ icon.ico / icon.icns / icon.png
      └─ builtin-looks/          内置原创形象（随包分发）
```

> 现有 `pet-demo.html` / `pet-demo-v3.html` **不删除**，保留为参考与回归对照。

---

## 3. 里程碑详情

### M0 · 工程骨架 + Electron 空壳（对应 P0-1，验收 A1–A5）

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M0-1 | 初始化 `package.json`，安装 electron / electron-builder | `package.json` | `npm start` 能起一个窗口 |
| M0-2 | 建目录骨架（见第 2 节） | 空目录 + 占位文件 | 目录结构与计划一致 |
| M0-3 | 主进程入口：**单实例锁** + 生命周期 | `src/main/index.js` | 重复双击不会开出第二个宠物 |
| M0-4 | 透明无边框置顶窗口 | `src/main/windowPet.js` | `transparent:true` / `frame:false` / `alwaysOnTop:true` / `skipTaskbar:true` / `hasShadow:false` / `resizable:false` |
| M0-5 | 建 preload + `contextBridge` 骨架 | `src/preload/index.js` | 渲染进程能拿到 `window.pet` 命名空间；DevTools 里 `require` 为 `undefined` |
| M0-6 | 写 `electron-builder.yml` 骨架 | `electron-builder.yml` | 配置齐 appId / 产品名 `js-pet` / win+mac target |

**本阶段验收**：A1（`npm start` 能起）、A3（任务栏无图标）。

---

### M1 · 宠物上桌面（P0-2、P0-3，验收 A2、A4、A5）

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M1-1 | 从 `pet-demo-v3.html` 抽出渲染逻辑到 `src/renderer/pet/pet.js` | `pet.js` / `index.html` / `pet.css` | 11 种动作 + 待机呼吸/眨眼/视线跟随全部可用 |
| M1-2 | 贴图路径改为相对 `looks/`，去掉页面外壳与调试面板 | `pet.js` | 页面无任何 UI 壳，只有宠物 |
| M1-3 | **点击穿透**：默认 `setIgnoreMouseEvents(true,{forward:true})`，渲染层用 `elementFromPoint` 命中宠物本体时 IPC 通知主进程关闭穿透 | `windowPet.js` + `pet.js` + `ipc.js` | 宠物区域外点击可点到桌面图标（A4）；宠物本体可点选（A5） |
| M1-4 | 窗口尺寸 = 宠物包围盒 + 气泡/阴影余量（建议 320×380），随 `size` 设置联动 | `windowPet.js` | 气泡不被裁切，宠物不被裁切 |
| M1-5 | 多屏与 DPI：启动时校验记忆坐标落在某显示器 `workArea` 内，否则钳制到主屏右下角 | `display.js` | 外接屏拔掉后重开，宠物不会飞到看不见的地方 |
| M1-6 | 拖拽移动（`-webkit-app-region: drag` 或 IPC 移动窗口），位置变化上报 | `pet.js` | 能拖动，位置有变化（持久化在 M2 接） |

**本阶段验收**：A2（边缘无白底/黑框）、A4、A5。

---

### M2 · 数据层与持久化（P0-8、P0-9，验收 B1–B5、F1、F2）

**这是整个项目的技术核心，务必先写完再往上叠业务。**

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M2-1 | 定义数据 schema 与默认值 + `schemaVersion` | `store/schema.js` | 默认数据可生成一份合法 `pet-data.json` |
| M2-2 | **原子写**：写 `.tmp` → `fs.rename` 替换 | `store/localAdapter.js` | 写入过程中强杀进程，主文件仍完整 |
| M2-3 | **写入节流**：同类高频变更（位置/大小）2s 合并一次 | `store/localAdapter.js` | 连续拖动 10 秒，磁盘写入次数 < 10 |
| M2-4 | 关键时点强制立即写：互动后 / 退出前 / 换形象后 | `store/repository.js` | 退出前 `before-quit` 有 flush |
| M2-5 | **启动自愈**：解析失败 → 回退最近备份 → 通知用户 | `store/localAdapter.js` + `backup.js` | 手工改坏 JSON 后启动不崩（B4） |
| M2-6 | 自动备份：启动后距上次 > 24h 写一份，保留最近 5 份 | `store/backup.js` | `backups/` 下不多于 5 个文件（B5） |
| M2-7 | 手动备份 / 恢复 + 版本校验 | `store/backup.js` + 设置页 | 恢复旧备份数值回溯（F1）；不兼容版本被拒并提示（F2） |
| M2-8 | 仓储层抽象（本地适配器落地，云适配器留空实现） | `store/repository.js` | 换适配器不影响业务代码 |
| M2-9 | 单元测试：schema 迁移 | `tests/schema.test.js` | `npm test` 通过 |

**本阶段验收**：B1–B5（需 M1 的拖拽与一个临时"喂食"按钮配合）、F1、F2。

---

### M3 · 养成系统（P0-6、P0-7，验收 C1–C5）

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M3-1 | 养成数值模型（纯函数）：衰减、加成、升级换算 | `shared/stats.js` | 纯函数，可 `node:test` 直接测 |
| M3-2 | **离线结算**：`elapsed = now - lastTickAt`，一次性结算并钳制到 0–100 | `shared/stats.js` | 系统时间前进 6h 后重开，数值按规则下降（C1） |
| M3-3 | 运行中定时结算（建议 60s 一跳） | `main/index.js` 或渲染层定时器 | 挂着不动也会缓慢变化 |
| M3-4 | 互动：喂食 / 抚摸 / 玩耍，含冷却 | `shared/stats.js` + `pet.js` | 数值正确变化（B2） |
| M3-5 | **每日机制**：`todayInteractions` 计数 + 每日上限 + 跨天重置 | `shared/stats.js` | 达上限后亲密度不再涨并提示（C2）；跨天归零（C3） |
| M3-6 | 等级：`bond` → `level` 换算，跨阈值播升级动作 | `shared/stats.js` + `pet.js` | 等级 +1 且播专属动作（C4） |
| M3-7 | **状态驱动表现**：心情/饱食度影响表情与台词池 | `renderer/pet/pet.js` | 饱食度 <20 呈现"饿"的表现（C5） |
| M3-8 | 单元测试：衰减 / 升级 / 每日重置 | `tests/stats.test.js` | `npm test` 通过 |

**本阶段验收**：C1–C5。

---

### M4 · 形象系统 + 原创形象产出（P0-5、P0-10，验收 D1–D4）

> 4a（生成原创形象）与 4b（代码接入）可并行。

**M4a · 原创形象产出（外部任务）**

| # | 任务 | 完成判据 |
|---|---|---|
| M4a-1 | 用 AI 生成原创可爱卡通小角色（正 / 侧 / 背 / 招手 / 打盹，共 5 张，白底或透明底、风格统一、比例一致） | 5 张图到位 |
| M4a-2 | 人工过一遍，确认**无任何第三方 IP 雷同** | 通过 |
| M4a-3 | 用现有 `pet_fix.js` / `pet_hq.js` 归一化到 720×900 基准 | 与内置素材基准一致 |

**M4b · 形象系统接入**

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M4b-1 | 搬入 `look-lib.js` 到 `shared/` | `shared/look-lib.js` | 浏览器侧可直接调用 |
| M4b-2 | 内置形象加载与切换 | `renderer/pet/pet.js` | 三视图转身连贯、大小一致（D1） |
| M4b-3 | 上传一张图 → 抠图 + 切三视图 + 归一化 → 落盘到 `looks/` | `renderer/panel/tabs/looks.js` | 白底宠物图能正确换装（D2） |
| M4b-4 | 形象列表 / 切换 / 删除（同步删磁盘文件） | `looks.js` | 缩略图与文件同步消失（D4） |
| M4b-5 | 形象包导出 / 导入 | `looks.js` + `store/` | 跨安装可复现（D3） |

**本阶段验收**：D1–D4。

---

### M5 · 面板窗口与设置（P0-11，验收 E2、E3）

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M5-1 | 面板窗口：单例、复用、关闭即隐藏；左侧竖向标签导航 | `windowPanel.js` + `panel/index.html` | 标签可切换三个模块 |
| M5-2 | 养成面板：数值可视化 + 成长进度 + 互动按钮 | `tabs/grow.js` | 数值与宠物状态实时一致 |
| M5-3 | 设置：宠物大小、漫游开关、备份/恢复、关于/版本 | `tabs/settings.js` | 改动立即生效并落盘 |
| M5-4 | 设置：**开机自启**开关 | `autostart.js` | 开启后重启系统自启；关闭后不自启（E2） |
| M5-5 | **漫游模式**：开启后宠物在可见区域内移动，关闭静止 | `pet.js` | 开关行为正确（E3） |

**本阶段验收**：E2、E3。

---

### M6 · 托盘与右键菜单（P0-4，验收 E1、E4）

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M6-1 | 托盘图标 + 左键显示/隐藏 + 右键菜单 | `tray.js` | 托盘存在、行为正确（E1） |
| M6-2 | 右键菜单（宠物身上右键同一套菜单） | `contextMenu.js` | 菜单项齐全，勾选态与设置同步 |
| M6-3 | "退出"真正结束进程（含 flush 落盘） | `main/index.js` | 任务管理器无残留（E4） |
| M6-4 | 菜单项：显示/隐藏 · 喂食 · 抚摸 · 玩耍 · 睡觉 · 形象管理 · 设置 · 漫游开关 · 开机自启 · 关于 · 退出 | `contextMenu.js` | 与 PRD 2.3 清单一致 |

**本阶段验收**：E1、E4。

---

### M7 · 打包与分发（P0-12、P0-13，验收 G1–G3）

| # | 任务 | 产出 | 完成判据 |
|---|---|---|---|
| M7-1 | 应用图标三件套 `.ico` / `.icns` / `.png` | `build/` | 任务栏、托盘、安装向导图标正常 |
| M7-2 | `electron-builder.yml` 完整配置：appId、产品名 `js-pet`、target | `electron-builder.yml` | 能出包 |
| M7-3 | Windows：NSIS 安装包 + 便携绿色版 | `dist/` | 安装后有快捷方式可卸载（G1）；绿色版双击即用不写注册表（G2） |
| M7-4 | macOS：`.dmg`（不签名） | `dist/` | 拖入应用目录可运行（G3） |
| M7-5 | 体积优化：`files` 白名单，排除源码/测试/备份素材 | `electron-builder.yml` | 包内不含 `tests/`、`backups/`、`pet-demo*.html` |
| M7-6 | 写《Mac 未签名安装图文指引》 | `docs/install-macos.md` | 覆盖"右键 → 打开"与"系统设置 → 仍要打开"两条路径 |
| M7-7 | 写下载页文案（版本号 + 更新日志 + 已知问题） | `docs/release.md` | 可直接贴到网盘/GitHub Releases |

**本阶段验收**：G1–G3。

---

### M8 · 打磨、安全自查与全量回归（验收 H1–H3 + 全量）

| # | 任务 | 完成判据 |
|---|---|---|
| M8-1 | **断网全功能自查** | 全程无任何网络请求（H1） |
| M8-2 | **安全自查**：DevTools 中 `require`/`process`/`fs` 均不可达 | H2 |
| M8-3 | 数据目录内容审查，确认无隐私采集 | H3 |
| M8-4 | 按 PRD 第 10 章 A–H **逐条跑一遍**，记录结果 | 30 条全绿或记录偏差 |
| M8-5 | 压力测试：连续拖动 5 分钟、连续快速互动 100 次 | 无卡顿、无数据错乱 |
| M8-6 | 异常测试：拔外接屏、改系统时间跨天跨月、强杀进程 20 次 | 均可自愈 |
| M8-7 | 首次运行引导（说明为什么要"置顶 + 开机自启"） | 降低被误判为流氓软件的概率 |

**本阶段验收**：H1–H3 + PRD 全量 30 条。

---

## 4. 验收对照表（PRD 第 10 章 → 里程碑）

| PRD 条款 | 由哪个里程碑交付 |
|---|---|
| A1–A5 形态与窗口 | M0（A1/A3）、M1（A2/A4/A5） |
| B1–B5 数据持久化 | M2 |
| C1–C5 养成逻辑 | M3 |
| D1–D4 形象系统 | M4 |
| E1/E4 菜单与托盘 | M6 |
| E2/E3 设置项 | M5 |
| F1/F2 备份恢复 | M2 |
| G1–G3 打包分发 | M7 |
| H1–H3 安全隐私 | M8 |

---

## 5. 关键实现要点（易踩坑处）

### 5.1 点击穿透（M1-3）

```js
// 默认：整个窗口穿透，但把鼠标事件转发给渲染进程
petWin.setIgnoreMouseEvents(true, { forward: true });

// 渲染进程：鼠标移动时判断是否在宠物本体上
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const overPet = !!(el && el.closest('#pet'));
  window.pet.setIgnoreMouse(!overPet);   // 状态不变时不重复 IPC
});
```

要点：**必须做状态去抖**，否则每帧 IPC 会造成鼠标卡顿。

### 5.2 原子写（M2-2）

```js
async function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);          // 同分区 rename 是原子操作
}
```

要点：**tmp 必须与目标文件同目录同分区**，跨分区 rename 不是原子操作。

### 5.3 离线结算（M3-2）

```js
function settle(stats, now) {
  const hours = Math.max(0, (now - stats.lastTickAt) / 3600000);
  if (hours > MAX_OFFLINE_HOURS) hours = MAX_OFFLINE_HOURS;  // 建议封顶 72h，避免"一开就全空"
  return {
    hunger: clamp(stats.hunger - hours * HUNGER_DECAY),
    mood:   clamp(stats.mood   - hours * MOOD_DECAY),
    bond:   stats.bond,
    lastTickAt: now,
  };
}
```

要点：**必须封顶**。否则用户出差一周回来，宠物直接归零，体验是灾难。

### 5.4 多屏坐标（M1-5）

记忆的 `x,y` 是**虚拟桌面绝对坐标**。启动时若该点不在任何 `screen.getAllDisplays()` 的 `workArea` 内，钳制回主屏右下角，并落盘修正后的值。

---

## 6. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 透明窗口在部分 Windows 上出现黑边/白底 | A2 不达标 | M1 阶段优先在**两台不同机器**验证；必要时退回 `backgroundColor:'#00000000'` + 纯 PNG 贴图方案 |
| 点击穿透在不同 DPI 缩放下命中偏移 | A4/A5 不达标 | M1-5 阶段用设备像素比换算，勿直接用 CSS 像素 |
| Mac 不签名被 Gatekeeper 拦截 | 用户流失 | M7-6 图文指引；二期补签名 |
| AI 生成形象与他人 IP 雷同 | 法律风险 | M4a-2 人工复核；必要时加一道检索比对 |
| 分发给普通人被当流氓软件 | 口碑 | M8-7 首次运行引导；不写注册表、不弹广告、不做任何联网 |

---

## 7. 开工第一步（可立即执行）

```bash
cd C:/Users/Lenovo/Desktop/js-pet
npm init -y
npm i -D electron@latest electron-builder@latest
```

然后按 **M0-1 → M0-6** 顺序落地骨架，跑通 `npm start` 看到第一个透明窗口，即完成 M0。

---

## 8. 明确排除在本次计划外（来自 PRD 第 9 章）

账号 / 云同步 · 自动更新 · 代码签名与公证 · 应用商店上架 · 自由寻路漫游 · 多只宠物 · 音效语音 · 成就图鉴 · 崩溃上报埋点 · 任何形式联网

> 这些不是"忘了写"，是 PRD 明确划出范围的**故意不做**。
