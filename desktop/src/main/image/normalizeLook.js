'use strict';

/**
 * 形象图归一化（主进程构建期/导入期共用）。
 * ---------------------------------------------------------------
 * 输入一张绿幕/浅底原图 PNG Buffer，输出 720x900 基准 PNG Buffer：
 *   抠背景 → 绿色去污 → 羽化 → 去碎片 → 等比缩放(高 860) → 底对齐居中
 * 校验：中轴连贯、漏抠比例、角色占比。校验失败抛错，绝不产出坏形象。
 *
 * 与 tools/normalize-look.js 共用同一实现（CLI 只是薄封装），
 * 与运行时上传导入走完全同一条管线。
 */

const { PNG } = require('pngjs');
const K = require('../../shared/keying');

const OUT_W = 720, OUT_H = 900;
const TARGET = { h: 860, by: 900, cx: 360 };

function sampleBilinear(png, xi, yi, fx, fy) {
  const { width: w, height: h, data } = png;
  const get = (x, y) => {
    x = Math.min(w - 1, Math.max(0, x));
    y = Math.min(h - 1, Math.max(0, y));
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const p00 = get(xi, yi), p10 = get(xi + 1, yi), p01 = get(xi, yi + 1), p11 = get(xi + 1, yi + 1);
  const ws = [[p00, (1 - fx) * (1 - fy)], [p10, fx * (1 - fy)], [p01, (1 - fx) * fy], [p11, fx * fy]];
  let r = 0, g = 0, b = 0, a = 0, wsum = 0;
  for (const [p, wt] of ws) {
    const wa = (p[3] / 255) * wt;
    wsum += wa;
    r += p[0] * wa; g += p[1] * wa; b += p[2] * wa; a += p[3] * wt;
  }
  if (wsum > 0) { r /= wsum; g /= wsum; b /= wsum; }
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(Math.min(255, a))];
}

/** 抠掉背景 → 等比缩放到 860 高 → 底对齐居中贴到 720x900 */
function scaleToTarget(png) {
  const bb = K.bbox(png.data, png.width, png.height);
  if (!bb) throw new Error('整张图都是透明的，没有可见像素');
  const k = TARGET.h / bb.h;
  const dw = Math.max(1, Math.round(bb.w * k));
  const dh = Math.max(1, Math.round(bb.h * k));
  const out = new PNG({ width: OUT_W, height: OUT_H });
  const left = Math.round(TARGET.cx - dw / 2);
  const top = TARGET.by - dh;

  for (let y = 0; y < dh; y++) {
    const sy = bb.y0 + (y + 0.5) / k - 0.5;
    const syi = Math.floor(sy), fy = sy - syi;
    for (let x = 0; x < dw; x++) {
      const sx = bb.x0 + (x + 0.5) / k - 0.5;
      const sxi = Math.floor(sx), fx = sx - sxi;
      const c = sampleBilinear(png, sxi, syi, fx, fy);
      const ox = left + x, oy = top + y;
      if (ox < 0 || ox >= OUT_W || oy < 0 || oy >= OUT_H) continue;
      const oi = (oy * OUT_W + ox) * 4;
      out.data[oi] = c[0]; out.data[oi + 1] = c[1]; out.data[oi + 2] = c[2]; out.data[oi + 3] = c[3];
    }
  }
  out.charW = dw; out.charH = dh; out.left = left; out.top = top;
  return out;
}

/**
 * 宽容解码：把用户上传的图片（PNG/JPG）统一解成 RGBA 像素。
 * ---------------------------------------------------------------
 * pngjs 是严格解码器：IEND 之后有任何尾随字节就抛
 * "unrecognised content at end of stream"——截图工具/聊天软件/AI
 * 生图工具经常在 PNG 尾部附加元数据，不能因此拒收用户图片。
 * 策略：
 *   1. PNG：截掉 IEND 之后的尾随数据再用 pngjs 解；
 *   2. 失败或非 PNG（jpg 等）：回退 Electron nativeImage（主进程可用）；
 *   3. 都不行才抛友好错误。
 * @returns {{width:number,height:number,data:Uint8Array}} RGBA
 */
