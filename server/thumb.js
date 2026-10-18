// 图片缩略图服务：/images/<rel>?w=<宽> → 按需生成并缓存，再回源到原图
//
// 为什么需要：实物照片原图长边 1600~4000，而总览里的物品小图只占 17~40px。
// 浏览器对 <img> 是按"图片原始像素"解码的，一张 1706×1279 的 JPEG 解码后占 8.7MB 内存。
// 实测 84 件物品 → 781MB 图像内存，手机浏览器被迫频繁做内存回收与纹理重传，
// 表现为滚动卡顿、机身发烫。缩到实际显示尺寸后同样 84 张只占 ~3MB。
//
// 设计要点：
//  · 尺寸走白名单（避免任意 w 被刷成无限缓存文件）
//  · 缓存落盘 data/thumbs/，文件名带 @<w>，源文件更新（mtime 变新）会自动重建
//  · 同一文件并发请求共用一次生成（否则首屏会同时解码几十次同一张图）
//  · 任何异常都 next() 回退到原图 —— 宁可慢一点，也不能让图裂开
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { IMAGES_DIR, DATA_DIR } = require('./paths');

const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
// 白名单：覆盖 40px 小图 → 全屏灯箱的所有实际需求
const SIZES = [96, 160, 320, 640, 1280];

let sharp = null;
try { sharp = require('sharp'); } catch { console.warn('[thumb] 未安装 sharp，缩略图降级为原图'); }

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* 并发创建时忽略 */ }
}

// 同一 (源文件, 宽度) 的并发生成只做一次
const inflight = new Map();

function thumbPath(rel, w) {
  const parsed = path.parse(rel);
  return path.join(THUMB_DIR, parsed.dir, `${parsed.name}@${w}.webp`);
}

function wantsWebp(req) {
  const accept = String(req.headers.accept || '');
  // 浏览器都会带上 image/webp；curl 之类发 */* 的客户端同样能吃 webp（体积再小 30%）
  return accept === '' || accept.includes('image/webp') || accept.includes('*/*');
}

async function makeThumb(src, out, w, toWebp) {
  ensureDir(path.dirname(out));
  const img = sharp(src, { failOn: 'none' }).rotate(); // rotate() 处理手机竖拍的 EXIF 方向
  const meta = await img.metadata();
  // 原图本来就比目标还小 → 不放大，直接按原尺寸存一份（省一次放大开销）
  const pipeline = (meta.width && meta.width <= w) ? img : img.resize({ width: w, withoutEnlargement: true });
  const buf = toWebp
    ? await pipeline.webp({ quality: 76, effort: 4 }).toBuffer()
    : await pipeline.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  await fsp.writeFile(out, buf).catch(() => {});
  return out;
}

// 确保某张图的某个尺寸已生成（并发去重 + mtime 校验），返回缩略图绝对路径
async function ensure(rel, w, toWebp) {
  const src = path.join(IMAGES_DIR, rel);
  const st = await fsp.stat(src);
  let out = thumbPath(rel, w);
  if (!toWebp) out = out.replace(/\.webp$/, '.jpg');
  try {
    const ts = await fsp.stat(out);
    if (ts.isFile() && ts.mtimeMs >= st.mtimeMs) return out;
  } catch { /* 未命中 */ }
  const key = out;
  let job = inflight.get(key);
  if (!job) {
    job = makeThumb(src, out, w, toWebp).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  await job;
  return out;
}

/**
 * 预热：图片落盘后立刻生成常用尺寸，用户浏览时直接命中缓存（不再等 sharp 解大图）。
 * 只生成 webp（浏览器默认都走 webp）；jpeg 回退版本按需生成。
 * 永不抛错：缩略图只是加速手段，生成失败也不该影响入库。
 */
function warm(rel, sizes) {
  if (!sharp) return Promise.resolve();
  const list = sizes || [96, 320, 1280];
  return Promise.all(list.map((w) => ensure(rel, w, true).catch(() => null)));
}

async function serveThumb(req, res, next) {
  const w = Number(req.query.w);
  if (!sharp || !SIZES.includes(w)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  let rel = req.path.replace(/^\/+/, '');
  try { rel = decodeURIComponent(rel); } catch { /* 保留原样 */ }
  if (!rel || rel.includes('..') || rel.includes('\0')) return next();

  const src = path.join(IMAGES_DIR, rel);
  if (!src.startsWith(IMAGES_DIR + path.sep)) return next();

  let st;
  try { st = await fsp.stat(src); } catch { return next(); }  // 源文件不存在 → 交给 static 处理 404
  if (!st.isFile()) return next();

  try {
    const out = await ensure(rel, w, wantsWebp(req));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(out);
  } catch (e) {
    // 生成失败（损坏图 / 不支持的格式）→ 原图兜底，保证界面不出破图
    return next();
  }
}

// 删除某张原图时顺手清理它的缩略图（由调用方按原图相对路径传入）
function dropThumbs(rel) {
  for (const w of SIZES) {
    for (const ext of ['.webp', '.jpg']) {
      const p = thumbPath(rel, w).replace(/\.webp$/, ext);
      fs.unlink(p, () => {});
    }
  }
}

module.exports = { serveThumb, dropThumbs, warm, THUMB_DIR, SIZES };
