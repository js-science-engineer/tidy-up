'use strict';

/**
 * IPC 路由。所有渲染进程能触达的能力都必须在这里显式登记（白名单），
 * 对应 PRD 验收 H2：渲染进程无法直接访问 Node / 文件系统。
 */

const { ipcMain, BrowserWindow, screen, app, dialog } = require('electron');
const fs = require('fs');
const { clampToDisplays } = require('./display');
const { PET_WINDOW } = require('./petWindowOptions');
const { mergeSettings } = require('./store/settings');
const { applyAutoStart, readAutoStart } = require('./autostart');
const stats = require('../shared/stats');

/** 收集到的所有"退出前需要 flush"的回调 */
const flushHooks = [];

function winOf(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerWindowIpc() {
  ipcMain.on('win:setIgnoreMouse', (event, ignore) => {
    const win = winOf(event);
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  ipcMain.handle('win:getBounds', (event) => {
    const win = winOf(event);
    if (!win || win.isDestroyed()) return null;
    return win.getBounds();
  });

  ipcMain.handle('win:setPos', (event, pos) => {
    const win = winOf(event);
    if (!win || win.isDestroyed()) return null;
    const next = clampToDisplays(
      { x: pos && pos.x, y: pos && pos.y },
      screen.getAllDisplays(),
      PET_WINDOW
    );
    win.setPosition(next.x, next.y, false);
    return next;
  });

  ipcMain.handle('win:moveBy', (event, delta) => {
    const win = winOf(event);
    if (!win || win.isDestroyed()) return null;
    const b = win.getBounds();
    const next = clampToDisplays(
      { x: b.x + (delta && delta.dx || 0), y: b.y + (delta && delta.dy || 0) },
      screen.getAllDisplays(),
      PET_WINDOW
    );
    win.setPosition(next.x, next.y, false);
    return next;
  });

  ipcMain.handle('win:displays', () => {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      isPrimary: d.id === primaryId,
      workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
    }));
  });
}

function registerStateIpc(ctx) {
  ipcMain.handle('state:load', () => {
    const d = ctx.repo.data;
    if (!d) return null;
    const out = JSON.parse(JSON.stringify(d));
    // 读取时先做一次时间结算，保证 UI 拿到的永远是当前状态
    out.stats = stats.tick(out.stats, Date.now());
    return out;
  });

  ipcMain.handle('state:patch', (_e, partial) => {
    if (!partial || typeof partial !== 'object') return false;
    // 只允许白名单一级字段，防止渲染进程乱写
    const ALLOWED = ['position', 'display', 'currentLookId', 'stats', 'settings'];
    const clean = {};
    for (const k of ALLOWED) if (k in partial) clean[k] = partial[k];
    if (Object.keys(clean).length) ctx.repo.patch(clean);
    return true;
  });

  ipcMain.handle('state:flush', () => ctx.repo.flush());

  ipcMain.handle('state:notices', () => ctx.repo.notices.splice(0));
}

/** 养成互动：喂食 / 抚摸 / 玩耍。主进程是唯一写入者。 */
function registerStatsIpc(ctx) {
  ipcMain.handle('stats:interact', (_e, kind) => {
    const d = ctx.repo.data;
    if (!d) return { ok: false, reason: 'not-ready' };
    if (stats.INTERACTIONS.indexOf(kind) < 0) return { ok: false, reason: 'unknown' };

    const prevLevel = d.stats.level;
    const r = stats.applyInteraction(d.stats, kind, Date.now());
    if (!r.ok) {
      // 失败也要把结算后的状态存回去（时间在流逝）
      ctx.repo.patch({ stats: r.stats });
      return { ok: false, reason: r.reason, stats: r.stats };
    }
    ctx.repo.patch({ stats: r.stats });
    const leveledUp = r.stats.level > prevLevel;
    return {
      ok: true,
      bondGained: !!r.bondGained,
      leveledUp,
      reason: leveledUp ? 'levelup' : undefined,
      stats: r.stats,
    };
  });

  /** 只读：当前等级进度（面板用） */
  ipcMain.handle('stats:progress', () => {
    const d = ctx.repo.data;
    return d ? stats.progressFor(d.stats.bond) : null;
  });
}

