'use strict';

/**
 * 形象归一化解码层测试（修复"unrecognised content at end of stream"事故）
 * 用户上传的 PNG 常带尾随数据（截图工具/AI 生图附加元数据），必须能容忍。
 */

const test = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');
const { normalizeToPngBuffer, OUT_W, OUT_H } = require('../src/main/image/normalizeLook');

/** 造一张标准绿幕图：中间一个纯色角色方块 */
function makeGreenScreenPng(w, h) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBox = x >= Math.floor(w * 0.25) && x < Math.floor(w * 0.75) &&
        y >= Math.floor(h * 0.2) && y < Math.floor(h * 0.95);
      if (inBox) {
        // 角色主体（奶油白）+ 一点绿色头部渐变（测试 despill 不吃掉主体）
        png.data[i] = 245; png.data[i + 1] = 240; png.data[i + 2] = 230;
      } else {
        png.data[i] = 14; png.data[i + 1] = 148; png.data[i + 2] = 21; // 绿幕
      }
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test('M4b · 标准绿幕 PNG 可正常归一化', () => {
  const src = makeGreenScreenPng(300, 400);
  const { buffer, info } = normalizeToPngBuffer(src, { label: 't' });
  assert.ok(buffer.length > 0);
  assert.equal(info.mode, 'green');
  const out = PNG.sync.read(buffer);
  assert.equal(out.width, OUT_W);
  assert.equal(out.height, OUT_H);
});

test('M4b · 回归：PNG 带尾随数据仍可导入（用户事故复现）', () => {
  const src = makeGreenScreenPng(300, 400);
  // 模拟截图/AI 工具在 IEND 后附加的元数据
  const garbage = Buffer.concat([src, Buffer.from('some trailing junk metadata here')]);
  const { buffer } = normalizeToPngBuffer(garbage, { label: 't' });
  assert.ok(buffer.length > 0);
});

test('M4b · 回归：IEND 后尾随大量二进制（另一台工具的行为）', () => {
  const src = makeGreenScreenPng(300, 400);
  const junk = Buffer.alloc(4096, 0xff);
  const { buffer } = normalizeToPngBuffer(Buffer.concat([src, junk]), { label: 't' });
  assert.ok(buffer.length > 0);
});

test('M4b · 非图片数据抛友好错误', () => {
  assert.throws(
    () => normalizeToPngBuffer(Buffer.from('this is not an image at all'), { label: 't' }),
    /图片无法解码/
  );
});
