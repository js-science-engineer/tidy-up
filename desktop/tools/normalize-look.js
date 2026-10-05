'use strict';

/**
 * 内置形象素材归一化工具（构建期使用，不随包分发）—— CLI 薄封装。
 * ---------------------------------------------------------------
 * 核心实现统一走 src/main/image/normalizeLook.js（与运行时上传导入同一条管线）：
 *   抠背景 → 绿色去污 → 羽化 → 去碎片 → 缩放到 720x900 基准
 *
 * 用法：
 *   node tools/normalize-look.js <in.png> <out.png> [饱和度阈值=9]
 *   node tools/normalize-look.js --report <dir>      只报告，不写文件
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const K = require('../src/shared/keying');
const { normalizeToPngBuffer } = require('../src/main/image/normalizeLook');

function decode(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function processFile(inFile, outFile, satThreshold) {
  const raw = decode(inFile);
  const before = K.transparentRatio(raw.data, raw.width, raw.height);

  const { buffer, info } = normalizeToPngBuffer(fs.readFileSync(inFile), {
    satThreshold,
    label: path.basename(inFile),
  });
  fs.writeFileSync(outFile, buffer);

  const outPng = PNG.sync.read(buffer);
  const after = K.transparentRatio(outPng.data, outPng.width, outPng.height);
  console.log(
    `  [${path.basename(inFile)}] 背景类型=${info.mode} 漏抠=${info.missed} 去污=${info.despilled}px 碎片=${info.speckles}` +
    `  角色=${info.charW}x${info.charH}` +
    `  bg ${(before * 100).toFixed(1)}% -> ${(after * 100).toFixed(1)}%` +
    `  -> ${path.relative(process.cwd(), outFile)}`
  );
}

function report(file) {
  const png = decode(file);
  const bb = K.bbox(png.data, png.width, png.height);
  console.log(
    path.basename(file).padEnd(14),
    `${png.width}x${png.height}`,
    `transparent=${K.transparentRatio(png.data, png.width, png.height).toFixed(3)}`,
    bb ? `bbox=${bb.w}x${bb.h}@(${bb.x0},${bb.y0})` : 'bbox=EMPTY'
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--report') {
    for (const f of fs.readdirSync(argv[1])) {
      if (f.toLowerCase().endsWith('.png')) report(path.join(argv[1], f));
    }
    return;
  }
  const [inFile, outFile, satArg] = argv;
  if (!inFile || !outFile) {
    console.error('用法: node tools/normalize-look.js <in.png> <out.png> [饱和度阈值=9]  |  --report <dir>');
    process.exit(2);
  }
  processFile(inFile, outFile, Number(satArg) || 9);
}

if (require.main === module) main();
module.exports = { processFile };
