'use strict';

/**
 * 宠物窗口的尺寸与创建参数。
 * ---------------------------------------------------------------
 * 抽成独立模块（而不是内联在 windowPet.js 里）的原因：
 * 这些参数直接对应 PRD 验收条款 A2 / A3，必须是可单元测试的纯函数，
 * 不允许"看起来配了但其实没生效"。
 */

const path = require('path');

/** 宠物窗口固定尺寸：宠物本体 200x250，上方留气泡空间，下方留阴影空间 */
const PET_WINDOW = Object.freeze({ width: 320, height: 400 });

/**
 * 构造 BrowserWindow 参数
 * @param {{x:number,y:number}|null} pos 已钳制过的屏幕坐标
 * @returns {object}
 */
function buildPetWindowOptions(pos) {
  const hasPos = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y);
  return {
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    ...(hasPos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : {}),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    focusable: true,
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  };
}

module.exports = { PET_WINDOW, buildPetWindowOptions };
