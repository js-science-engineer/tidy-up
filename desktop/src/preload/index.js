'use strict';

/**
 * preload 桥。渲染进程唯一能触达主进程的通道。
 * 安全基线（PRD 附录 B / 验收 H2）：
 *   contextIsolation: true + sandbox: true → 渲染进程拿不到 require / process / fs。
 * 这里只暴露白名单方法，不暴露任何原始 ipcRenderer。
 */

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('jsPet', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },

  win: {
    setIgnoreMouse: (ignore) => ipcRenderer.send('win:setIgnoreMouse', !!ignore),
    getBounds: () => ipcRenderer.invoke('win:getBounds'),
    setPos: (x, y) => ipcRenderer.invoke('win:setPos', { x, y }),
    moveBy: (dx, dy) => ipcRenderer.invoke('win:moveBy', { dx, dy }),
    displays: () => ipcRenderer.invoke('win:displays'),
  },

  /** 养成与设置数据（PRD 第 7 章：主进程是唯一写入者） */
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    patch: (partial) => ipcRenderer.invoke('state:patch', partial),
    flush: () => ipcRenderer.invoke('state:flush'),
    notices: () => ipcRenderer.invoke('state:notices'),
  },

  /** 养成互动（喂食 / 抚摸 / 玩耍） */
  stats: {
    interact: (kind) => ipcRenderer.invoke('stats:interact', kind),
    progress: () => ipcRenderer.invoke('stats:progress'),
  },

  /** 形象管理（M4b）：列表 / 视图 / 上传导入 / 删除 / 切换 */
  looks: {
    list: () => ipcRenderer.invoke('looks:list'),
    getViews: (id) => ipcRenderer.invoke('looks:getViews', id),
    importLook: (name, buffer) => ipcRenderer.invoke('looks:import', { name, buffer }),
    remove: (id) => ipcRenderer.invoke('looks:remove', id),
    setCurrent: (id) => ipcRenderer.invoke('looks:setCurrent', id),
  },

  /** 面板与设置（M5） */
  panel: {
    open: () => ipcRenderer.send('panel:open'),
    takeTab: () => ipcRenderer.invoke('panel:takeTab'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    apply: (patch) => ipcRenderer.invoke('settings:apply', patch),
  },

  /** M6：宠物右键菜单（坐标为屏幕坐标，主进程在该处弹出） */
  menu: {
    petContext: (x, y) => ipcRenderer.send('menu:pet-context', { x, y }),
  },

  /** 数据备份 / 恢复 / 导出 / 导入（M5-3，PRD 7.4） */
  data: {
    backupNow: () => ipcRenderer.invoke('data:backupNow'),
    listBackups: () => ipcRenderer.invoke('data:listBackups'),
    exportToFile: () => ipcRenderer.invoke('data:export'),
    importFromFile: () => ipcRenderer.invoke('data:import'),
  },

  /** 预留：后续里程碑挂上来的事件订阅器 */
  on,
});
