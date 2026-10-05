// 物品：识别队列、入库、出库、移位、详情、列表
const express = require('express');
const fs = require('fs');
const path = require('path');
const { ApiError, ok, wrap } = require('../util');
const lib = require('../lib');
const recognizer = require('../services/recognizer');
const suggester = require('../services/suggester');
const { currentProvider } = require('../services/aiProvider');
const { IMAGES_DIR, UPLOADS_DIR } = require('../paths');

const router = express.Router();
const multer = require('multer');
const IMAGE_MIMES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = extMap[file.mimetype] || path.extname(file.originalname || '') || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    if (/^image\//.test(file.mimetype) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name)) cb(null, true);
    else cb(new ApiError(400, '仅支持图片文件（jpg/png/webp/gif/bmp/avif；HEIC 请先转 JPG）'));
  },
});

function resolveCategory(db, name) {
  const n = String(name || '其他');
  let row = db.prepare('SELECT * FROM categories WHERE name=?').get(n);
  if (!row) row = db.prepare('SELECT * FROM categories WHERE name=?').get('其他');
  return row;
}

// 本地时间串（node:sqlite 不支持 datetime("now") 双引号写法）
function nowLocal() {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- 识别（写队列） ----
router.post('/intake/analyze', upload.single('image'), wrap(async (req, res) => {
  if (!req.file) throw new ApiError(400, '请上传图片（字段名 image）');
  const file = req.file;
  const mode = req.body.mode === 'batch' ? 'batch' : 'single';
  const imageBase64 = fs.readFileSync(file.path).toString('base64');
  const mime = IMAGE_MIMES[path.extname(file.filename).toLowerCase()] || 'image/jpeg';
  const provider = currentProvider();
  const rec = await recognizer.analyze(provider, { mode, imageBase64, mime });

  // 每件物品：本地规则给出分区建议；实物照片直接采用用户拍摄的这张图（v1.2 起不再联网搜图）
  rec.items.forEach((it) => {
    it.suggestion = suggester.suggest(req.db, { category: it.category, size: it.size });
    it.webImages = []; // 联网配图已停用，保留字段以兼容历史数据
  });
  const payload = { mode, file: file.filename, mime, previewUrl: `/api/uploads/${file.filename}`, rec };
  const id = req.db.prepare('INSERT INTO intake_queue(payload) VALUES (?)').run(JSON.stringify(payload)).lastInsertRowid;
  ok(res, { id, ...payload });
}));

// ---- 识别（云端 JSON 变体）：图片由前端存云存储，服务端只做 AI 识别，不落库不落盘 ----
// 限流：每 IP 每分钟 30 次（公网防滥用）
const analyzeHits = new Map();
router.post('/intake/analyze-json', wrap(async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const alive = (analyzeHits.get(ip) || []).filter((t) => now - t < 60000);
  if (alive.length >= 30) throw new ApiError(429, '请求过于频繁，请稍后再试');
  alive.push(now);
  analyzeHits.set(ip, alive);

  const b = req.body || {};
  const imageBase64 = String(b.imageBase64 || '');
  if (!imageBase64) throw new ApiError(400, '缺少图片数据（imageBase64）');
  const mode = b.mode === 'batch' ? 'batch' : 'single';
  const mime = /^image\//.test(String(b.mime || '')) ? b.mime : 'image/jpeg';
  const provider = currentProvider();
  const rec = await recognizer.analyze(provider, { mode, imageBase64, mime });
  ok(res, { rec });
}));

