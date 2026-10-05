// 收纳空间：四级结构 CRUD + AI 对话生成 + 应用 + 柜子实拍照片
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { ApiError, ok, wrap } = require('../util');
const lib = require('../lib');
const structureGen = require('../services/structureGen');
const { currentProvider } = require('../services/aiProvider');
const { IMAGES_DIR, UPLOADS_DIR } = require('../paths');

const router = express.Router();

// 柜子照片上传：先落到 uploads，再由处理函数移动到 images/cabinet-<id>/
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = extMap[file.mimetype] || path.extname(file.originalname || '') || '.jpg';
      cb(null, `cab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    if (/^image\//.test(file.mimetype) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name)) cb(null, true);
    else cb(new ApiError(400, '仅支持图片文件（jpg/png/webp/gif/bmp/avif；HEIC 请先转 JPG）'));
  },
});

const ENT = {
  zones: { table: 'zones', parent: null, label: '区域' },
  cabinets: { table: 'cabinets', parent: 'zone_id', label: '柜子' },
  shelves: { table: 'shelves', parent: 'cabinet_id', label: '层/抽屉' },
  boxes: { table: 'boxes', parent: 'shelf_id', label: '箱子' },
};
const DOORS = ['double', 'single', 'drawer'];

// 整棵树
router.get('/structure', (req, res) => ok(res, lib.getTree(req.db)));

// AI 对话生成（预览，不入库）
router.post('/structure/generate', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw new ApiError(400, '请输入结构描述');
  const provider = currentProvider();
  const tree = await structureGen.generate(provider, text);
  ok(res, tree);
}));

// 应用生成的结构
router.post('/structure/apply', wrap(async (req, res) => {
  const { zoneName, floors } = req.body || {};
  if (!zoneName || !Array.isArray(floors) || !floors.length) throw new ApiError(400, '结构数据不完整');
  const db = req.db;
  const zi = db.prepare('INSERT INTO zones(name, sort) VALUES (?,?)')
    .run(zoneName, lib.nextSort(db, 'zones', null, null)).lastInsertRowid;
  for (const f of floors) {
    for (const c of f.cabinets || []) {
      const ci = db.prepare('INSERT INTO cabinets(zone_id,name,door,floor,sort) VALUES (?,?,?,?,?)')
        .run(zi, c.name, DOORS.includes(c.door) ? c.door : 'single', Number(f.floor) || 1,
          lib.nextSort(db, 'cabinets', 'zone_id', zi)).lastInsertRowid;
      for (const s of (c.shelves && c.shelves.length ? c.shelves : [{ name: c.door === 'drawer' ? '抽屉1' : '第1层', kind: c.door === 'drawer' ? 'drawer' : 'shelf' }])) {
        db.prepare('INSERT INTO shelves(cabinet_id,name,kind,sort) VALUES (?,?,?,?)')
          .run(ci, s.name, s.kind === 'drawer' ? 'drawer' : 'shelf', lib.nextSort(db, 'shelves', 'cabinet_id', ci));
      }
    }
  }
  lib.addLog(db, { action: 'structure', location: zoneName, detail: `AI 生成结构：${floors.length} 层` });
  ok(res, { zoneId: zi, tree: lib.getTree(db) });
}));

// ---- 柜子实拍照片：上传 / 更换 / 删除 ----
// 目的：让收纳空间里的柜子有"真实长相"，入库选位置时能对照实物，减少放错柜子
function removePhotoFile(rel) {
  if (!rel || !/^images\//.test(rel)) return;   // 只允许删 images/ 下的托管文件
  try {
    const p = path.resolve(IMAGES_DIR, '..', rel);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* 文件已不在，忽略 */ }
}

router.post('/cabinets/:id/photo', upload.single('image'), wrap(async (req, res) => {
  const db = req.db;
  const cab = lib.mustExist(db, 'cabinets', Number(req.params.id), '柜子');
  if (!req.file) throw new ApiError(400, '请上传图片（字段名 image）');
  const dir = path.join(IMAGES_DIR, `cabinet-${cab.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(req.file.filename) || '.jpg';
  const name = `cab-${Date.now()}${ext}`;
  try {
    fs.renameSync(req.file.path, path.join(dir, name));
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch { /* 清理失败忽略 */ }
    throw new ApiError(500, '照片保存失败：' + e.message);
  }
  const old = cab.photo;
  const rel = `images/cabinet-${cab.id}/${name}`;
  db.prepare('UPDATE cabinets SET photo=? WHERE id=?').run(rel, cab.id);
  if (old && old !== rel) removePhotoFile(old);   // 换新照片时清掉旧文件
  lib.addLog(db, { action: 'structure', location: cab.name, detail: '更新柜子实拍照片' });
  ok(res, { photo: rel, tree: lib.getTree(db) });
}));

router.delete('/cabinets/:id/photo', wrap(async (req, res) => {
  const db = req.db;
  const cab = lib.mustExist(db, 'cabinets', Number(req.params.id), '柜子');
  removePhotoFile(cab.photo);
  db.prepare('UPDATE cabinets SET photo=NULL WHERE id=?').run(cab.id);
  lib.addLog(db, { action: 'structure', location: cab.name, detail: '删除柜子实拍照片' });
  ok(res, { tree: lib.getTree(db) });
}));

