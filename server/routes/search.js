// 搜索：精确匹配 + AI 语义推测
const express = require('express');
const { ok, wrap, ApiError } = require('../util');
const lib = require('../lib');
const { extractJSON } = require('../services/promptUtil');
const { currentProvider } = require('../services/aiProvider');

const router = express.Router();

function loadItemSummaries(db) {
  return db.prepare(`
    SELECT i.id, i.name, i.aliases, c.name AS category,
      (SELECT COALESCE(SUM(qty),0) FROM placements p WHERE p.item_id=i.id) AS totalQty,
      (SELECT file FROM item_images ii WHERE ii.item_id=i.id AND ii.is_main=1 LIMIT 1) AS img
    FROM items i LEFT JOIN categories c ON c.id=i.category_id
  `).all().map((r) => ({ ...r, aliases: JSON.parse(r.aliases || '[]') }));
}

function withPlacements(db, rows) {
  return rows.map((r) => ({
    ...r,
    placements: db.prepare('SELECT * FROM placements WHERE item_id=? AND qty > 0 ORDER BY id').all(r.id)
      .map((p) => ({ id: p.id, qty: p.qty, path: lib.locationPath(db, p.shelf_id, p.box_id).join(' › ') })),
  }));
}

router.get('/', wrap(async (req, res) => {
  const db = req.db;
  const q = String(req.query.q || '').trim();
  const mode = req.query.mode === 'semantic' ? 'semantic' : 'exact';
  if (!q) throw new ApiError(400, '请输入搜索内容');
  const lower = q.toLowerCase();

  const matchExact = (r) => r.name.toLowerCase().includes(lower) ||
    r.aliases.some((a) => String(a).toLowerCase().includes(lower)) ||
    (r.category || '').toLowerCase().includes(lower);

  let results;
  let usedMode = mode;
  if (mode === 'exact') {
    results = loadItemSummaries(db).filter(matchExact);
  } else {
    // 语义：交给 AI 推测；失败降级为关键词过滤
    const provider = currentProvider();
    const items = loadItemSummaries(db);
    try {
      const raw = await provider.chat({
        intent: 'semantic',
        system: '你是物品搜索助手，根据用户的模糊描述推测用户可能指的物品，只输出合法 JSON。',
        user: [
          '根据用户描述从候选物品中选出可能匹配的，按匹配度(0~1)排序，最多 5 条，只输出 JSON：',
          '{"matches":[{"id":1,"score":0.9,"reason":"一句话理由"}]}',
          `候选物品：${JSON.stringify(items.map((i) => ({ id: i.id, name: i.name, aliases: i.aliases, category: i.category })))}`,
          `用户描述：${q}`,
          `INPUT: ${JSON.stringify({ query: q, items: items.map((i) => ({ id: i.id, name: i.name, aliases: i.aliases })) })}`,
        ].join('\n'),
      });
      const parsed = extractJSON(raw);
      const byId = new Map(items.map((i) => [i.id, i]));
      results = (parsed.matches || [])
        .filter((m) => byId.has(Number(m.id)))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((m) => ({ ...byId.get(Number(m.id)), matchScore: Math.round(Number(m.score) * 100), matchReason: m.reason || '' }));
    } catch (e) {
      results = items.filter(matchExact).map((r) => ({ ...r, matchScore: null, matchReason: '' }));
      usedMode = 'exact-fallback';
    }
  }

  // 类别/区域筛选
  if (req.query.categoryId) results = results.filter((r) => r.category_id === Number(req.query.categoryId));
  if (req.query.zoneId) {
    const zoneShelves = new Set(db.prepare(
      `SELECT s.id FROM shelves s JOIN cabinets c ON c.id=s.cabinet_id WHERE c.zone_id=?`
    ).all(Number(req.query.zoneId)).map((x) => x.id));
    results = results.filter((r) => withPlacements(db, [r])[0].placements.some((p) => p.path) && r.id);
    results = results.filter((r) => {
      const ps = db.prepare('SELECT shelf_id, box_id FROM placements WHERE item_id=? AND qty>0').all(r.id);
      return ps.some((p) => {
        if (p.box_id) {
          const b = db.prepare('SELECT shelf_id FROM boxes WHERE id=?').get(p.box_id);
          return b && zoneShelves.has(b.shelf_id);
        }
        return p.shelf_id && zoneShelves.has(p.shelf_id);
      });
    });
  }

  ok(res, { mode: usedMode, query: q, results: withPlacements(db, results) });
}));

module.exports = router;
