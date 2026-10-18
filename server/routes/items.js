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
// 名称查重算法与云端共用同一份实现（public/js/cloud/tidy-shared.js 是 UMD，Node 也可直接 require）
const T = require('../../public/js/cloud/tidy-shared.js');

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

// ---- 手动录入（不用 AI）：只上传照片，物品名/类别/数量由用户自己填 ----
// 与「AI 识别」并存，供用户按需选择。这里只负责把照片存下来并占一条队列记录，
// 名称等字段在 /intake/confirm 时才落库（payload.manual=true 允许任意 index）。
// status 直接给 'done'：它不是"待 AI 确认"的任务，不该出现在待确认队列里。
router.post('/intake/manual', upload.single('image'), wrap(async (req, res) => {
  const file = req.file;
  const mime = file ? (IMAGE_MIMES[path.extname(file.filename).toLowerCase()] || 'image/jpeg') : null;
  const payload = {
    mode: 'manual', manual: true,
    file: file ? file.filename : null, mime,
    previewUrl: file ? `/api/uploads/${file.filename}` : '',
    rec: { items: [] },
  };
  const id = req.db.prepare("INSERT INTO intake_queue(payload,status) VALUES (?,'done')")
    .run(JSON.stringify(payload)).lastInsertRowid;
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
  // 手动录入（payload.manual）的照片可以配任意多条物品，不受 rec.items 长度限制
  const item = (payload.rec.items || [])[Number(b.index) || 0] || (payload.manual ? {} : null);
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

  // 同名 / 近似名合并：v2.4 起由前端先查重、用户确认后再显式传 mergeItemId，
  // 也可以指定 mergePlacementId 直接并到"已入库过的那个位置"。
  // 未传 mergeItemId 时仍保留旧的「完全同名自动合并」行为（兼容老客户端与脚本调用）。
  const mergeItemId = b.mergeItemId ? Number(b.mergeItemId) : null;
  const mergePlacementId = b.mergePlacementId ? Number(b.mergePlacementId) : null;
  let existing = null;
  let ii;
  if (mergeItemId) {
    existing = lib.mustExist(db, 'items', mergeItemId, '要合并的物品');
    ii = existing.id;
  } else {
    existing = db.prepare('SELECT id, name FROM items WHERE name=?').get(name) || null;
    ii = existing ? existing.id
      : db.prepare('INSERT INTO items(name,aliases,category_id,size_class,note) VALUES (?,?,?,?,?)')
        .run(name, JSON.stringify(b.aliases || item.aliases || []), cat.id,
          ['S', 'M', 'L'].includes(b.size) ? b.size : (item.size || 'S'), b.note || null).lastInsertRowid;
  }

  // 合并时名称不同（例如库里叫「十字螺丝刀」、这次写成「十字螺丝刀(小)」）：
  // 保留库里已有的规范名，把这次的写法补进别名，下次搜索/查重都能命中，不再长出第二条物品。
  let aliasAdded = '';
  if (existing && existing.name && T.nameKey(existing.name) !== T.nameKey(name)) {
    const oldAliases = JSON.parse(existing.aliases || '[]');
    if (name && !oldAliases.some((a) => T.nameKey(a) === T.nameKey(name))) {
      oldAliases.push(name);
      db.prepare('UPDATE items SET aliases=? WHERE id=?').run(JSON.stringify(oldAliases), ii);
      aliasAdded = name;
    }
  }

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
    // 立刻生成列表用的小图：用户下次打开总览时直接命中缓存，
    // 不用现场解一张 1600px 的大图（首次浏览会明显卡一下）
    require('../thumb').warm(rel).catch(() => {});
    mainUrl = rel;
  }

  // 同容器已有存放记录 → 累加数量；否则新建一条独立存放记录
  // mergePlacementId：用户明确选择"并到已有入库位置"，直接给那条记录加数量
  let locShelf = shelfId;
  let locBox = boxId;
  let mergedPlacementId = null;
  if (mergePlacementId) {
    const target = db.prepare('SELECT * FROM placements WHERE id=? AND item_id=?').get(mergePlacementId, ii);
    if (!target) throw new ApiError(404, '要合并的存放位置不存在');
    db.prepare("UPDATE placements SET qty=?, updated_at=datetime('now','localtime') WHERE id=?")
      .run(target.qty + qty, target.id);
    locShelf = target.shelf_id;
    locBox = target.box_id;
    mergedPlacementId = target.id;
  } else {
    const sameLoc = db.prepare('SELECT id, qty FROM placements WHERE item_id=? AND shelf_id IS ? AND box_id IS ?')
      .get(ii, shelfId, boxId);
    if (sameLoc) {
      db.prepare("UPDATE placements SET qty=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(sameLoc.qty + qty, sameLoc.id);
      mergedPlacementId = sameLoc.id;
    } else {
      mergedPlacementId = db.prepare('INSERT INTO placements(item_id,shelf_id,box_id,qty) VALUES (?,?,?,?)')
        .run(ii, shelfId, boxId, qty).lastInsertRowid;
    }
  }
  const loc = lib.locationPath(db, locShelf, locBox).join(' › ');
  const confidence = Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null;
  lib.addLog(db, {
    itemId: ii, action: 'in', qty, location: loc,
    detail: (payload.manual ? '手动录入' : `识别入库（置信度 ${(confidence * 100).toFixed(0)}%）`)
      + (existing && existing.name && existing.name !== name ? `；合并到「${existing.name}」（名称记为别名）` : ''),
  });
  db.prepare("UPDATE intake_queue SET status='done' WHERE id=?").run(row.id);

  ok(res, {
    itemId: ii, merged: !!existing, mergedName: existing ? existing.name : name,
    aliasAdded, placementId: mergedPlacementId, location: loc, qty,
  });
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

// ---- 名称查重（入库前） ----
// 返回库里与「刚输入的名字」重复/相近的已有物品，附上它们所有存放位置的选项，
// 供前端弹窗让用户选择：合并到已有物品（可指定并入哪个位置）还是换个名字/仍新建。
// ⚠️ 必须注册在 GET /items/:id 之前，否则会被 :id 吞掉（"name-check" 当 id 解析成 NaN → 404）
router.get('/items/name-check', (req, res) => {
  const db = req.db;
  const name = String(req.query.name || '').trim();
  if (!name) return ok(res, { name, matches: [] });
  const rows = db.prepare(`
    SELECT i.id, i.name, i.aliases, i.note, c.name AS category,
      (SELECT COALESCE(SUM(qty),0) FROM placements p WHERE p.item_id=i.id) AS totalQty
    FROM items i LEFT JOIN categories c ON c.id=i.category_id
  `).all();
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
  const found = T.findNameMatches(name, rows, { excludeId, limit: 5 });
  const matches = found.map((m) => ({
    id: m.item.id,
    name: m.item.name,
    category: m.item.category || '',
    totalQty: m.item.totalQty,
    score: m.score,
    reason: m.reason,
    placements: db.prepare('SELECT * FROM placements WHERE item_id=? ORDER BY qty DESC, id').all(m.item.id)
      .map((p) => ({ id: p.id, qty: p.qty, path: lib.locationPath(db, p.shelf_id, p.box_id).join(' › ') })),
  }));
  ok(res, { name, matches });
});

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
      (SELECT file FROM item_images ii WHERE ii.item_id=i.id ORDER BY ii.is_main DESC, ii.id ASC LIMIT 1) AS img,
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
