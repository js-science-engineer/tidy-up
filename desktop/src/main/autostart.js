'use strict';

/**
 * 开机自启（M5-4）。对应 PRD 验收 E2。
 * Electron 的 app.setLoginItemSettings 是平台相关副作用，这里把它包成
 * 可注入 fake app 的纯逻辑，便于单元测试；主进程只传真实的 app 进来。
 */

/**
 * 应用自启设置到系统登录项。
 * @param {{setLoginItemSettings:Function, getLoginItemSettings:Function, getPath:Function}} appLike
 * @param {boolean} enabled
 * @returns {boolean} 应用后的实际状态
 */
function applyAutoStart(appLike, enabled) {
  const want = !!enabled;
  appLike.setLoginItemSettings({
    openAtLogin: want,
    openAsHidden: true, // 自启时隐藏窗口更友好（宠物窗口本就不抢焦点）
    path: process.execPath,
  });
  return readAutoStart(appLike);
}

/** 读取系统当前自启状态（以系统为准，不信任本地配置） */
function readAutoStart(appLike) {
  try {
    const s = appLike.getLoginItemSettings();
    return !!s.openAtLogin;
  } catch (_) {
    return false;
  }
}

module.exports = { applyAutoStart, readAutoStart };
