/* ============================================================================
 * JsPetLookSlots — 形象视图槽位定义（主进程 / 渲染进程 / 测试共用）
 * ----------------------------------------------------------------------------
 * 采用 UMD 包装：Node 里 require，浏览器里挂到 window.JsPetLookSlots
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JsPetLookSlots = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 一个形象必须/可选具备的视图 */
  const VIEW_KEYS = ['front', 'side', 'back', 'side2', 'wave', 'sleep'];
  const REQUIRED_VIEW_KEYS = ['front', 'side', 'back'];
  const OPTIONAL_VIEW_KEYS = ['side2', 'wave', 'sleep'];
  const VIEW_LABEL = {
    front: '正面', side: '侧面', back: '背面',
    side2: '另一侧面', wave: '招手', sleep: '打盹',
  };
  /** 3D 转身圆柱上四个面的顺序（0=正 90=右侧 180=背 270=左侧） */
  const CYLINDER_ORDER = ['front', 'side', 'back', 'side2'];

  /**
   * 补全缺失视图：另一侧面缺省用侧面镜像；招手/打盹缺省用正面。
   * @param {Object<string,string>} views
   */
  function resolveViews(views) {
    const v = views || {};
    return {
      front: v.front,
      side: v.side,
      back: v.back,
      side2: v.side2 || v.side,
      wave: v.wave || v.front,
      sleep: v.sleep || v.front,
    };
  }

  /** 是否具备"能转身"的最低要求（正面/侧面/背面齐全且非空字符串） */
  function isValidViews(views) {
    if (!views || typeof views !== 'object') return false;
    return REQUIRED_VIEW_KEYS.every(
      (k) => typeof views[k] === 'string' && views[k].length > 0
    );
  }

  return {
    VIEW_KEYS, REQUIRED_VIEW_KEYS, OPTIONAL_VIEW_KEYS, VIEW_LABEL,
    CYLINDER_ORDER, resolveViews, isValidViews,
  };
});
