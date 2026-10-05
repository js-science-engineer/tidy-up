'use strict';

/**
 * js-pet 主进程入口。
 * 启动顺序：单实例锁 → 注册 IPC → 建宠物窗口 → （M2 起）加载数据 → 应用状态。
 */

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { registerAllIpc } = require('./ipc');
const { createPetWindow, getPetWindow } = require('./windowPet');
const { Repository } = require('./store/repository');
const { LooksStore } = require('./store/looksStore');
const { applyAutoStart } = require('./autostart');
const { mergeSettings } = require('./store/settings');
const { openPanel, getPanelWindow, markQuitting } = require('./windowPanel');
const stats = require('../shared/stats');

/**
 * 自定义形象协议 look://<id>/<view>.png → userData/looks/<id>/<view>.png
 * 必须在 app ready 之前登记为标准协议。
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'look', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * 无 GPU 环境下 Chromium 的 GPU 进程会反复崩溃并最终致命退出（CI / 虚拟机上常见）。
 * 冒烟自检与显式声明 JS_PET_DISABLE_GPU 时关闭硬件加速，走软件渲染。
 * 必须在 app ready 之前调用。
 */
if (process.env.JS_PET_SMOKE || process.env.JS_PET_DISABLE_GPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
}

/** 单实例锁：桌面宠物只允许存在一个进程，重复双击不会出现两只 */
const gotLock = app.requestSingleInstanceLock();

// 冒烟模式打点：打包版 stdout 拿不到，用文件记录启动进度便于诊断
function smokeMark(step, extra) {
  if (!process.env.JS_PET_SMOKE) return;
  try {
    const fs = require('fs');
    const p = path.join(app.getPath('userData'), 'smoke-steps.json');
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    arr.push(Object.assign({ step, at: new Date().toISOString() }, extra || {}));
    fs.writeFileSync(p, JSON.stringify(arr, null, 2));
  } catch (_) {}
}
smokeMark('module-loaded', { gotLock });

