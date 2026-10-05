'use strict';

/**
 * 形象图体检工具：检查一张绿幕原图或已抠好的成品图是否干净。
 *
 * 用法：
 *   node tools/inspect-look.js src/assets/builtin-looks/raw2/side.png
 *   node tools/inspect-look.js src/renderer/pet/looks/*.png
 *
 * 输出：背景类型、抠图后占比、残留背景像素数与其分布、角色包围盒。
 * 残留背景像素指「抠图后依然不透明、且颜色仍像背景」的像素——这是最常见的形象缺陷。
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const K = require('../src/shared/keying.js');

function inspect(file) {
  const src = PNG.sync.read(fs.readFileSync(file));
  const W = src.width, H = src.height;
  const det = K.detectBackground(src.data, W, H);

  // 复制一份做抠图，不影响原图统计
  const copy = new PNG({ width: W, height: H });
  src.data.copy(copy.data);
  K.keyOut(copy.data, W, H, { mode: det.mode });

  let leftover = 0, minx = Infinity, miny = Infinity, maxx = -1, maxy = -1;
  let charPx = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (copy.data[i + 3] === 0) continue;
      charPx++;
      {
        const g = copy.data[i + 1], r = copy.data[i], b = copy.data[i + 2];
        // 绿色残留与背景类型无关：成品图也要查，绿幕原图更要查
        if (g - r > 25 && g - b > 25) {
          leftover++;
          if (x < minx) minx = x;
          if (y < miny) miny = y;
          if (x > maxx) maxx = x;
          if (y > maxy) maxy = y;
        }
      }
    }
  }

  const bb = K.bbox(copy.data, W, H);
  return {
    file: path.relative(process.cwd(), file),
    mode: det.mode,
    size: W + 'x' + H,
    charPx,
    leftover,
    leftoverBbox: leftover ? `${minx},${miny}~${maxx},${maxy}` : '-',
    leftoverSpanY: leftover ? maxy - miny + 1 : 0,
    charSize: bb ? `${bb.w}x${bb.h}` : '-',
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法：node tools/inspect-look.js <图片路径...>');
  process.exit(2);
}

let bad = 0;
for (const f of files) {
  const r = inspect(f);
  const flag = r.leftover > 200 ? '⚠️' : '✅';
  if (r.leftover > 200) bad++;
  console.log(
    `${flag} ${r.file}  背景=${r.mode} 尺寸=${r.size} 角色=${r.charSize}` +
    ` 残留背景=${r.leftover}px bbox=${r.leftoverBbox} 垂直跨度=${r.leftoverSpanY}`
  );
}

process.exit(bad ? 1 : 0);
