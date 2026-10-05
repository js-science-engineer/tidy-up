// 首页统计 + 今日计划聚合 + 统计看板
const express = require('express');
const { ok } = require('../util');
const lib = require('../lib');

const router = express.Router();

// 把树里的一个"层/抽屉"转成前端可视化需要的结构（含柜内物品明细）
// placementId / boxId 供前端"拖拽移位"精确定位到某一条存放记录（同一物品可在多位置各有一份）
function shelfView(s) {
  const items = [];
  for (const p of s.items) {
    if (p.qty > 0) items.push({ id: p.item_id, placementId: p.id, name: p.item_name, qty: p.qty, img: p.img, box: null, boxId: null });
  }
  for (const b of s.boxes || []) {
    for (const p of b.items) {
      if (p.qty > 0) items.push({ id: p.item_id, placementId: p.id, name: p.item_name, qty: p.qty, img: p.img, box: b.name, boxId: b.id });
    }
  }
  return {
    id: s.id, name: s.name, kind: s.kind, state: s.state,
    items: items.slice(0, 8),
    more: Math.max(0, items.length - 8),
    total: items.reduce((n, i) => n + i.qty, 0),
  };
}

function zoneView(z) {
  const cabinets = z.floors.flatMap((f) => f.cabinets);
  return {
    id: z.id,
    name: z.name,
    cabinetCount: cabinets.length,
    occupancy: cabinets.length ? Math.round(cabinets.reduce((n, c) => n + c.occupancy, 0) / cabinets.length) : 0,
    itemQty: cabinets.reduce((n, c) => n + c.shelves.reduce((m, s) =>
      m + s.items.reduce((k, p) => k + p.qty, 0) + s.boxes.reduce((k, b) => k + b.items.reduce((j, p) => j + p.qty, 0), 0), 0), 0),
    cabinets: cabinets.map((c) => ({
      id: c.id, name: c.name, door: c.door, floor: c.floor || 1, occupancy: c.occupancy,
      shelves: c.shelves.map(shelfView),
    })),
  };
}

// 分类分布：每个分类下的物品种类数与库存件数
function categoryDistOf(db) {
  return db.prepare(`
    SELECT COALESCE(c.name,'未分类') AS name,
      COUNT(DISTINCT i.id) AS kinds,
      COALESCE(SUM(CASE WHEN p.qty > 0 THEN p.qty ELSE 0 END),0) AS qty
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN placements p ON p.item_id = i.id
    GROUP BY i.category_id
    ORDER BY qty DESC, kinds DESC, name
  `).all();
}

router.get('/overview', (req, res) => {  const db = req.db;
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  const zoneCount = db.prepare('SELECT COUNT(*) AS n FROM zones').get().n;
  const cabinetCount = db.prepare('SELECT COUNT(*) AS n FROM cabinets').get().n;
  const shelfCount = db.prepare('SELECT COUNT(*) AS n FROM shelves').get().n;
  const boxCount = db.prepare('SELECT COUNT(*) AS n FROM boxes').get().n;
  const inStock = db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM placements').get().n;
  const todayIn = db.prepare("SELECT COALESCE(SUM(qty),0) AS n FROM logs WHERE action='in' AND date(created_at)=?").get(todayStr).n;

  // 今日计划
  const pendingQueue = db.prepare("SELECT id, payload, created_at FROM intake_queue WHERE status='pending' ORDER BY id DESC").all()
    .map((r) => {
      const p = JSON.parse(r.payload);
      const names = (p.rec?.items || []).map((i) => i.name).join('、');
      return { id: r.id, mode: p.mode, names, created_at: r.created_at };
    });
  const todayLogs = db.prepare(`
    SELECT l.*, i.name AS item_name FROM logs l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.action IN ('in','out','move','edit') AND date(l.created_at)=? ORDER BY l.id DESC LIMIT 20
  `).all(todayStr);

  // 最近入库物品
  const recent = db.prepare(`
    SELECT i.id, i.name, c.name AS category,
      (SELECT file FROM item_images ii WHERE ii.item_id=i.id AND ii.is_main=1 LIMIT 1) AS img,
      (SELECT COALESCE(SUM(qty),0) FROM placements p WHERE p.item_id=i.id) AS totalQty
    FROM items i LEFT JOIN categories c ON c.id=i.category_id ORDER BY i.id DESC LIMIT 8
  `).all();

  // 空间总览（区域 → 柜子 → 层 → 物品明细）
  const zones = lib.getTree(db).map(zoneView);

  // 分类分布（种类数 + 库存件数）
  const categoryDist = categoryDistOf(db);

  ok(res, {
    stats: { itemCount, zoneCount, cabinetCount, shelfCount, boxCount, inStock, todayIn },
    zones,
    categoryDist,
    todayPlan: { pendingQueue, todayLogs },
    recent,
  });
});

