'use strict';

/**
 * M6 系统托盘：图标 + 左键显隐 + 右键菜单。
 * 菜单模板与宠物右键菜单共用 menus.js；状态变化后调用 rebuild() 刷新勾选态。
 */

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const { buildMenuTemplate } = require('./menus');

let tray = null;

function iconImage() {
  // 打包后 __dirname 在 asar 内，icon.png 随 files 白名单进包
  const p = path.join(__dirname, '..', 'assets', 'icon.png');
  const img = nativeImage.createFromPath(p);
  img.setTemplateImage(false);
  return img;
}

/**
 * @param {object} ctx
 *   getState: () => ({petVisible, wanderEnabled, autoStart})
 *   actions:  菜单动作表（见 menus.js）
 */
function createTray(ctx) {
  if (tray) return tray;
  tray = new Tray(iconImage());
  tray.setToolTip('js-pet · 桌面电子宠物');

  // 左键：显示/隐藏宠物（Windows 上左键不弹菜单）
  tray.on('click', () => {
    const s = ctx.getState();
    if (s.petVisible) ctx.actions.hidePet();
    else ctx.actions.showPet();
  });

  rebuildTray(ctx);
  return tray;
}

/** 用最新状态重建右键菜单（勾选态与设置同步，验收 E1） */
function rebuildTray(ctx) {
  if (!tray) return;
  const menu = Menu.buildFromTemplate(buildMenuTemplate({
    state: ctx.getState(),
    actions: ctx.actions,
  }));
  tray.setContextMenu(menu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, rebuildTray, destroyTray, iconImage };
