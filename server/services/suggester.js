// 智能分区建议：规则引擎（类别匹配 + 容量 + 同类优先），不消耗额外 token
const { locationPath } = require('../lib');

// 类别 → 容器名关键词
const CATEGORY_HINTS = {
  '电子元件': ['元件', '零件', '静电', '电子'],
  '开发板/模块': ['元件', '零件', '静电', '开发', '电子'],
  '仪器设备': ['仪表', '仪器', '设备'],
  '线材/连接件': ['线材', '线', '连接', '配件'],
  '工具': ['工具'],
  '化学试剂': ['试剂', '化学'],
  '耗材': ['耗材', '零件'],
  '结构件/五金': ['五金', '结构', '零件'],
  '包装/收纳': ['包装', '收纳'],
  '文档/资料': ['文档', '资料', '文件'],
};

function loadContainers(db) {
  const shelves = db.prepare('SELECT * FROM shelves').all();
  const boxes = db.prepare('SELECT * FROM boxes').all();
  const list = [];
  for (const s of shelves) list.push({ shelfId: s.id, boxId: null, name: s.name });
  for (const b of boxes) list.push({ shelfId: b.shelf_id, boxId: b.id, name: b.name });
  return list;
}

function usageOf(db, c) {
  if (c.boxId) {
    const r = db.prepare('SELECT COALESCE(SUM(qty),0) AS q FROM placements WHERE box_id=?').get(c.boxId).q;
    return r;
  }
  const r = db.prepare('SELECT COALESCE(SUM(qty),0) AS q FROM placements WHERE shelf_id=?').get(c.shelfId).q;
  return r;
}

function sameCategoryNearby(db, c, categoryId) {
  const row = c.boxId
    ? db.prepare(`SELECT COUNT(*) AS n FROM placements p JOIN items i ON i.id=p.item_id WHERE p.box_id=? AND i.category_id=?`).get(c.boxId, categoryId)
    : db.prepare(`SELECT COUNT(*) AS n FROM placements p JOIN items i ON i.id=p.item_id WHERE p.shelf_id=? AND i.category_id=?`).get(c.shelfId, categoryId);
  return row.n > 0;
}

function suggest(db, { category, size }) {
  const containers = loadContainers(db);
  if (!containers.length) {
    return { shelfId: null, boxId: null, path: [], reason: '还没有任何柜子，请先到「收纳空间」创建柜体，或使用 AI 对话生成。' };
  }
  const catIdRow = db.prepare('SELECT id FROM categories WHERE name=?').get(category);
  const categoryId = catIdRow ? catIdRow.id : null;
  const hints = CATEGORY_HINTS[category] || [];

  const scored = containers.map((c) => {
    let score = 0;
    const reasons = [];
    if (categoryId && sameCategoryNearby(db, c, categoryId)) { score += 5; reasons.push('该位置已有同类物品的存放记录'); }
    if (hints.some((h) => c.name.includes(h))) { score += 3; reasons.push(`容器名与「${category}」匹配`); }
    const u = usageOf(db, c);
    if (u < 10) { score += 2; reasons.push('剩余空间充足'); }
    else if (u < 30) score += 1;
    else score -= 1;
    return { c, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const path = locationPath(db, best.c.shelfId, best.c.boxId);
  const reason = best.reasons.length
    ? `理由：${[...new Set(best.reasons)].slice(0, 2).join('；')}。`
    : `理由：当前占用最低的可用格位。`;
  return { shelfId: best.c.shelfId, boxId: best.c.boxId, path, reason };
}

module.exports = { suggest };