// 统计看板：分类分布 / 区域占用 / 库存 TOP / 近 7 天出入库趋势
router.get('/board', (req, res) => {
  const db = req.db;
  const categoryDist = categoryDistOf(db);

  const zoneOccupancy = lib.getTree(db).map((z) => {
    const cabs = z.floors.flatMap((f) => f.cabinets);
    return {
      name: z.name,
      cabinets: cabs.length,
      occupancy: cabs.length ? Math.round(cabs.reduce((n, c) => n + c.occupancy, 0) / cabs.length) : 0,
      qty: cabs.reduce((n, c) => n + c.shelves.reduce((m, s) =>
        m + s.items.reduce((k, p) => k + p.qty, 0) + s.boxes.reduce((k, b) => k + b.items.reduce((j, p) => j + p.qty, 0), 0), 0), 0),
    };
  }).sort((a, b) => b.qty - a.qty);

  const topItems = db.prepare(`
    SELECT i.id, i.name, c.name AS category,
      (SELECT file FROM item_images ii WHERE ii.item_id=i.id AND ii.is_main=1 LIMIT 1) AS img,
      (SELECT COALESCE(SUM(qty),0) FROM placements p WHERE p.item_id=i.id) AS qty,
      (SELECT COUNT(*) FROM placements p WHERE p.item_id=i.id AND p.qty>0) AS spots
    FROM items i LEFT JOIN categories c ON c.id=i.category_id
    ORDER BY qty DESC, i.id DESC LIMIT 10
  `).all();

  // 近 7 天出入库
  const trend = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (let d = 6; d >= 0; d--) {
    const dt = new Date(Date.now() - d * 86400000);
    const ds = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const inQ = db.prepare("SELECT COALESCE(SUM(qty),0) AS n FROM logs WHERE action='in' AND date(created_at)=?").get(ds).n;
    const outQ = db.prepare("SELECT COALESCE(SUM(qty),0) AS n FROM logs WHERE action='out' AND date(created_at)=?").get(ds).n;
    trend.push({ date: ds, label: `${dt.getMonth() + 1}/${dt.getDate()}`, inQty: inQ, outQty: outQ });
  }

  // 出入库流水明细：用户做了什么、动了哪个物品、多少件、在哪里（统计看板核心区块）
  const recentLogs = db.prepare(`
    SELECT l.*, i.name AS item_name,
      (SELECT file FROM item_images ii WHERE ii.item_id=l.item_id AND ii.is_main=1 LIMIT 1) AS img
    FROM logs l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.action IN ('in','out','move','edit')
    ORDER BY l.id DESC LIMIT 80
  `).all();

  ok(res, {
    totals: {
      items: db.prepare('SELECT COUNT(*) AS n FROM items').get().n,
      zones: db.prepare('SELECT COUNT(*) AS n FROM zones').get().n,
      cabinets: db.prepare('SELECT COUNT(*) AS n FROM cabinets').get().n,
      shelves: db.prepare('SELECT COUNT(*) AS n FROM shelves').get().n,
      boxes: db.prepare('SELECT COUNT(*) AS n FROM boxes').get().n,
      inStock: db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM placements').get().n,
    },
    categoryDist, zoneOccupancy, topItems, trend, recentLogs,
  });
});

// 元数据：分类 + 结构树（入库位置选择器 / 搜索筛选用）
router.get('/meta', (req, res) => {
  const db = req.db;
  const categories = db.prepare('SELECT name FROM categories ORDER BY is_preset DESC, id').all().map((r) => r.name);
  ok(res, { categories, zones: lib.getTree(db) });
});

module.exports = router;
