// M13：手机端性能治理（缩略图管线 / 渲染尺寸 / 宠物待机开销）
//
// 这一组测试守的是几个"看起来能用、但在手机上很贵"的地方：
//  · 列表里的 40px 小图如果按原图解码，一张 1706×1279 就要 8.7MB 内存；
//    84 件物品就是 780MB —— 手机必然被迫频繁回收内存，表现就是卡顿 + 发烫
//  · 缩略图必须由服务端生成并落盘缓存，第二次访问不能再解大图
//  · 渲染层必须真的带上尺寸参数，否则前面做得再好也用不上
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, stop } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 生成一张"大图"（1200×900 JPEG），模拟手机拍出来的实物照片
async function makeBigJpeg(dir) {
  const sharp = require('sharp');
  const target = path.join(dir, 'images', 'test', 'big.jpg');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 90, g: 120, b: 190 } },
  }).jpeg({ quality: 92 }).toFile(target);
  return target;
}

test('M13.1 缩略图：按 w 生成更小的图，且第二次命中磁盘缓存', async () => {
  const s = await startServer();
  try {
    const src = await makeBigJpeg(s.dataDir);
    const originalSize = fs.statSync(src).size;

    const r1 = await fetch(`${s.base}/images/test/big.jpg?w=96`);
    assert.equal(r1.status, 200);
    const b1 = Buffer.from(await r1.arrayBuffer());
    assert.ok(b1.length < originalSize / 10, `96px 缩略图应远小于原图（${b1.length} vs ${originalSize}）`);
    assert.ok(/image\/(webp|jpeg)/.test(r1.headers.get('content-type')), '应返回图片');
    assert.ok(/immutable/.test(r1.headers.get('cache-control') || ''), '缩略图内容不变，应允许长缓存');

    // 落盘缓存：thumbs/test/big@96.webp
    const cacheFile = path.join(s.dataDir, 'thumbs', 'test', 'big@96.webp');
    assert.ok(fs.existsSync(cacheFile), '缩略图应缓存到 data/thumbs 下');

    // 第二次：文件 mtime 不应变化（说明没有重复生成）
    const mtime = fs.statSync(cacheFile).mtimeMs;
    const r2 = await fetch(`${s.base}/images/test/big.jpg?w=96`);
    const b2 = Buffer.from(await r2.arrayBuffer());
    assert.equal(b2.length, b1.length, '两次请求应返回同一张缩略图');
    assert.equal(fs.statSync(cacheFile).mtimeMs, mtime, '第二次应命中缓存而不是重新生成');
  } finally { stop(s.proc); }
});

test('M13.2 缩略图：尺寸白名单外回退原图，坏参数不生成垃圾文件', async () => {
  const s = await startServer();
  try {
    await makeBigJpeg(s.dataDir);
    // 不在白名单 → 走原图静态服务（避免被刷出无数个缓存尺寸）
    const r = await fetch(`${s.base}/images/test/big.jpg?w=777`);
    assert.equal(r.status, 200);
    assert.ok(/image\/jpeg/.test(r.headers.get('content-type')), '非白名单宽度应回退原图');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'thumbs', 'test', 'big@777.webp')), '不应为任意宽度生成缓存');

    // 目录穿越不能逃出 images/
    const bad = await fetch(`${s.base}/images/../../server/index.js?w=96`);
    assert.notEqual(bad.status, 200, '不允许路径穿越');
  } finally { stop(s.proc); }
});

test('M13.3 缩略图：图片不存在时是 404，不会 500', async () => {
  const s = await startServer();
  try {
    const r = await fetch(`${s.base}/images/test/nope.jpg?w=96`);
    assert.equal(r.status, 404);
  } finally { stop(s.proc); }
});

test('M13.4 渲染层：所有列表小图都带尺寸参数（只有"看原图"用原图）', () => {
  const files = {
    'public/js/components/Dashboard.js': [96, 320, 1280],
    'public/js/components/ItemDetail.js': [1280],
    // 64px 的列表缩略图在 3x 屏上要 192px，取 160 兼顾清晰度与流量（约 2.6KB/张）
    'public/js/components/SearchPage.js': [160],
    'public/js/components/StatsPage.js': [160],
    'public/js/components/Studio.js': [320, 640, 1280],
    'public/js/components/ScanIntake.js': [640],
  };
  for (const [f, sizes] of Object.entries(files)) {
    const src = read(f);
    // 找出所有 imgSrc(...) 调用，检查参数里是否带了宽度。
    // （用括号配对而不是正则，避免 cabPhotoOf(picks[i].cabinetId) 这类嵌套调用被截断）
    const calls = [];
    let idx = src.indexOf('imgSrc(');
    while (idx >= 0) {
      let i = idx + 'imgSrc('.length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      calls.push(src.slice(idx + 'imgSrc('.length, i - 1).trim());
      idx = src.indexOf('imgSrc(', i);
    }
    const bare = calls.filter((a) => !/,\s*\d+$/.test(a) && a !== 'zoom.img');
    assert.deepEqual(bare, [], `${f} 里还有没带尺寸的图片：${bare.join(', ')}`);
    assert.ok(sizes.some((w) => src.includes(', ' + w + ')')), `${f} 应使用约定的缩略尺寸`);
  }
  // 灯箱的「↗ 原图」必须保持原图
  assert.ok(read('public/js/components/Dashboard.js').includes('imgSrc(zoom.img)'),
    '「看原图」链接应给原图，不能给缩略图');
});