if (!gotLock) {
  app.quit();
} else {
  let repo = null;

  app.on('second-instance', () => {
    const win = getPetWindow();
    if (win) win.showInactive();
  });

  app.whenReady().then(async () => {
    smokeMark('ready');
    // PRD 7.1：数据落在用户目录
    const dataDir = app.getPath('userData');
    repo = new Repository(dataDir);
    await repo.init();
    smokeMark('repo-init');

    // M8-7 首次运行引导：说明"置顶 + 不联网"的设计，降低被误判为流氓软件的概率
    try {
      const fs = require('fs');
      if (!fs.existsSync(path.join(dataDir, 'pet-data.json'))) {
        repo.notices.push('初次见面，我是 js-pet！我会一直待在你桌面上陪你（右键我可以设置哦）。我不联网、不弹广告，数据只存在你这台电脑上。');
      }
    } catch (_) {}

    // M4b：形象仓储（内置 + 自定义上传）
    const looks = new LooksStore(repo);
    looks.init();
    protocol.handle('look', (req) => {
      try {
        // look://<id>/<view>.png → userData/looks/<id>/<view>.png
        const u = new URL(req.url);
        const id = u.hostname;
        const file = decodeURIComponent(u.pathname).replace(/^\/+/, '');
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !/^[a-z]+\.png$/.test(file)) {
          return new Response('bad look url', { status: 400 });
        }
        return net.fetch(pathToFileURL(path.join(looks.root, id, file)).toString());
      } catch (_) {
        return new Response('not found', { status: 404 });
      }
    });

    // 形象变化时实时推给宠物窗口（上传/切换/删除后无需重启）
    const onLookChanged = (id, views) => {
      const w = getPetWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('look:changed', views || null);
      }
    };

    /* ---------------- M6：托盘与右键菜单 ---------------- */
    const { dialog } = require('electron');
    const { createTray, rebuildTray } = require('./tray');
    const { buildMenuTemplate, interact } = require('./menus');

    const sendToPet = (channel, payload) => {
      const w = getPetWindow();
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    };

    let panelTabRequest = null;
    const openPanelTab = (tab) => {
      panelTabRequest = tab;
      const existing = getPanelWindow();
      if (existing) existing.webContents.send('panel:showTab', tab);
      openPanel();
    };

    /** 设置变更统一出口：落盘 + 自启同步 + 宠物实时生效 + 刷新托盘勾选态 */
    const applySettingsPatch = (patch) => {
      const merged = mergeSettings(repo.data.settings, patch);
      if (!merged.ok) return merged;
      repo.patch({ settings: merged.settings });
      try { applyAutoStart(app, merged.settings.autoStart); } catch (_) {}
      sendToPet('settings:changed', merged.settings);
      rebuildTray(trayCtx);
      return merged;
    };

    const menuInteract = (kind) => {
      const r = interact(repo, stats, kind);
      sendToPet('pet:act', { kind, ok: r.ok, reason: r.reason });
      return r;
    };

    const trayCtx = {
      getState: () => {
        const w = getPetWindow();
        return {
          petVisible: !!(w && w.isVisible()),
          wanderEnabled: !!repo.data.settings.wanderEnabled,
          autoStart: !!repo.data.settings.autoStart,
        };
      },
      actions: {
        showPet: () => { const w = getPetWindow(); if (w) w.showInactive(); },
        hidePet: () => { const w = getPetWindow(); if (w) w.hide(); },
        feed: () => menuInteract('feed'),
        pet: () => menuInteract('pet'),
        play: () => menuInteract('play'),
        sleep: () => sendToPet('pet:act', { kind: 'sleep', ok: true }),
        openLooks: () => openPanelTab('looks'),
        openSettings: () => openPanelTab('settings'),
        toggleWander: (v) => applySettingsPatch({ wanderEnabled: !!v }),
        toggleAutoStart: (v) => applySettingsPatch({ autoStart: !!v }),
        showAbout: () => {
          dialog.showMessageBox({
            type: 'info',
            title: 'js-pet',
            message: 'js-pet v' + app.getVersion(),
            detail: '桌面电子宠物 · 数据只保存在本机，不联网、不上传。\n养成 | 形象 | 漫游，陪你工作每一天。',
            buttons: ['好'],
          });
        },
        quit: () => app.quit(),
      },
    };

    registerAllIpc({
      repo,
      looks,
      onLookChanged,
      getPetWindow,
      openPanel,
      takePanelTab: () => {
        const t = panelTabRequest;
        panelTabRequest = null;
        return t;
      },
      applySettingsPatch,
      showPetContextMenu: (_pos, sender) => {
        const { Menu } = require('electron');
        const win = BrowserWindow.fromWebContents(sender);
        Menu.buildFromTemplate(buildMenuTemplate(trayCtx)).popup({
          window: win || undefined,
        });
      },
    });

    // M6-1：托盘
    createTray(trayCtx);

    // M5-4：按本地设置同步系统自启（用户在系统层关掉过的话这里自愈）
    try {
      if (repo.data.settings.autoStart) applyAutoStart(app, true);
    } catch (_) {}

    // M3-2 启动即做一次离线结算；M3-3 运行中每 60s 结算一次
    const settle = () => {
      try {
        const s = stats.tick(repo.data.stats, Date.now());
        repo.patch({ stats: s });
      } catch (_) {}
    };
    settle();
    setInterval(settle, 60 * 1000).unref();

    const win = createPetWindow(null);
    smokeMark('pet-window-created');

    // 冒烟自检：JS_PET_SMOKE=1 时启动后收集错误并断言接口就绪，随后自动退出
    if (process.env.JS_PET_SMOKE) {
      const errors = [];
      win.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2) errors.push('renderer console: ' + message);
      });
      win.webContents.on('render-process-gone', (_e, details) => {
        errors.push('renderer gone: ' + details.reason);
      });
      win.webContents.on('did-fail-load', (_e, code, desc) => {
        errors.push('did-fail-load: ' + code + ' ' + desc);
      });
      win.webContents.on('preload-error', (_e, p, err) => {
        errors.push('preload-error: ' + p + ' ' + err);
      });
      win.webContents.on('did-finish-load', async () => {
        try {
          const probe = await win.webContents.executeJavaScript(`(function () {
            const api = window.jsPet;
            const r = window.jsPetRenderer;
            return {
              hasApi: !!api,
              hasWin: !!(api && api.win),
              hasState: !!(api && api.state),
              hasStats: !!(api && api.stats),
              hasLooks: !!(api && api.looks),
              hasRenderer: !!r,
              hasStage: !!document.querySelector('.pet-stage'),
              // H2 安全自查：渲染进程拿不到任何 Node 能力
              nodeIsolated: typeof require === 'undefined' &&
                typeof process === 'undefined' &&
                typeof module === 'undefined' &&
                typeof global === 'undefined',
            };
          })()`);
          const missing = Object.keys(probe).filter((k) => !probe[k]);
          if (missing.length) errors.push('missing on boot: ' + missing.join(','));
        } catch (err) {
          errors.push('probe failed: ' + (err && err.message));
        }
      });

      // M5：冒烟同时打开面板窗口，验证面板页面与 preload 都健康
      const panelWin = openPanel();
      panelWin.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2) errors.push('panel console: ' + message);
      });
      panelWin.webContents.on('did-fail-load', (_e, code, desc) => {
        errors.push('panel did-fail-load: ' + code + ' ' + desc);
      });
      panelWin.webContents.on('preload-error', (_e, p, err) => {
        errors.push('panel preload-error: ' + p + ' ' + err);
      });
      panelWin.webContents.on('did-finish-load', async () => {
        try {
          const probe = await panelWin.webContents.executeJavaScript(`(function () {
            const api = window.jsPet;
            return {
              hasApi: !!api,
              hasSettings: !!(api && api.settings),
              hasLooks: !!(api && api.looks),
              hasData: !!(api && api.data),
              hasTabs: document.querySelectorAll('.tab-btn').length === 3,
            };
          })()`);
          const missing = Object.keys(probe).filter((k) => !probe[k]);
          if (missing.length) errors.push('panel missing on boot: ' + missing.join(','));
        } catch (err) {
          errors.push('panel probe failed: ' + (err && err.message));
        }
      });
      setTimeout(() => {
        const result = errors.length
          ? { ok: false, errors }
          : { ok: true };
        // 打包版（GUI 子系统）stdout 拿不到，同时落一份结果文件供外部校验
        try {
          const fs = require('fs');
          fs.writeFileSync(
            path.join(app.getPath('userData'), 'smoke-result.json'),
            JSON.stringify(Object.assign({ at: new Date().toISOString() }, result), null, 2)
          );
        } catch (_) {}
        if (errors.length) {
          try { console.error('SMOKE_FAIL\n' + errors.join('\n')); } catch (_) {}
          app.exit(1);
          process.exit(1);
        }
        // 保险退出：打包版（GUI 子系统）stdout 可能是无效句柄，
        // console.* 万一抛错也不能拦住退出；app.exit 后再 process.exit 兜底
        try { console.log('SMOKE_OK'); } catch (_) {}
        app.exit(0);
        process.exit(0);
      }, 5000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createPetWindow(null);
    });
  }).catch((err) => {
    // 启动初始化失败（如数据目录不可写）必须退出，绝不留看不见的僵尸进程
    console.error('SMOKE_FAIL boot failed: ' + (err && err.stack || err));
    smokeMark('boot-failed', { error: String(err && err.stack || err) });
    app.exit(1);
  });

  // 桌面宠物：窗口全关即退出（M6 接入托盘后改为"只隐藏不退出"）
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', async () => {
    // PRD 7.3：退出前必须 flush，保证关闭/重启不丢数据（验收 B1/B2/B3）
    markQuitting(); // 放行面板 close 事件
    if (repo) {
      try { await repo.close(); } catch (_) {}
    }
  });
}