/** 形象管理（M4b）：列表 / 视图 / 上传导入 / 删除 / 切换 */
function registerLooksIpc(ctx) {
  ipcMain.handle('looks:list', () => ctx.looks.list());

  ipcMain.handle('looks:getViews', (_e, id) => {
    try {
      return { ok: true, views: ctx.looks.viewsFor(String(id || '')) };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });

  ipcMain.handle('looks:import', (_e, payload) => {
    try {
      const p = payload || {};
      const buf = p.buffer instanceof Uint8Array ? Buffer.from(p.buffer) : p.buffer;
      const r = ctx.looks.importPng({ name: p.name, buffer: buf });
      const views = ctx.looks.viewsFor(r.id);
      if (ctx.onLookChanged) ctx.onLookChanged(r.id, views);
      return { ok: true, id: r.id, name: r.name, views };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });

  ipcMain.handle('looks:remove', (_e, id) => {
    try {
      ctx.looks.remove(String(id || ''));
      if (ctx.onLookChanged) ctx.onLookChanged(null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });

  ipcMain.handle('looks:setCurrent', (_e, id) => {
    try {
      const views = ctx.looks.setCurrent(String(id || ''));
      if (ctx.onLookChanged) ctx.onLookChanged(String(id || ''), views);
      return { ok: true, views };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });
}

/** 面板（M5）：打开面板 / 设置读写 / 数据备份恢复导出导入 */
function registerPanelIpc(ctx) {
  ipcMain.on('panel:open', () => {
    if (ctx.openPanel) ctx.openPanel();
  });

  /** 面板加载后取走"通过托盘/菜单跳转来的页签"（M6） */
  ipcMain.handle('panel:takeTab', () => {
    const t = ctx.takePanelTab ? ctx.takePanelTab() : null;
    return t || 'grow';
  });

  /** 设置读取：本地设置 + 系统实际自启状态 + 版本号 */
  ipcMain.handle('settings:get', () => {
    const d = ctx.repo.data;
    return {
      settings: d ? d.settings : null,
      autostart: readAutoStart(app),
      version: app.getVersion(),
    };
  });

  /** 设置提交：合并校验 → 落盘 → 同步系统自启 → 实时推给宠物窗口 → 刷新托盘 */
  ipcMain.handle('settings:apply', (_e, patch) => {
    const d = ctx.repo.data;
    if (!d) return { ok: false, reason: '数据未就绪' };
    if (ctx.applySettingsPatch) return ctx.applySettingsPatch(patch);
    // 兜底路径（测试/无托盘环境）
    const merged = mergeSettings(d.settings, patch);
    if (!merged.ok) return merged;
    ctx.repo.patch({ settings: merged.settings });
    applyAutoStart(app, merged.settings.autoStart);
    const petWin = ctx.getPetWindow && ctx.getPetWindow();
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('settings:changed', merged.settings);
    return { ok: true, settings: merged.settings };
  });

  /** M6：宠物身上右键 → 主进程弹统一菜单 */
  ipcMain.on('menu:pet-context', (event, pos) => {
    if (ctx.showPetContextMenu) ctx.showPetContextMenu(pos || {}, event.sender);
  });

  /** 立即备份 */
  ipcMain.handle('data:backupNow', async () => {
    try {
      const file = await ctx.repo.backupNow();
      return { ok: true, file };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });

  ipcMain.handle('data:listBackups', async () => {
    try {
      return { ok: true, backups: await ctx.repo.listBackups() };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });

  /** 导出数据到用户选择的位置（PRD 7.4） */
  ipcMain.handle('data:export', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const r = await dialog.showSaveDialog(win, {
        title: '导出 js-pet 数据',
        defaultPath: 'js-pet-backup.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, reason: 'canceled' };
      fs.writeFileSync(r.filePath, JSON.stringify(ctx.repo.exportObject(), null, 2), 'utf8');
      return { ok: true, file: r.filePath };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });

  /** 从用户选择的备份恢复（校验在 repository.restoreFromObject 里做，F2） */
  ipcMain.handle('data:import', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const r = await dialog.showOpenDialog(win, {
        title: '恢复 js-pet 数据',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'canceled' };
      const res = await ctx.repo.restoreFromFile(r.filePaths[0]);
      if (!res.ok) return res;
      // 恢复后让宠物窗口与面板都拿到新状态
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue;
        w.webContents.send('look:changed', null); // 恢复数据可能换形象，回退后由页面重拉
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });
}

function registerAllIpc(ctx) {
  registerWindowIpc();
  registerStateIpc(ctx);
  registerStatsIpc(ctx);
  registerLooksIpc(ctx);
  registerPanelIpc(ctx);
}

module.exports = {
  registerAllIpc, registerWindowIpc, registerStateIpc, registerStatsIpc, registerLooksIpc, registerPanelIpc,
  flushHooks,
};
