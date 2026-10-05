'use strict';

/**
 * 多显示器 / DPI 坐标钳制。
 * ---------------------------------------------------------------
 * 记忆的坐标是"虚拟桌面绝对坐标"。用户拔掉外接屏后，这个坐标可能落在
 * 不存在的区域，宠物就会飞到看不见的地方。启动时必须钳回可见区域。
 * 对应 PRD 验收 A3 的稳定性要求与 DEV_PLAN M1-5。
 * 纯函数，不依赖 electron，可直接单元测试。
 */

const DEFAULT_MARGIN = 24;

/**
 * 判断某个点落在哪块显示器的工作区内
 * @param {{x:number,y:number}} pos
 * @param {Array} displays [{ workArea:{x,y,width,height}, isPrimary }]
 * @returns {object|null}
 */
function findDisplayFor(pos, displays) {
  if (!Array.isArray(displays)) return null;
  for (const d of displays) {
    const a = d && d.workArea;
    if (!a) continue;
    if (pos.x >= a.x && pos.x < a.x + a.width && pos.y >= a.y && pos.y < a.y + a.height) return d;
  }
  return null;
}

/**
 * 把窗口坐标钳制到合法可见区域
 * @param {{x:number,y:number}} pos 期望坐标
 * @param {Array} displays 显示器列表（来自 screen.getAllDisplays()）
 * @param {{width:number,height:number}} size 窗口尺寸
 * @param {number} [margin]
 * @returns {{x:number,y:number}}
 */
function clampToDisplays(pos, displays, size, margin) {
  const m = Number.isFinite(margin) ? margin : DEFAULT_MARGIN;
  const desired = { x: Math.round(pos && pos.x) || 0, y: Math.round(pos && pos.y) || 0 };

  if (!Array.isArray(displays) || displays.length === 0) return desired;

  const host = findDisplayFor(desired, displays);
  if (host) {
    const a = host.workArea;
    const maxX = Math.max(a.x, a.x + a.width - size.width);
    const maxY = Math.max(a.y, a.y + a.height - size.height);
    return {
      x: Math.min(Math.max(desired.x, a.x), maxX),
      y: Math.min(Math.max(desired.y, a.y), maxY),
    };
  }

  // 坐标不在任何显示器内（例如拔掉了外接屏）→ 回主屏右下角
  const primary = displays.find((d) => d && d.isPrimary) || displays[0];
  const a = primary.workArea;
  return {
    x: Math.round(Math.max(a.x, a.x + a.width - size.width - m)),
    y: Math.round(Math.max(a.y, a.y + a.height - size.height - m)),
  };
}

/** 默认起始位置：主屏右下角 */
function defaultPosition(displays, size, margin) {
  const m = Number.isFinite(margin) ? margin : DEFAULT_MARGIN;
  if (!Array.isArray(displays) || displays.length === 0) {
    return { x: 0, y: 0 };
  }
  const primary = displays.find((d) => d && d.isPrimary) || displays[0];
  const a = primary.workArea;
  return {
    x: Math.round(Math.max(a.x, a.x + a.width - size.width - m)),
    y: Math.round(Math.max(a.y, a.y + a.height - size.height - m)),
  };
}

module.exports = { clampToDisplays, defaultPosition, findDisplayFor, DEFAULT_MARGIN };