function decodeImage(buf) {
  const bytes = Buffer.from(buf);
  const isPng = bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

  if (isPng) {
    // 找 IEND chunk（固定 12 字节：长度4 + "IEND"4 + CRC4），截断尾随数据
    const iend = bytes.lastIndexOf(Buffer.from('IEND', 'ascii'));
    if (iend > 0 && iend + 8 <= bytes.length) {
      try {
        return pngToRgba(PNG.sync.read(bytes.subarray(0, iend + 8)));
      } catch (_) { /* 落到 nativeImage 兜底 */ }
    }
  }

  // JPG / 损坏 PNG：Electron nativeImage 能解 PNG/JPEG（主进程里可用）
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(bytes);
    if (!img.isEmpty()) {
      const size = img.getSize();
      const bgra = img.toBitmap(); // Windows/mac 下是 BGRA
      const data = new Uint8Array(size.width * size.height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = bgra[i + 2];     // R
        data[i + 1] = bgra[i + 1]; // G
        data[i + 2] = bgra[i];     // B
        data[i + 3] = bgra[i + 3]; // A
      }
      return { width: size.width, height: size.height, data };
    }
  } catch (_) { /* 非 Electron 环境（CLI/测试） */ }

  try {
    return pngToRgba(PNG.sync.read(bytes)); // 最后再试一次原始严格解码
  } catch (_) {
    throw new Error('图片无法解码：请使用标准的 png 或 jpg 格式图片');
  }
}

/** pngjs PNG 对象 → {width,height,data}（data 已是 RGBA，直接引用） */
function pngToRgba(png) {
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * 归一化一张原图。
 * @param {Buffer|Uint8Array} buf 原始图片文件内容（PNG/JPG）
 * @param {{satThreshold?:number, label?:string}} opts
 * @returns {{png:PNG, info:object}} png 为 720x900 的 PNG 对象，info 为过程数据
 */
function normalizeBuffer(buf, opts) {
  const o = opts || {};
  const label = o.label || 'image';
  const sat = Number.isFinite(o.satThreshold) ? o.satThreshold : 9;

  const decoded = decodeImage(buf);
  const png = { width: decoded.width, height: decoded.height, data: decoded.data };
  const bg = K.detectBackground(png.data, png.width, png.height);
  K.keyOut(png.data, png.width, png.height, { mode: bg.mode, satThreshold: sat });

  // 校验 1：中轴必须连贯（防止渐变过渡带被横向打穿）
  const bb = K.bbox(png.data, png.width, png.height);
  if (!bb) throw new Error(`${label}: 整张图都没有可见像素`);
  const cx = Math.round((bb.x0 + bb.x1) / 2);
  let axisMiss = 0;
  for (let y = bb.y0 + Math.round(bb.h * 0.25); y < bb.y0 + Math.round(bb.h * 0.75); y++) {
    if (png.data[(y * png.width + cx) * 4 + 3] === 0) axisMiss++;
  }
  if (axisMiss > bb.h * 0.1) {
    throw new Error(`${label}: 角色中轴有 ${axisMiss} 行被打穿，背景与角色颜色过于接近，无法可靠抠图`);
  }

  const missed = K.missedBackgroundCount(png.data, png.width, png.height, { mode: bg.mode, satThreshold: sat });

  // 绿色去污：残留的绿幕色压回中性（眼球反射/脚部过渡带），不抠掉所以不会打洞
  const despilled = K.despill(png.data, png.width, png.height);

  K.feather(png.data, png.width, png.height);
  const speckles = K.despeckle(png.data, png.width, png.height);
  const out = scaleToTarget(png);

  // 校验 2：角色应占画面足够大
  if (out.charH < OUT_H * 0.6 || out.charW < OUT_W * 0.2) {
    throw new Error(`${label}: 抠图后角色过小(${out.charW}x${out.charH})，疑似把身体误判成背景`);
  }
  // 校验 3：漏抠比例
  if (missed > png.width * png.height * 0.01) {
    throw new Error(`${label}: 有 ${missed} 像素背景未被抠到（被角色圈住），请使用纯色绿幕/白底原图`);
  }

  return {
    png: out,
    info: { mode: bg.mode, missed, despilled, speckles, charW: out.charW, charH: out.charH },
  };
}

/** 便捷版：原始 Buffer → 归一化后的 PNG Buffer */
function normalizeToPngBuffer(buf, opts) {
  const { png, info } = normalizeBuffer(buf, opts);
  return { buffer: PNG.sync.write(png), info };
}

module.exports = { normalizeBuffer, normalizeToPngBuffer, scaleToTarget, OUT_W, OUT_H, TARGET };
