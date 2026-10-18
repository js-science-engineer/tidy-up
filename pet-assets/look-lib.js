/* ============================================================================
 * PetLook — 电子宠物「自定义形象」前端处理库
 * ----------------------------------------------------------------------------
 * 职责：把用户上传的原始图片，处理成与内置素材同规格的转身贴图。
 *   1) 需要时抠掉背景（纯色 / 棋盘格背景，保留角色主体）
 *   2) 归一化到 720x900 画布：角色高 860px、脚底贴齐画布底部、水平居中
 *      —— 与 pet-assets/ 内置素材的基准完全一致，切换形象不会忽大忽小
 *   3) 水平镜像（用侧面生成另一侧面）
 * 算法与 pet-assets/pet_fix.js 保持一致（同一套 isBg 判据 + 边界羽化）。
 * 浏览器直接 <script src> 引入，暴露 window.PetLook。
 * ========================================================================== */
(function (global) {
  'use strict';

  const OUT_W = 720, OUT_H = 900;                      // 输出画布（与内置素材一致）
  const TARGET = { h: 860, by: 900, cx: 360 };         // 角色高 / 脚底基线 / 中心
  const MAX_SIDE = 1400;                               // 处理前的最长边上限（性能）
  const TRANSPARENT_OK = 0.05;                         // 透明占比高于此值视为"已抠好图"

  /* ---------------- 基础工具 ---------------- */
  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function loadBlob(blob) {
    if (global.createImageBitmap) {
      return createImageBitmap(blob).catch(() => loadURL(URL.createObjectURL(blob), true));
    }
    return loadURL(URL.createObjectURL(blob), true);
  }
  function loadURL(url, revoke) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => { if (revoke) URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { if (revoke) URL.revokeObjectURL(url); rej(new Error('图片解码失败')); };
      im.src = url;
    });
  }

  /* ---------------- 背景判定（与 pet_fix.js 同一判据） ---------------- */
  // 低饱和的"亮灰白"（棋盘格/白底）或"近黑"（黑边条）都算背景
  function isBg(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const lum = mx / 255;
    return (mx - mn < 26 && lum > 0.55) || (mx - mn < 30 && lum < 0.10);
  }
  function transRatio(d, w, h) {
    let c = 0;
    for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] === 0) c++;
    return c / (w * h);
  }
  function bbox(d, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  // 从四边向内泛洪，把连通的背景像素 alpha 置 0
  function keyOut(d, w, h) {
    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
      const k = y * w + x;
      if (!seen[k]) { seen[k] = 1; if (isBg(d, k * 4)) stack.push(k); }
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const k = stack.pop();
      const x = k % w, y = (k / w) | 0;
      d[k * 4 + 3] = 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
  }
  // 只对"紧贴透明像素"的半透明边缘做 3x3 alpha 均值，去掉生硬锯齿
  function feather(d, w, h) {
    const a = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        if (a[k] === 0 || a[k] >= 254) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++)
          for (let dx = -1; dx <= 1; dx++) if (a[k + dy * w + dx] === 0) { edge = true; break; }
        if (!edge) continue;
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[k + dy * w + dx];
        d[k * 4 + 3] = Math.round(s / 9);
      }
    }
  }

  /* ---------------- 编码 ---------------- */
  function encode(canvas, quality) {
    const webp = canvas.toDataURL('image/webp', quality);
    if (webp.indexOf('data:image/webp') === 0) return webp;
    return canvas.toDataURL('image/png');       // 个别环境不支持 webp，退回 png
  }

  /* ---------------- 主流程 ---------------- */
  /**
   * 处理单张上传图
   * @param {Blob|File} blob
   * @param {{key?:boolean, norm?:boolean, quality?:number}} opt
   * @returns {Promise<{url:string,cut:boolean,charRatio:number,srcW:number,srcH:number,empty:boolean}>}
   *          charRatio = 角色包围盒高度 / 原图高度（用于判断三视图比例是否一致）
   */
  async function prepare(blob, opt) {
    opt = Object.assign({ key: true, norm: true, quality: 0.9 }, opt || {});
    const img = await loadBlob(blob);
    const srcW = img.width || img.naturalWidth;
    const srcH = img.height || img.naturalHeight;
    if (!srcW || !srcH) throw new Error('图片尺寸无效');

    const s = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
    const bw = Math.max(1, Math.round(srcW * s));
    const bh = Math.max(1, Math.round(srcH * s));
    const base = newCanvas(bw, bh);
    const bx = base.getContext('2d', { willReadFrequently: true });
    bx.imageSmoothingEnabled = true;
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(img, 0, 0, bw, bh);
    if (img.close) img.close();

    let cut = false;
    if (opt.key) {
      const id = bx.getImageData(0, 0, bw, bh);
      if (transRatio(id.data, bw, bh) < TRANSPARENT_OK) {
        keyOut(id.data, bw, bh);
        feather(id.data, bw, bh);
        bx.putImageData(id, 0, 0);
        cut = true;
      }
    }

    const id2 = bx.getImageData(0, 0, bw, bh);
    const bb = bbox(id2.data, bw, bh);
    const empty = bb.h <= 0;

    const out = newCanvas(OUT_W, OUT_H);
    const ox = out.getContext('2d');
    ox.imageSmoothingEnabled = true;
    ox.imageSmoothingQuality = 'high';

    if (empty) {
      // 整张图都判定成背景了（纯色底 + 同色角色等极端情况）：原样铺满，至少不让形象消失
      ox.drawImage(base, 0, 0, OUT_W, OUT_H);
    } else if (opt.norm) {
      const k = TARGET.h / bb.h;
      const dw = bb.w * k, dh = bb.h * k;
      ox.drawImage(base, bb.x0, bb.y0, bb.w, bb.h,
                   TARGET.cx - dw / 2, TARGET.by - dh, dw, dh);
    } else {
      const k = Math.min(OUT_W / bw, OUT_H / bh);
      const dw = bw * k, dh = bh * k;
      ox.drawImage(base, (OUT_W - dw) / 2, OUT_H - dh, dw, dh);   // 底对齐
    }

    return {
      url: encode(out, opt.quality),
      cut: cut,
      empty: empty,
      charRatio: empty ? 0 : bb.h / bh,
      srcW: srcW, srcH: srcH
    };
  }

  /* ---------------- 多视角智能分析（一张图里切出正面/侧面/背面） ----------------
   * 思路：抠背景 → 取前景掩码 → 按列/行投影找"主体段" → 切分 →
   *      用同一缩放系数归一化（关键：多视角比例一致，转身不会忽大忽小）。
   * 这样用户只上传一张（三视图拼图 / 单视角）就够了。
   * ------------------------------------------------------------------------- */
  function maskOf(d, w, h) {
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > 12 ? 1 : 0;
    return m;
  }
  // 在投影数组上找"主体段"：阈值以上视为占位，可跨过很小的空隙（噪点/描边断线）
  function runsOf(occ, axisLen) {
    const T = Math.max(1, Math.round(axisLen * 0.008));
    const minRun = Math.max(3, Math.round(axisLen * 0.05));
    const maxGap = Math.max(1, Math.round(axisLen * 0.02));
    const out = [];
    let i = 0;
    while (i < occ.length) {
      if (occ[i] < T) { i++; continue; }
      let s = i, last = i; i++;
      while (i < occ.length) {
        if (occ[i] >= T) { last = i; i++; continue; }
        let j = i; while (j < occ.length && occ[j] < T) j++;
        if (j < occ.length && (j - last - 1) <= maxGap) i = j;   // 小空隙，并入同一主体
        else break;
      }
      if (last - s + 1 >= minRun) out.push([s, last]);
      i = last + 1;
    }
    return out;
  }
  function bboxIn(mask, w, h, x0, x1, y0, y1) {
    let a = w, b = h, c = -1, e = -1, area = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!mask[y * w + x]) continue;
        area++;
        if (x < a) a = x; if (x > c) c = x;
        if (y < b) b = y; if (y > e) e = y;
      }
    }
    return { x0: a, y0: b, x1: c, y1: e, w: c - a + 1, h: e - b + 1, area: area };
  }

  /**
   * 智能分析一张图：自动切出多个视角并按同一比例归一化
   * @param {Blob|File} blob
   * @param {{key?:boolean, norm?:boolean, quality?:number}} opt
   * @returns {Promise<{views:Array<{url:string,w:number,h:number,charH:number}>,
   *          axis:'x'|'y'|'none', count:number, cut:boolean, ratio:number,
   *          srcW:number, srcH:number, empty:boolean}>}
   */
  async function analyze(blob, opt) {
    opt = Object.assign({ key: true, norm: true, quality: 0.9 }, opt || {});
    const img = await loadBlob(blob);
    const srcW = img.width || img.naturalWidth;
    const srcH = img.height || img.naturalHeight;
    if (!srcW || !srcH) throw new Error('图片尺寸无效');

    const s = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
    const bw = Math.max(1, Math.round(srcW * s));
    const bh = Math.max(1, Math.round(srcH * s));
    const base = newCanvas(bw, bh);
    const bx = base.getContext('2d', { willReadFrequently: true });
    bx.imageSmoothingEnabled = true;
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(img, 0, 0, bw, bh);
    if (img.close) img.close();

    let cut = false;
    if (opt.key) {
      const id = bx.getImageData(0, 0, bw, bh);
      if (transRatio(id.data, bw, bh) < TRANSPARENT_OK) {
        keyOut(id.data, bw, bh);
        feather(id.data, bw, bh);
        bx.putImageData(id, 0, 0);
        cut = true;
      }
    }

    const data = bx.getImageData(0, 0, bw, bh).data;
    const mask = maskOf(data, bw, bh);
    const colOcc = new Int32Array(bw), rowOcc = new Int32Array(bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) if (mask[y * bw + x]) { colOcc[x]++; rowOcc[y]++; }
    }
    const rx = runsOf(colOcc, bw), ry = runsOf(rowOcc, bh);

    let axis = 'none', boxes = [];
    if (rx.length >= 2 && rx.length >= ry.length) {
      axis = 'x';
      boxes = rx.map(r => bboxIn(mask, bw, bh, r[0], r[1], 0, bh - 1));
    } else if (ry.length >= 2) {
      axis = 'y';
      boxes = ry.map(r => bboxIn(mask, bw, bh, 0, bw - 1, r[0], r[1]));
    } else {
      boxes = [bboxIn(mask, bw, bh, 0, bw - 1, 0, bh - 1)];
    }

    // 过滤碎块（说明文字/描边/水印一般又矮又小）
    boxes = boxes.filter(b => b.area > 0 && b.h >= bh * 0.14 && b.area >= 120);
    if (!boxes.length) { axis = 'none'; boxes = [bboxIn(mask, bw, bh, 0, bw - 1, 0, bh - 1)]; }
    if (boxes.length > 3) {                       // 多于 3 个：取面积最大的 3 个，再按位置排回顺序
      boxes.sort((a, b) => b.area - a.area);
      boxes = boxes.slice(0, 3);
      boxes.sort((a, b) => axis === 'y' ? a.y0 - b.y0 : a.x0 - b.x0);
    }

    // 共用缩放系数：以各视角高度的中位数为准 → 多视角比例保持一致（不各自拉伸到同高）
    const hs = boxes.map(b => b.h).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length / 2)];
    let k = opt.norm ? Math.min(TARGET.h / med, TARGET.by / hs[hs.length - 1]) : 0;

    const views = boxes.map((b, i) => {
      const out = newCanvas(OUT_W, OUT_H);
      const ox = out.getContext('2d');
      ox.imageSmoothingEnabled = true;
      ox.imageSmoothingQuality = 'high';
      const kk = opt.norm ? k : Math.min(OUT_W / b.w, OUT_H / b.h);
      const dw = b.w * kk, dh = b.h * kk;
      ox.drawImage(base, b.x0, b.y0, b.w, b.h,
                   Math.round(TARGET.cx - dw / 2), Math.round(TARGET.by - dh),
                   Math.round(dw), Math.round(dh));
      return { url: encode(out, opt.quality), w: b.w, h: b.h, charH: Math.round(dh), idx: i };
    });

    const chs = views.map(v => v.charH);
    const cmin = Math.min.apply(null, chs), cmax = Math.max.apply(null, chs);
    return {
      views: views, axis: axis, count: views.length, cut: cut,
      ratio: cmin > 0 ? cmax / cmin : 1,
      srcW: srcW, srcH: srcH,
      empty: cmax < 2
    };
  }

  /** 水平镜像一张（dataURL / 相对路径 均可） */
  async function mirror(src) {
    const img = await loadURL(src, false);
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const c = newCanvas(w, h);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.translate(w, 0);
    x.scale(-1, 1);
    x.drawImage(img, 0, 0, w, h);
    return encode(c, 0.9);
  }

  /** 降质重编码（localStorage 写不下时用） */
  async function requant(src, quality) {
    const img = await loadURL(src, false);
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const c = newCanvas(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return encode(c, quality);
  }

  global.PetLook = {
    OUT_W: OUT_W, OUT_H: OUT_H, TARGET: TARGET,
    prepare: prepare, analyze: analyze, mirror: mirror, requant: requant,
    // 供测试/调试
    _internals: { isBg: isBg, keyOut: keyOut, bbox: bbox, transRatio: transRatio,
                  runsOf: runsOf, maskOf: maskOf }
  };
})(window);
