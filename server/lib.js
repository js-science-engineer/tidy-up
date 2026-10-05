// 共享查询：四级树、位置路径、流水、排序
const { ApiError } = require('./util');

function getTree(db) {
  const zones = db.prepare('SELECT * FROM zones ORDER BY sort, id').all();
  const cabinets = db.prepare('SELECT * FROM cabinets ORDER BY sort, id').all();
  const shelves = db.prepare('SELECT * FROM shelves ORDER BY sort, id').all();
  const boxes = db.prepare('SELECT * FROM boxes ORDER BY sort, id').all();
  const placements = db.prepare(`
    SELECT p.*, i.name AS item_name,
           (SELECT file FROM item_images ii WHERE ii.item_id = i.id AND ii.is_main = 1 LIMIT 1) AS img
    FROM placements p JOIN items i ON i.id = p.item_id
  `).all();

  const boxesBy = new Map(); boxes.forEach(b => boxesBy.set(b.id, { ...b, items: [] }));
  const shelvesBy = new Map(); shelves.forEach(s => shelvesBy.set(s.id, { ...s, boxes: [], items: [] }));
  const cabinetsBy = new Map(); cabinets.forEach(c => cabinetsBy.set(c.id, { ...c, shelves: [] }));

  const stateOf = (list) => {
    const active = list.some(p => p.qty > 0);
    const any = list.length > 0;
    return active ? 'full' : (any ? 'part' : 'empty');
  };

  for (const p of placements) {
    if (p.box_id && boxesBy.has(p.box_id)) boxesBy.get(p.box_id).items.push(p);
    else if (p.shelf_id && shelvesBy.has(p.shelf_id)) shelvesBy.get(p.shelf_id).items.push(p);
  }
  for (const b of boxesBy.values()) {
    const s = shelvesBy.get(b.shelf_id);
    if (s) s.boxes.push(b);
  }
  for (const s of shelvesBy.values()) {
    s.state = stateOf([...s.items, ...s.boxes.flatMap(b => b.items)]);
    const c = cabinetsBy.get(s.cabinet_id);
    if (c) c.shelves.push(s);
  }
  const zonesOut = zones.map(z => ({ ...z, floors: [] }));
  const zonesById = new Map(zonesOut.map(z => [z.id, z]));
  for (const c of cabinetsBy.values()) {
    const filled = c.shelves.filter(s => s.state === 'full').length;
    c.occupancy = c.shelves.length ? Math.round((filled / c.shelves.length) * 100) : 0;
    const z = zonesById.get(c.zone_id);
    if (z) {
      let fl = z.floors.find(f => f.floor === (c.floor || 1));
      if (!fl) { fl = { floor: c.floor || 1, cabinets: [] }; z.floors.push(fl); }
      fl.cabinets.push(c);
    }
  }
  for (const z of zonesOut) z.floors.sort((a, b) => a.floor - b.floor);
  return zonesOut;
}

// 位置路径：区域 › 柜 › 层 › 箱
function locationPath(db, shelfId, boxId) {
  const parts = [];
  if (boxId) {
    const box = db.prepare('SELECT * FROM boxes WHERE id=?').get(boxId);
    if (!box) return parts;
    parts.push(box.name);
    shelfId = box.shelf_id;
  }
  if (shelfId) {
    const shelf = db.prepare('SELECT * FROM shelves WHERE id=?').get(shelfId);
    if (shelf) {
      parts.unshift(shelf.name);
      const cab = db.prepare('SELECT * FROM cabinets WHERE id=?').get(shelf.cabinet_id);
      if (cab) {
        parts.unshift(cab.name);
        const zone = db.prepare('SELECT * FROM zones WHERE id=?').get(cab.zone_id);
        if (zone) parts.unshift(zone.name);
      }
    }
  }
  return parts;
}

function addLog(db, { itemId = null, action, qty = 0, location = '', detail = '' }) {
  db.prepare('INSERT INTO logs(item_id, action, qty, location, detail) VALUES (?,?,?,?,?)')
    .run(itemId, action, qty, location, detail);
}

function nextSort(db, table, parentField, parentId) {
  const row = parentField
    ? db.prepare(`SELECT COALESCE(MAX(sort),0)+1 AS n FROM ${table} WHERE ${parentField}=?`).get(parentId)
    : db.prepare(`SELECT COALESCE(MAX(sort),0)+1 AS n FROM ${table}`).get();
  return row.n;
}

// 实体子树下所有 shelf/box id（用于删除前库存检查）
function subtreeContainers(db, ent, id) {
  const shelfIds = [];
  const boxIds = [];
  const addCabinet = (cabId) => {
    for (const s of db.prepare('SELECT id FROM shelves WHERE cabinet_id=?').all(cabId)) {
      shelfIds.push(s.id);
      for (const b of db.prepare('SELECT id FROM boxes WHERE shelf_id=?').all(s.id)) boxIds.push(b.id);
    }
  };
  if (ent === 'zones') {
    for (const c of db.prepare('SELECT id FROM cabinets WHERE zone_id=?').all(id)) addCabinet(c.id);
  } else if (ent === 'cabinets') {
    addCabinet(id);
  } else if (ent === 'shelves') {
    shelfIds.push(id);
    for (const b of db.prepare('SELECT id FROM boxes WHERE shelf_id=?').all(id)) boxIds.push(b.id);
  } else if (ent === 'boxes') {
    boxIds.push(id);
  }
  return { shelfIds, boxIds };
}

function hasInventory(db, { shelfIds, boxIds }) {
  if (shelfIds.length) {
    const q = db.prepare(
      `SELECT COUNT(*) AS n FROM placements WHERE qty > 0 AND (shelf_id IN (${shelfIds.map(() => '?')}) OR box_id IN (${boxIds.map(() => '?') || "''"}))`
    );
    // 简化：分开查
  }
  const count = (field, ids) => {
    if (!ids.length) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM placements WHERE qty > 0 AND ${field} IN (${ids.map(() => '?')})`).get(...ids);
    return row.n;
  };
  return count('shelf_id', shelfIds) + count('box_id', boxIds);
}

function mustExist(db, table, id, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!row) throw new ApiError(404, `${label}不存在`);
  return row;
}

module.exports = { getTree, locationPath, addLog, nextSort, subtreeContainers, hasInventory, mustExist };
