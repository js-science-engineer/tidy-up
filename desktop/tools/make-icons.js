'use strict';

/**
 * 图标三件套生成工具（构建期使用，M7-1）。
 * ---------------------------------------------------------------
 * 输入：绿幕/浅底角色头像原图
 * 输出：
 *   build/icon.ico   — Windows（PNG 压缩条目，Vista+ 通用）
 *   build/icon.png   — 256x256 透明 PNG（托盘 / Linux / 开发用）
 *   build/icon@2x.png — 512x512
 * 头像会抠图后内切圆形裁剪，边缘 2px 抗锯齿。
 *
 * 用法：node tools/make-icons.js <src.png>
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const K = require('../src/shared/keying');

/** 双线性缩放（纯手写，避免引入图形库） */
function resize(src, dw, dh) {
  const out = new PNG({ width: dw, height: dh });
  const kx = src.width / dw, ky = src.height / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * ky - 0.5;
    const syi = Math.max(0, Math.min(src.height - 1, Math.floor(sy)));
    const fy = sy - syi;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * kx - 0.5;
      const sxi = Math.max(0, Math.min(src.width - 1, Math.floor(sx)));
      const fx = sx - sxi;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let dy = 0; dy <= 1; dy++) {
        const yy = Math.min(src.height - 1, syi + dy);
        const wy = dy ? fy : 1 - fy;
        for (let dx = 0; dx <= 1; dx++) {
          const xx = Math.min(src.width - 1, sxi + dx);
          const wx = dx ? fx : 1 - fx;
          const i = (yy * src.width + xx) * 4;
          const w = wx * wy;
          r += src.data[i] * w; g += src.data[i + 1] * w;
          b += src.data[i + 2] * w; a += src.data[i + 3] * w;
          wsum += w;
        }
      }
      if (wsum > 0) { r /= wsum; g /= wsum; b /= wsum; a /= wsum; }
      const o = (y * dw + x) * 4;
      out.data[o] = Math.round(r); out.data[o + 1] = Math.round(g);
      out.data[o + 2] = Math.round(b); out.data[o + 3] = Math.round(a);
    }
  }
  return out;
}

/** 内切圆形裁剪：圆外 alpha=0，圆缘 2px 渐变抗锯齿 */
function circleCrop(png) {
  const { width: w, height: h } = png;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  const FEATHER = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > R) png.data[i + 3] = 0;
      else if (d > R - FEATHER) {
        png.data[i + 3] = Math.round(png.data[i + 3] * (R - d) / FEATHER);
      }
    }
  }
  return png;
}

/** 先把角色 bbox 放大到正方形画布（留 4% 边距），再圆形裁剪 */
function makeSquareIcon(src) {
  const bb = K.bbox(src.data, src.width, src.height);
  if (!bb) throw new Error('整张图都是透明的');
  const pad = Math.round(Math.max(bb.w, bb.h) * 0.04);
  const size = Math.max(bb.w, bb.h) + pad * 2;
  const canvas = new PNG({ width: size, height: size });
  const ox = Math.round((size - bb.w) / 2), oy = Math.round((size - bb.h) / 2);
  for (let y = 0; y < bb.h; y++) {
    for (let x = 0; x < bb.w; x++) {
      const si = ((bb.y0 + y) * src.width + (bb.x0 + x)) * 4;
      const di = ((oy + y) * size + (ox + x)) * 4;
      for (let k = 0; k < 4; k++) canvas.data[di + k] = src.data[si + k];
    }
  }
  return circleCrop(canvas);
}

/** ICO 容器：条目内嵌 PNG（Vista+ 支持，256 以下合法） */
function buildIco(png, sizes) {
  const entries = sizes.map((s) => {
    const resized = resize(png, s, s);
    const data = PNG.sync.write(resized);
    return { size: s, data };
  });
  const headerSize = 6 + entries.length * 16;
  const total = headerSize + entries.reduce((n, e) => n + e.data.length, 0);
  const buf = Buffer.alloc(total);
  let off = 0;

  buf.writeUInt16LE(0, off); off += 2;   // reserved
  buf.writeUInt16LE(1, off); off += 2;   // type: icon
  buf.writeUInt16LE(entries.length, off); off += 2;

  let dataOffset = headerSize;
  for (const e of entries) {
    buf[off] = e.size >= 256 ? 0 : e.size; off += 1;  // width
    buf[off] = e.size >= 256 ? 0 : e.size; off += 1;  // height
    buf[off] = 0; off += 1;                            // palette
    buf[off] = 0; off += 1;                            // reserved
    buf.writeUInt16LE(1, off); off += 2;               // color planes
    buf.writeUInt16LE(32, off); off += 2;              // bpp
    buf.writeUInt32LE(e.data.length, off); off += 4;
    buf.writeUInt32LE(dataOffset, off); off += 4;
    e.data.copy(buf, dataOffset);
    dataOffset += e.data.length;
  }
  for (const e of entries) e.data.copy(buf, off), (off += e.data.length);
  return buf;
}

function main() {
  const src = PNG.sync.read(fs.readFileSync(process.argv[2] || ''));
  const det = K.detectBackground(src.data, src.width, src.height);
  K.keyOut(src.data, src.width, src.height, { mode: det.mode });
  K.despill(src.data, src.width, src.height);
  K.despeckle(src.data, src.width, src.height);
  const icon = makeSquareIcon(src);

  const outDir = path.dirname(process.argv[2]);
  const icoPath = path.join(outDir, 'icon.ico');
  const pngPath = path.join(outDir, 'icon.png');
  const png2xPath = path.join(outDir, 'icon@2x.png');

  fs.writeFileSync(icoPath, buildIco(icon, [16, 24, 32, 48, 64, 128, 256]));
  fs.writeFileSync(pngPath, PNG.sync.write(resize(icon, 256, 256)));
  fs.writeFileSync(png2xPath, PNG.sync.write(resize(icon, 512, 512)));
  console.log(`✅ 图标已生成: ${icoPath} / ${pngPath} / ${png2xPath}`);
}

main();