// 通用：新建
router.post('/:ent', wrap(async (req, res) => {
  const ent = ENT[req.params.ent];
  if (!ent) throw new ApiError(404, '未知实体');
  const db = req.db;
  const b = req.body || {};
  let parentId = null;
  if (ent.parent) {
    parentId = Number(b.parentId);
    if (!parentId) throw new ApiError(400, `缺少父级 parentId`);
    const parentTable = { zone_id: 'zones', cabinet_id: 'cabinets', shelf_id: 'shelves' }[ent.parent];
    lib.mustExist(db, parentTable, parentId, '父级');
  }
  if (ent === ENT.cabinets && !DOORS.includes(b.door)) throw new ApiError(400, '门型必须是 double/single/drawer');
  if (ent === ENT.shelves && b.kind && !['shelf', 'drawer'].includes(b.kind)) throw new ApiError(400, '类型必须是 shelf/drawer');
  const name = String(b.name || '').trim();
  if (!name) throw new ApiError(400, '名称不能为空');
  const sort = lib.nextSort(db, ent.table, ent.parent, parentId);
  let info;
  if (ent === ENT.zones) info = db.prepare('INSERT INTO zones(name,sort) VALUES (?,?)').run(name, sort);
  else if (ent === ENT.cabinets) {
    info = db.prepare('INSERT INTO cabinets(zone_id,name,door,floor,sort) VALUES (?,?,?,?,?)')
      .run(parentId, name, b.door || 'single', Math.max(1, Number(b.floor) || 1), sort);
    // 柜子默认带一个层/抽屉，保证立即可入库（PRD：快捷入库）
    db.prepare('INSERT INTO shelves(cabinet_id,name,kind,sort) VALUES (?,?,?,?)')
      .run(info.lastInsertRowid, (b.door || 'single') === 'drawer' ? '抽屉1' : '第1层',
        (b.door || 'single') === 'drawer' ? 'drawer' : 'shelf', 1);
  }
  else if (ent === ENT.shelves) info = db.prepare('INSERT INTO shelves(cabinet_id,name,kind,sort) VALUES (?,?,?,?)')
    .run(parentId, name, b.kind === 'drawer' ? 'drawer' : 'shelf', sort);
  else info = db.prepare('INSERT INTO boxes(shelf_id,name,color,sort) VALUES (?,?,?,?)')
    .run(parentId, name, b.color || null, sort);
  lib.addLog(db, { action: 'structure', location: name, detail: `新建${ent.label}` });
  ok(res, { id: info.lastInsertRowid, tree: lib.getTree(db) });
}));

// 通用：修改
router.patch('/:ent/:id', wrap(async (req, res) => {
  const ent = ENT[req.params.ent];
  if (!ent) throw new ApiError(404, '未知实体');
  const db = req.db;
  lib.mustExist(db, ent.table, Number(req.params.id), ent.label);
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) throw new ApiError(400, '名称不能为空'); sets.push('name=?'); vals.push(n); }
  if (ent === ENT.cabinets && b.door !== undefined) {
    if (!DOORS.includes(b.door)) throw new ApiError(400, '门型不合法');
    sets.push('door=?'); vals.push(b.door);
  }
  if (ent === ENT.cabinets && b.floor !== undefined) { sets.push('floor=?'); vals.push(Math.max(1, Number(b.floor) || 1)); }
  if (ent === ENT.shelves && b.kind !== undefined) {
    if (!['shelf', 'drawer'].includes(b.kind)) throw new ApiError(400, '类型不合法');
    sets.push('kind=?'); vals.push(b.kind);
  }
  if (ent === ENT.boxes && b.color !== undefined) { sets.push('color=?'); vals.push(b.color); }
  if (b.sort !== undefined) { sets.push('sort=?'); vals.push(Number(b.sort) || 0); }
  if (!sets.length) throw new ApiError(400, '没有可更新字段');
  vals.push(Number(req.params.id));
  db.prepare(`UPDATE ${ent.table} SET ${sets.join(',')} WHERE id=?`).run(...vals);
  lib.addLog(db, { action: 'structure', detail: `修改${ent.label}` });
  ok(res, { tree: lib.getTree(db) });
}));

// 通用：删除（有库存时拒绝）
router.delete('/:ent/:id', wrap(async (req, res) => {
  const ent = ENT[req.params.ent];
  if (!ent) throw new ApiError(404, '未知实体');
  const db = req.db;
  const row = lib.mustExist(db, ent.table, Number(req.params.id), ent.label);
  const { shelfIds, boxIds } = lib.subtreeContainers(db, req.params.ent, Number(req.params.id));
  const inv = lib.hasInventory(db, { shelfIds, boxIds });
  if (inv > 0) throw new ApiError(400, `该${ent.label}下还有 ${inv} 条库存记录，请先取出或移走物品`);
  db.prepare(`DELETE FROM ${ent.table} WHERE id=?`).run(row.id);
  lib.addLog(db, { action: 'structure', detail: `删除${ent.label}` });
  ok(res, { tree: lib.getTree(db) });
}));

module.exports = router;
