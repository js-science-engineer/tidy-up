'use strict';

/**
 * L1 宠物窗口：透明、无边框、置顶、不占任务栏、默认鼠标穿透。
 * 对应 PRD 2.1 的"桌面层"与验收 A2 / A3 / A4 / A5。
 */

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { PET_WINDOW, buildPetWindowOptions } = require('./petWindowOptions');
const { clampToDisplays, defaultPosition } = require('./display');

let petWin = null;

/**
 * @param {{x:number,y:number}|null} savedPos 上次记忆的位置
 * @returns {BrowserWindow}
 */
function createPetWindow(savedPos) {
  const displays = screen.getAllDisplays();
  const pos = savedPos && Number.isFinite(savedPos.x)
    ? clampToDisplays(savedPos, displays, PET_WINDOW)
    : defaultPosition(displays, PET_WINDOW);

  petWin = new BrowserWindow(buildPetWindowOptions(pos));

  // 'screen-saver' 层级才能压住大部分全屏窗口；配合 visibleOnAllWorkspaces 覆盖多桌面
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 默认整窗穿透，但把鼠标事件转发给渲染进程；
  // 渲染进程命中宠物本体时再 IPC 关掉穿透（见 renderer/pet/pet.js）
  petWin.setIgnoreMouseEvents(true, { forward: true });

  petWin.loadFile(path.join(__dirname, '..', 'renderer', 'pet', 'index.html'));

  let shown = false;
  const show = () => {
    if (shown || !petWin || petWin.isDestroyed()) return;
    shown = true;
    petWin.showInactive(); // 不抢焦点，避免打断用户正在做的事
  };
  petWin.once('ready-to-show', show);
  petWin.webContents.once('did-finish-load', show);
  setTimeout(show, 1500); // 透明窗口在个别环境下 ready-to-show 不触发，兜底

  petWin.on('closed', () => { petWin = null; });
  return petWin;
}

function getPetWindow() {
  return petWin && !petWin.isDestroyed() ? petWin : null;
}

/** 把窗口移动到指定坐标（已钳制）并返回最终坐标 */
function movePetTo(x, y) {
  const win = getPetWindow();
  if (!win) return null;
  const next = clampToDisplays({ x, y }, screen.getAllDisplays(), PET_WINDOW);
  win.setPosition(next.x, next.y, false);
  return next;
}

/** 当前窗口位置 */
function getPetPosition() {
  const win = getPetWindow();
  if (!win) return null;
  const b = win.getBounds();
  return { x: b.x, y: b.y };
}

module.exports = { createPetWindow, getPetWindow, movePetTo, getPetPosition };
