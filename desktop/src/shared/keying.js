/* ============================================================================
 * JsPetKeying — 背景抠除 / 去噪点 / 羽化（纯函数，构建工具与渲染进程共用）
 * ----------------------------------------------------------------------------
 * 适用两种背景：
 *   neutral：白底 / 棋盘格 / 纯色浅灰（用饱和度判定）
 *   green  ：纯色绿幕（用绿色通道优势判定，最可靠）
 * 通过 detectBackground 自动识别。
 *
 * ⚠️ 经验教训（实测得出，勿删）：
 *   淡色角色的"渐变过渡带"饱和度会掉到和浅灰背景一样低，
 *   单纯按饱和度抠图会把角色打穿。因此必须：
 *     1) 泛洪只从画布四边吃起
 *     2) 抠完必须做 interiorHoleCount / 中轴连贯性校验
 *
 * 数据布局与 Canvas ImageData / pngjs 一致：RGBA，每像素 4 字节。
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JsPetKeying = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 中性背景（白/棋盘格/浅灰）：饱和度低于阈值 */
  function isBgNeutral(data, i, satThreshold) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return (mx - mn) < satThreshold;
  }

  /** 绿幕背景：绿色通道显著高于红蓝（固定阈值版，兼容旧调用） */
  function isBgGreen(data, i) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return (g - r) > 25 && (g - b) > 25;
  }

  /**
   * 自适应绿幕阈值（按实际检测到的背景色推算）。
   * ⚠️ 经验教训（实测得出，勿删）：
   *   固定阈值 25 会把角色下身的"蓝绿过渡色"（g-r 可到 79）一起抠掉，
   *   在肚子上打出透明洞。真实绿幕 (0,148,21) 的 g-r≈130、g-b≈125，
   *   取背景色差的 70% 做阈值（下限 40），既留出抗噪边距，
   *   又能容住角色的青绿色渐变。
   */
  function greenThresholds(bgRgb) {
    const b = bgRgb || [0, 140, 30];
    return {
      gr: Math.max(40, (b[1] - b[0]) * 0.7),
      gb: Math.max(40, (b[1] - b[2]) * 0.7),
    };
  }

  /** 按自适应阈值判定单个像素是否为绿幕背景 */
  function isBgGreenAt(data, i, th) {
    const g = data[i + 1];
    return (g - data[i]) > th.gr && (g - data[i + 2]) > th.gb;
  }

  /**
   * 识别背景类型。
   * @returns {{mode:'green'|'neutral', rgb:[number,number,number]}}
   */
  function detectBackground(data, w, h) {
    let n = 0, rs = 0, gs = 0, bs = 0;
    const step = Math.max(1, Math.round(Math.min(w, h) / 100));
    for (let x = 0; x < w; x += step) {
      for (const y of [0, h - 1]) {
        const i = (y * w + x) * 4;
        rs += data[i]; gs += data[i + 1]; bs += data[i + 2]; n++;
      }
    }
    for (let y = 0; y < h; y += step) {
      for (const x of [0, w - 1]) {
        const i = (y * w + x) * 4;
        rs += data[i]; gs += data[i + 1]; bs += data[i + 2]; n++;
      }
    }
    const r = rs / n, g = gs / n, b = bs / n;
    if (g - r > 20 && g - b > 20) return { mode: 'green', rgb: [r, g, b] };
    return { mode: 'neutral', rgb: [r, g, b] };
  }

  /**
   * 从四边泛洪抠背景。只吃与画布边缘连通的背景像素。
   * @returns {{eaten:number, mode:string}}
   */
  function keyOut(data, w, h, opts) {
    const o = opts || {};
    const kind = o.mode || detectBackground(data, w, h).mode;
    const sat = Number.isFinite(o.satThreshold) ? o.satThreshold : 9;
    let pred;
    if (kind === 'green') {
      const th = greenThresholds(o.bgRgb || detectBackground(data, w, h).rgb);
      pred = (i) => isBgGreenAt(data, i, th);
    } else {
      pred = (i) => isBgNeutral(data, i, sat);
    }

    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
      const k = y * w + x;
      if (seen[k]) return;
      seen[k] = 1;
      if (pred(k * 4)) stack.push(k);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

    let eaten = 0;
    while (stack.length) {
      const k = stack.pop();
      data[k * 4 + 3] = 0;
      eaten++;
      const x = k % w, y = (k / w) | 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    return { eaten, mode: kind };
  }

  /**
   * 漏抠统计：被角色包围、没被泛洪吃到的背景色像素数。
   * -----------------------------------------------------------
   * ⚠️ 不要用"统计内部透明洞"来做校验——四边泛洪产生的透明区必然与
   *    画布边缘连通，那个数恒为 0，是无意义的检查。
   *    真正有意义的反向校验是：还有多少"背景色但不透明"的像素
   *    没有被泛洪触达（通常是角色身体圈起来的封闭区域）。
   */
  function missedBackgroundCount(data, w, h, opts) {
    const o = opts || {};
    const kind = o.mode || detectBackground(data, w, h).mode;
    const sat = Number.isFinite(o.satThreshold) ? o.satThreshold : 9;
    let pred;
    if (kind === 'green') {
      const th = greenThresholds(o.bgRgb || detectBackground(data, w, h).rgb);
      pred = (i) => isBgGreenAt(data, i, th);
    } else {
      pred = (i) => isBgNeutral(data, i, sat);
    }

    const passable = (k) => data[k * 4 + 3] === 0 || pred(k * 4);
    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
      const k = y * w + x;
      if (seen[k] || !passable(k)) return;
      seen[k] = 1; stack.push(k);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const k = stack.pop();
      const x = k % w, y = (k / w) | 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    let miss = 0;
    for (let k = 0; k < w * h; k++) {
      if (data[k * 4 + 3] !== 0 && pred(k * 4) && !seen[k]) miss++;
    }
    return miss;
  }

  /** 只对"紧贴透明像素"的边缘做 3x3 alpha 均值，去掉锯齿 */
  function feather(data, w, h) {
    const a = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = data[i * 4 + 3];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        const av = a[k];
        if (av === 0 || av >= 254) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (a[k + dy * w + dx] === 0) { edge = true; break; }
          }
        }
        if (!edge) continue;
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) s += a[k + dy * w + dx];
        }
        data[k * 4 + 3] = Math.round(s / 9);
      }
    }
  }

  /**
   * 去噪点：只保留最大的不透明连通域（棋盘格残片等碎片清掉）。
   * @param {number} [ratio] 小于最大连通域该比例的碎片才清除，默认 0.02
   * @returns {number} 清除的像素数
   */
  function despeckle(data, w, h, ratio) {
    const r = Number.isFinite(ratio) ? ratio : 0.02;
    const label = new Int32Array(w * h).fill(-1);
    const sizes = [0];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
      if (label[start] !== -1 || data[start * 4 + 3] === 0) continue;
      const id = sizes.length;
      sizes.push(0);
      label[start] = id; stack.push(start);
      while (stack.length) {
        const k = stack.pop();
        sizes[id]++;
        const x = k % w, y = (k / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nk = ny * w + nx;
            if (label[nk] !== -1 || data[nk * 4 + 3] === 0) continue;
            label[nk] = id; stack.push(nk);
          }
        }
      }
    }
    if (sizes.length <= 2) return 0;
    let maxId = 1;
    for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[maxId]) maxId = i;
    const cut = sizes[maxId] * r;
    let removed = 0;
    for (let k = 0; k < w * h; k++) {
      const id = label[k];
      if (id > 0 && id !== maxId && sizes[id] < cut) { data[k * 4 + 3] = 0; removed++; }
    }
    return removed;
  }

  /**
   * 绿色去污（de-spill）：把"绿得发慌"的像素压回中性色。
   * ---------------------------------------------------------------
   * ⚠️ 经验教训（实测得出，勿删）：
   *   绿幕图抠完后，角色边缘与高光处常残留绿色污染（眼球暗绿反射、
   *   脚部蓝绿过渡带）。这些像素在角色内部，不能抠掉（会打洞），
   *   正确做法是把绿通道压到 r/b 的最大值，色相回到中性。
   * 只处理不透明像素；纯透明像素不动。
   * @returns {number} 被去污的像素数
   */
  function despill(data, w, h, strength) {
    const s = Number.isFinite(strength) ? strength : 25;
    let fixed = 0;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (data[o + 3] === 0) continue;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      if (g - r > s && g - b > s) {
        const cap = Math.max(r, b);
        data[o + 1] = cap;
        fixed++;
      }
    }
    return fixed;
  }

  /** 透明像素占比（用于判断图片是否本来就抠好了） */
  function transparentRatio(data, w, h) {
    let c = 0;
    for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] === 0) c++;
    return c / (w * h);
  }

  /** 前景包围盒 */
  function bbox(data, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  return {
    isBgNeutral, isBgGreen, isBgGreenAt, greenThresholds, detectBackground, keyOut,
    missedBackgroundCount, feather, despeckle, despill, transparentRatio, bbox,
  };
});