test('M13.5 缩略图接口：imgSrc 支持第二参数，本模式拼 ?w=，云模式走存储变换', () => {
  const api = read('public/js/api.js');
  assert.ok(/window\.imgSrc = function \(f, w\)/.test(api), 'imgSrc 应接受宽度参数');
  assert.ok(api.includes("'?w=' + w"), '本地模式应拼 ?w=');
  assert.ok(api.includes('__imgTransform'), '云模式应走存储端图片变换');
  // 变换不被支持时必须能优雅回退，不能满屏破图
  assert.ok(/addEventListener\('error'/.test(api), '应监听图片加载失败');
  assert.ok(api.includes('imgTransformOK = false'), '失败后应关闭变换');
});

test('M13.6 宠物：zzz 只在睡着时才跑动画（不能常驻 3 个无限动画）', () => {
  const css = read('public/css/pet.css');
  const zzzBlock = /\.zzz span\{([\s\S]*?)\}/.exec(css);
  assert.ok(zzzBlock, '应有 .zzz span 样式');
  assert.ok(/animation:\s*none/.test(zzzBlock[1]), 'Zzz 默认不应有动画');
  assert.ok(/\.acting-sleep \.zzz span\{[^}]*animation:\s*zfloat/.test(css), '睡着时才启动 Zzz');
});

test('M13.7 宠物：手机默认"按需表演"，桌面保持自动表演', () => {
  const pet = read('public/js/components/PetWidget.js');
  assert.ok(pet.includes('autoPlayOn'), '应有自动表演开关');
  assert.ok(/return !isLite\(\)/.test(pet), '手机（性能模式）默认不自动表演');
  assert.ok(pet.includes('localStorage'), '用户选择应被记住');
  assert.ok(pet.includes('__petAutoPlay'), '设置页需要能读取/切换');
  // 性能模式下不许自动进 sleep（会带来 6.5 秒长动画 + Zzz）
  assert.ok(/lite \? \['nod', 'surprise', 'look'\]/.test(pet), '性能模式应只挑短动作');

  const set = read('public/js/components/SettingsPage.js');
  assert.ok(set.includes('setPetAuto'), '设置页应有宠物动效开关');
});

test('M13.8 上传即预热缩略图，用户浏览时不用现场解大图', () => {
  const items = read('server/routes/items.js');
  assert.ok(/require\('\.\.\/thumb'\)\.warm\(rel\)/.test(items), '入库时应预热缩略图');
  const structure = read('server/routes/structure.js');
  assert.ok(/warm\(rel, \[320, 640\]\)/.test(structure), '柜子照片应预热预览尺寸');
});

test('M13.9 发烫主因：性能模式下背景光斑不参与滚动合成', () => {
  const css = read('public/css/app.css');
  // 实测（390×844 DPR3 / CPU 4x 降速）：隐藏 .blob 后滚动帧率 44.6 → 60.4，
  // 是唯一显著影响滚动的因素（三个 fixed + blur(110px) 的大图层，每帧都要重新合成）。
  // 所以性能模式必须彻底移除它们，改用 body 上的静态径向渐变保留观感。
  assert.ok(/body\.perf-lite \.blob\{[^}]*display:\s*none/.test(css), '性能模式应移除背景光斑图层');
  assert.ok(/body\.perf-lite\{[^}]*radial-gradient/.test(css.replace(/\n/g, ' ')), '移除后要有静态渐变兜底，不能变成纯色');
  assert.ok(/body\.perf-lite::after\{[^}]*display:\s*none/.test(css), '全屏噪点层也应移除');
  // 离屏区域不渲染，长列表滚动更跟手
  assert.ok(/body\.perf-lite \.zone\{[^}]*content-visibility:auto/.test(css), '长列表应启用渲染裁剪');
});