// 识别原图回显（队列项在多设备/重启后仍可看到用户拍的照片）
router.get('/uploads/:file', (req, res) => {
  const f = path.basename(String(req.params.file || ''));
  const p = path.join(UPLOADS_DIR, f);
  if (!f || !fs.existsSync(p)) return res.status(404).json({ ok: false, error: '图片不存在' });
  res.set('Content-Type', IMAGE_MIMES[path.extname(f).toLowerCase()] || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(p);
});

// 待确认队列（首页"今日计划"来源）
router.get('/intake/queue', (req, res) => {
  const rows = req.db.prepare("SELECT * FROM intake_queue WHERE status='pending' ORDER BY id DESC").all();
  ok(res, rows.map((r) => ({ id: r.id, created_at: r.created_at, ...JSON.parse(r.payload) })));
});

router.post('/intake/dismiss', wrap(async (req, res) => {
  const row = lib.mustExist(req.db, 'intake_queue', Number(req.body.id), '队列项');
  req.db.prepare("UPDATE intake_queue SET status='dismissed' WHERE id=?").run(row.id);
  cleanupUpload(row);
  ok(res, {});
}));

function cleanupUpload(row) {
  try {
    const p = JSON.parse(row.payload);
    const f = path.join(UPLOADS_DIR, p.file || '');
    if (p.file && fs.existsSync(f)) fs.unlinkSync(f);
  } catch { /* 忽略清理失败 */ }
}

// ---- 确认入库 ----
router.post('/intake/confirm', wrap(async (req, res) => {
  const db = req.db;
  const b = req.body || {};
  const row = lib.mustExist(db, 'intake_queue', Number(b.queueId), '队列项');
  const payload = JSON.parse(row.payload);
  const item = (payload.rec.items || [])[Number(b.index) || 0];
  if (!item) throw new ApiError(400, '队列项中没有该物品');

  const name = String(b.name || item.name || '').trim();
  if (!name) throw new ApiError(400, '物品名称不能为空');
  const qty = Math.max(0, Number(b.qty ?? item.qty ?? 1));
  const shelfId = b.shelfId ? Number(b.shelfId) : null;
  const boxId = b.boxId ? Number(b.boxId) : null;
  if (!shelfId && !boxId) throw new ApiError(400, '请选择存放位置（层或箱子）');
  if (boxId) lib.mustExist(db, 'boxes', boxId, '箱子');
  if (shelfId) lib.mustExist(db, 'shelves', shelfId, '层');

  const cat = resolveCategory(db, b.category || item.category);
  // 同名物品合并：复用已有物品，实现"多位置独立数量"（PRD C5）
  const existing = db.prepare('SELECT id FROM items WHERE name=?').get(name);
  const ii = existing ? existing.id
    : db.prepare('INSERT INTO items(name,aliases,category_id,size_class,note) VALUES (?,?,?,?,?)')
      .run(name, JSON.stringify(b.aliases || item.aliases || []), cat.id,
        ['S', 'M', 'L'].includes(b.size) ? b.size : (item.size || 'S'), b.note || null).lastInsertRowid;

  // 图片：用户拍摄的照片移入 images/<itemId>/ 并作为实物主图（v1.2 起不再联网配图）
  let mainUrl = null;
  const userFile = path.join(UPLOADS_DIR, payload.file);
  if (fs.existsSync(userFile)) {
    // 主图唯一：新照片入库前先清掉旧的主图标记
    // （历史缺陷：每次入库都新增一条 is_main=1 却不清旧标记，导致主图永远显示最旧的联网配图）
    db.prepare('UPDATE item_images SET is_main=0 WHERE item_id=?').run(ii);
    const dir = path.join(IMAGES_DIR, String(ii));
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(payload.file) || '.jpg';
    const stamp = Date.now();
    const dest = path.join(dir, `photo-${stamp}${ext}`);
    fs.renameSync(userFile, dest);
    const rel = `images/${ii}/photo-${stamp}${ext}`;
    db.prepare('INSERT INTO item_images(item_id,file,source,is_main) VALUES (?,?,?,?)')
      .run(ii, rel, 'user', 1);
    mainUrl = rel;
  }

  // 同容器已有存放记录 → 累加数量；否则新建一条独立存放记录
  const sameLoc = db.prepare('SELECT id, qty FROM placements WHERE item_id=? AND shelf_id IS ? AND box_id IS ?')
    .get(ii, shelfId, boxId);
  if (sameLoc) {
    db.prepare('UPDATE placements SET qty=?, updated_at=datetime(?,?) WHERE id=?')
      .run(sameLoc.qty + qty, 'now', 'localtime', sameLoc.id);
  } else {
    db.prepare('INSERT INTO placements(item_id,shelf_id,box_id,qty) VALUES (?,?,?,?)')
      .run(ii, shelfId, boxId, qty);
  }
  const loc = lib.locationPath(db, shelfId, boxId).join(' › ');
  lib.addLog(db, { itemId: ii, action: 'in', qty, location: loc, detail: `识别入库（置信度 ${(item.confidence * 100).toFixed(0)}%）` });
  db.prepare("UPDATE intake_queue SET status='done' WHERE id=?").run(row.id);

  ok(res, { itemId: ii, merged: !!existing, location: loc, qty });
}));

// ---- 出库 ----
router.post('/items/:id/out', wrap(async (req, res) => {
  const db = req.db;
  const itemId = Number(req.params.id);
  lib.mustExist(db, 'items', itemId, '物品');
  const p = db.prepare('SELECT * FROM placements WHERE id=? AND item_id=?').get(Number(req.body.placementId), itemId);
  if (!p) throw new ApiError(404, '找不到该存放记录');
  const all = req.body.all === true || req.body.all === 'true';
  const qty = all ? p.qty : Math.max(0, Number(req.body.qty) || 0);
  if (qty <= 0) throw new ApiError(400, '取出数量必须大于 0');
  if (qty > p.qty) throw new ApiError(400, `取出数量超过库存（当前 ${p.qty}）`);
  const remain = p.qty - qty;
  db.prepare("UPDATE placements SET qty=?, updated_at=datetime('now','localtime') WHERE id=?").run(remain, p.id);
  const loc = lib.locationPath(db, p.shelf_id, p.box_id).join(' › ');
  lib.addLog(db, { itemId, action: 'out', qty, location: loc, detail: remain === 0 ? '已取空' : `剩余 ${remain}` });
  ok(res, { remain, emptied: remain === 0, location: loc });
}));

// ---- 移位（整个存放记录） ----
router.post('/items/:id/move', wrap(async (req, res) => {
  const db = req.db;
  const itemId = Number(req.params.id);
  lib.mustExist(db, 'items', itemId, '物品');
  const p = db.prepare('SELECT * FROM placements WHERE id=? AND item_id=?').get(Number(req.body.placementId), itemId);
  if (!p) throw new ApiError(404, '找不到该存放记录');
  const shelfId = req.body.shelfId ? Number(req.body.shelfId) : null;
  const boxId = req.body.boxId ? Number(req.body.boxId) : null;
  if (!shelfId && !boxId) throw new ApiError(400, '请选择目标位置');
  if (boxId) lib.mustExist(db, 'boxes', boxId, '箱子');
  if (shelfId) lib.mustExist(db, 'shelves', shelfId, '层');
  db.prepare("UPDATE placements SET shelf_id=?, box_id=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(shelfId, boxId, p.id);
  const loc = lib.locationPath(db, shelfId, boxId).join(' › ');
  lib.addLog(db, { itemId, action: 'move', qty: p.qty, location: loc, detail: '移位' });
  ok(res, { location: loc });
}));

// ---- 编辑物品（入库前后都可随时改名/改类别/改别名，修正识别失误） ----
router.patch('/items/:id', wrap(async (req, res) => {
  const db = req.db;
  const item = lib.mustExist(db, 'items', Number(req.params.id), '物品');
  const b = req.body || {};

  const name = b.name === undefined ? item.name : String(b.name).trim();
  if (!name) throw new ApiError(400, '物品名称不能为空');

  // 改名唯一性：避免出现两条同名物品（同名应由入库合并处理）
  if (name !== item.name) {
    const dup = db.prepare('SELECT id FROM items WHERE name=? AND id<>?').get(name, item.id);
    if (dup) throw new ApiError(409, `已存在同名物品「${name}」，请换一个名称`);
  }

  const cat = b.category === undefined ? null : resolveCategory(db, b.category);
  const aliases = b.aliases === undefined ? item.aliases : JSON.stringify(b.aliases || []);
  const size = ['S', 'M', 'L'].includes(b.size) ? b.size : item.size_class;
  const note = b.note === undefined ? item.note : (b.note || null);
  const catId = cat ? cat.id : item.category_id;

  db.prepare('UPDATE items SET name=?, category_id=?, aliases=?, size_class=?, note=? WHERE id=?')
    .run(name, catId, aliases, size, note, item.id);

  const changed = [];
  if (name !== item.name) changed.push(`名称 ${item.name} → ${name}`);
  const oldCat = item.category_id ? db.prepare('SELECT name FROM categories WHERE id=?').get(item.category_id) : null;
  if (cat && (!oldCat || oldCat.name !== cat.name)) changed.push(`类别 ${oldCat ? oldCat.name : '未分类'} → ${cat.name}`);
  if (b.note !== undefined && note !== item.note) changed.push('备注更新');
  if (changed.length) {
    lib.addLog(db, { itemId: item.id, action: 'edit', qty: 0, location: '', detail: '手工修正：' + changed.join('；') });
  }
  const fresh = db.prepare('SELECT * FROM items WHERE id=?').get(item.id);
  ok(res, { ...fresh, aliases: JSON.parse(fresh.aliases || '[]'), category: cat ? cat.name : (oldCat ? oldCat.name : '') });
}));

// ---- 详情 ----
router.get('/items/:id', wrap(async (req, res) => {
  const db = req.db;
  const item = lib.mustExist(db, 'items', Number(req.params.id), '物品');
  const cat = item.category_id ? db.prepare('SELECT * FROM categories WHERE id=?').get(item.category_id) : null;
  const images = db.prepare('SELECT * FROM item_images WHERE item_id=? ORDER BY is_main DESC, id').all(item.id);
  const placements = db.prepare('SELECT * FROM placements WHERE item_id=? ORDER BY id').all(item.id)
    .map((p) => ({ ...p, path: lib.locationPath(db, p.shelf_id, p.box_id).join(' › ') }));
  const logs = db.prepare('SELECT * FROM logs WHERE item_id=? ORDER BY id DESC LIMIT 50').all(item.id);
  ok(res, { ...item, aliases: JSON.parse(item.aliases || '[]'), category: cat ? cat.name : '', images, placements, logs });
}));

// ---- 列表 ----
router.get('/items', (req, res) => {
  const db = req.db;
  const q = String(req.query.q || '').trim();
  let rows = db.prepare(`
    SELECT i.*, c.name AS category,
      (SELECT file FROM item_images ii WHERE ii.item_id=i.id AND ii.is_main=1 LIMIT 1) AS img,
      (SELECT COALESCE(SUM(qty),0) FROM placements p WHERE p.item_id=i.id) AS totalQty
    FROM items i LEFT JOIN categories c ON c.id=i.category_id ORDER BY i.id DESC LIMIT 200
  `).all();
  if (q) {
    const lower = q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(lower) ||
      JSON.parse(r.aliases || '[]').some((a) => String(a).toLowerCase().includes(lower)));
  }
  if (req.query.categoryId) rows = rows.filter((r) => r.category_id === Number(req.query.categoryId));
  ok(res, rows.map((r) => ({ ...r, aliases: JSON.parse(r.aliases || '[]') })));
});

module.exports = router;
