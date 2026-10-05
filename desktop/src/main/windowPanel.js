'use strict';

/**
 * L3 面板窗口（M5-1）：单例、复用、关闭即隐藏。
 * 对应 PRD 2.2：养成 / 形象 / 设置 三个页签的宿主。
 */

const path = require('path');
const { BrowserWindow } = require('electron');

const PANEL_SIZE = { width: 420, height: 600 };

let panelWin = null;
let quitting = false;

function buildPanelOptions() {
  return {
    width: PANEL_SIZE.width,
    height: PANEL_SIZE.height,
    minWidth: 380,
    minHeight: 480,
    show: false,
    title: 'js-pet',
    autoHideMenuBar: true,
    resizable: true,
    backgroundColor: '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  };
}

function createPanelWindow() {
  panelWin = new BrowserWindow(buildPanelOptions());
  panelWin.setMenuBarVisibility(false);
  panelWin.loadFile(path.join(__dirname, '..', 'renderer', 'panel', 'index.html'));

  // 关闭即隐藏：面板不销毁，下次秒开；真正退出时由 quitting 放行
  panelWin.on('close', (e) => {
    if (!quitting && panelWin && !panelWin.isDestroyed()) {
      e.preventDefault();
      panelWin.hide();
    }
  });
  panelWin.on('closed', () => { panelWin = null; });
  return panelWin;
}

/** 打开（或聚焦）面板 */
function openPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    if (panelWin.isMinimized()) panelWin.restore();
    panelWin.show();
    panelWin.focus();
    return panelWin;
  }
  const win = createPanelWindow();
  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) win.show();
  });
  return win;
}

/** 关闭按钮行为（托盘菜单用）：隐藏 */
function hidePanel() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.hide();
}

function getPanelWindow() {
  return panelWin && !panelWin.isDestroyed() ? panelWin : null;
}

/** 真退出前调用：放行 close 事件 */
function markQuitting() {
  quitting = true;
}

module.exports = { openPanel, hidePanel, getPanelWindow, markQuitting, PANEL_SIZE };
