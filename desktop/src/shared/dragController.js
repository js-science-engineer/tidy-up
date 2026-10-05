/* ============================================================================
 * JsPetDrag — 拖拽状态机 + 鼠标穿透决策（纯逻辑，渲染进程使用，可单测）
 * ----------------------------------------------------------------------------
 * ⚠️ 实测教训（勿删）：
 *   透明窗口 + setIgnoreMouseEvents 的组合下，拖拽期间一旦恢复穿透，
 *   后续指针事件会全部落到桌面，窗口立刻冻结、再也追不上指针。
 *   因此拖拽期间 mustIgnoreMouse() 必须恒为 false，
 *   且 pointerup 之前任何"指针没命中本体"的判定都不得恢复穿透。
 *
 * 坐标一律用 screenX/screenY（相对虚拟桌面），与主进程 win:moveBy 同一坐标系。
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JsPetDrag = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 小于该位移不算拖拽（避免点击被误判成拖动） */
  var MOVE_THRESHOLD = 4;

  /**
   * 创建拖拽控制器。
   * @param {{threshold?:number}} opts
   */
  function createDragController(opts) {
    var threshold = (opts && Number.isFinite(opts.threshold)) ? opts.threshold : MOVE_THRESHOLD;
    var down = null;      // {sx, sy}
    var dragging = false; // 已确认进入拖拽
    var accX = 0, accY = 0; // 待发送的累计位移

    return {
      get dragging() { return dragging; },

      /** pointerdown */
      onDown: function (screenX, screenY) {
        down = { sx: screenX, sy: screenY };
        dragging = false;
        accX = 0; accY = 0;
      },

      /**
       * pointermove
       * @returns {{moved:boolean, dx:number, dy:number}}
       *   moved=是否已进入拖拽；dx/dy=自上次消费后的累计位移（未进入拖拽时为 0）
       */
      onMove: function (screenX, screenY) {
        if (!down) return { moved: false, dx: 0, dy: 0 };
        var dx = screenX - down.sx, dy = screenY - down.sy;
        if (!dragging && Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
          return { moved: false, dx: 0, dy: 0 };
        }
        dragging = true;
        down.sx = screenX; down.sy = screenY;
        accX += dx; accY += dy;
        return { moved: true, dx: accX, dy: accY };
      },

      /**
       * 渲染进程消费掉累计位移后调用（发送 IPC 前取走、发送后清账）
       */
      takeDelta: function () {
        var out = { dx: accX, dy: accY };
        accX = 0; accY = 0;
        return out;
      },

      /** pointerup / pointercancel。@returns {boolean} 是否发生过拖拽 */
      onUp: function () {
        var wasDrag = dragging;
        down = null;
        dragging = false;
        accX = 0; accY = 0;
        return wasDrag;
      },

      /**
       * 鼠标穿透决策：拖拽中必须关闭穿透（false = 不穿透），
       * 否则按"指针是否悬停在本体上"决定。
       * @param {boolean} overPet 指针当前是否命中宠物本体
       */
      mustIgnoreMouse: function (overPet) {
        if (dragging) return false;
        return !overPet;
      },
    };
  }

  return { createDragController, MOVE_THRESHOLD };
});
