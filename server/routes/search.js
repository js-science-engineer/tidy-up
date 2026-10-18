// 搜索：精确匹配 + AI 语义推测
// 匹配打分统一走 public/js/cloud/tidy-shared.js 的 matchItems，
// 保证本地模式与云端模式结果一致（云端在浏览器里跑同一个函数）。
const express = require('express');
const { ok, wrap, ApiError } = require('../util');
const lib = require('../lib');
const T = require('../../public/js/cloud/tidy-shared.js');
const { extractJSON } = require('../services/promptUtil');
const { currentProvider } = require('../services/aiProvider');

const router = express.Router();

function loadItemSummaries(db) {
  return db.prepare(`
    SELECT i.id, i.name, i.aliases, i.note, i.category_id, c.name AS category,
      (SELECT COALESCE(SUM(qty),0) FROM placements p WHERE p.item_id=i.id) AS totalQty,
      (SELECT file FROM item_images ii WHERE ii.item_id=i.id ORDER BY ii.is_main DESC, ii.id ASC LIMIT 1) AS img
    FROM items i LEFT JOIN categories c ON c.id=i.category_id
  `).all().map((r) => ({ ...r, aliases: T.parseAliases(r.aliases) }));
}

function withPlacements(db, rows) {
  return rows.map((r) => ({
    ...r,
    placements: db.prepare('SELECT * FROM placements WHERE item_id=? AND qty > 0 ORDER BY id').all(r.id)
      .map((p) => ({ id: p.id, qty: p.qty, path: lib.locationPath(db, p.shelf_id, p.box_id).join(' › ') })),
  }));
}

// 把匹配分换算成 0~100 的展示百分比（纯展示，不影响排序）
function toPercent(score) {
  return Math.max(1, Math.min(100, Math.round((score / 160) * 100)));
}

router.get('/', wrap(async (req, res) => {
  const db = req.db;
  const q = String(req.query.q || '').trim();
  const mode = req.query.mode === 'semantic' ? 'semantic' : 'exact';
  if (!q) throw new ApiError(400, '请输入搜索内容');

  const items = loadItemSummaries(db);
  let results;
  let usedMode = mode;

  if (mode === 'exact') {
    results = T.matchItems(items, q).map((m) => ({ ...m.item, matchScore: toPercent(m.score), matchReason: '' }));
  } else {
    // 语义：交给 AI 推测；失败降级为关键词匹配
    const provider = currentProvider();
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
        .slice(0, 8)
        .map((m) => ({ ...byId.get(Number(m.id)), matchScore: Math.round(Number(m.score) * 100), matchReason: m.reason || '' }));
      // AI 没给出任何有效匹配时，别让用户面对空白页 —— 补一层关键词结果
      if (!results.length) {
        results = T.matchItems(items, q).map((m) => ({ ...m.item, matchScore: toPercent(m.score), matchReason: '' }));
        usedMode = 'exact-fallback';
      }
    } catch (e) {
      results = T.matchItems(items, q).map((m) => ({ ...m.item, matchScore: toPercent(m.score), matchReason: '' }));
      usedMode = 'exact-fallback';
    }
  }

  // 类别筛选：兼容「类别 id」和「类别名」两种传参
  // （早期实现只按 category_id 比数字，而下拉框传的是类别名 → 一选类别就零结果）
  const cid = req.query.categoryId;
  if (cid) {
    const cat = db.prepare('SELECT name FROM categories WHERE id=?').get(Number(cid));
    const wantName = cat ? cat.name : String(cid);
    results = results.filter((r) => T.categoryMatches(r, cid, wantName));
  }

  // 区域筛选：物品在该区域下有在库记录
  if (req.query.zoneId) {
    const zoneShelves = new Set(db.prepare(
      'SELECT s.id FROM shelves s JOIN cabinets c ON c.id=s.cabinet_id WHERE c.zone_id=?'
    ).all(Number(req.query.zoneId)).map((x) => Number(x.id)));
    results = results.filter((r) => db.prepare('SELECT shelf_id, box_id FROM placements WHERE item_id=? AND qty>0').all(r.id)
      .some((p) => {
        if (p.box_id) {
          const b = db.prepare('SELECT shelf_id FROM boxes WHERE id=?').get(p.box_id);
          return b && zoneShelves.has(Number(b.shelf_id));
        }
        return p.shelf_id && zoneShelves.has(Number(p.shelf_id));
      }));
  }

  ok(res, { mode: usedMode, query: q, results: withPlacements(db, results) });
}));

module.exports = router;
