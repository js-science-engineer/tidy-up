// 共享纯逻辑（浏览器 + Node 测试双端可用）：四级树、位置路径、统计聚合、分区建议规则
// 从 server/lib.js、server/routes/stats.js、server/services/suggester.js 移植，保持行为一致。
// 云端模式下这些计算在浏览器内完成（数据经 PostgREST + RLS 按 owner 隔离读取）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TidyShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 日期工具（本地时区） ----
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  // 兼容 SQLite 'YYYY-MM-DD HH:MM:SS' 与 PG ISO 串的日期部分提取
  function dayOf(ts) { return String(ts || '').slice(0, 10); }

  // ---- 排序号：当前最大 sort + 1 ----
  function nextSortOf(rows) {
    let max = 0;
    for (const r of rows || []) if (Number(r.sort) > max) max = Number(r.sort);
    return max + 1;
  }

  // ---- 位置路径：区域 › 柜 › 层 › 箱 ----
  function locationPathFrom(maps, shelfId, boxId) {
    const parts = [];
    if (boxId) {
      const box = maps.boxes.get(Number(boxId));
      if (!box) return parts;
      parts.push(box.name);
      shelfId = box.shelf_id;
    }
    if (shelfId) {
      const shelf = maps.shelves.get(Number(shelfId));
      if (shelf) {
        parts.unshift(shelf.name);
        const cab = maps.cabinets.get(Number(shelf.cabinet_id));
        if (cab) {
          parts.unshift(cab.name);
          const zone = maps.zones.get(Number(cab.zone_id));
          if (zone) parts.unshift(zone.name);
        }
      }
    }
    return parts;
  }
  function buildMaps(_ref) {
    const zones = _ref.zones, cabinets = _ref.cabinets, shelves = _ref.shelves, boxes = _ref.boxes;
    const M = (arr) => new Map((arr || []).map((r) => [Number(r.id), r]));
    return { zones: M(zones), cabinets: M(cabinets), shelves: M(shelves), boxes: M(boxes) };
  }

  // ---- 四级树（移植 lib.getTree；placements 需已联接 item_name / img） ----
  function buildTree(_ref) {
    const zones = _ref.zones, cabinets = _ref.cabinets, shelves = _ref.shelves, boxes = _ref.boxes;
    const placements = _ref.placements || [];
    const sortKey = (a, b) => (Number(a.sort) - Number(b.sort)) || (Number(a.id) - Number(b.id));
    const zonesSorted = [...(zones || [])].sort(sortKey);
    const cabinetsSorted = [...(cabinets || [])].sort(sortKey);
    const shelvesSorted = [...(shelves || [])].sort(sortKey);
    const boxesSorted = [...(boxes || [])].sort(sortKey);

    const boxesBy = new Map(); boxesSorted.forEach((b) => boxesBy.set(Number(b.id), { ...b, items: [] }));
    const shelvesBy = new Map(); shelvesSorted.forEach((s) => shelvesBy.set(Number(s.id), { ...s, boxes: [], items: [] }));
    const cabinetsBy = new Map(); cabinetsSorted.forEach((c) => cabinetsBy.set(Number(c.id), { ...c, shelves: [] }));

    const stateOf = (list) => {
      const active = list.some((p) => Number(p.qty) > 0);
      const any = list.length > 0;
      return active ? 'full' : (any ? 'part' : 'empty');
    };

    for (const p of placements) {
      if (p.box_id && boxesBy.has(Number(p.box_id))) boxesBy.get(Number(p.box_id)).items.push(p);
      else if (p.shelf_id && shelvesBy.has(Number(p.shelf_id))) shelvesBy.get(Number(p.shelf_id)).items.push(p);
    }
    for (const b of boxesBy.values()) {
      const s = shelvesBy.get(Number(b.shelf_id));
      if (s) s.boxes.push(b);
    }
    for (const s of shelvesBy.values()) {
      s.state = stateOf([...s.items, ...s.boxes.flatMap((b) => b.items)]);
      const c = cabinetsBy.get(Number(s.cabinet_id));
      if (c) c.shelves.push(s);
    }
    const zonesOut = zonesSorted.map((z) => ({ ...z, floors: [] }));
    const zonesById = new Map(zonesOut.map((z) => [Number(z.id), z]));
    for (const c of cabinetsBy.values()) {
      const filled = c.shelves.filter((s) => s.state === 'full').length;
      c.occupancy = c.shelves.length ? Math.round((filled / c.shelves.length) * 100) : 0;
      const z = zonesById.get(Number(c.zone_id));
      if (z) {
        let fl = z.floors.find((f) => f.floor === (Number(c.floor) || 1));
        if (!fl) { fl = { floor: Number(c.floor) || 1, cabinets: [] }; z.floors.push(fl); }
        fl.cabinets.push(c);
      }
    }
    for (const z of zonesOut) z.floors.sort((a, b) => a.floor - b.floor);
    return zonesOut;
  }

  // ---- 子树下所有 shelf/box id（删除前库存检查） ----
  function subtreeContainerIds(_ref, ent, id) {
    const cabinets = _ref.cabinets || [], shelves = _ref.shelves || [], boxes = _ref.boxes || [];
    const shelfIds = [], boxIds = [];
    const addCabinet = (cabId) => {
      for (const s of shelves) if (Number(s.cabinet_id) === Number(cabId)) {
        shelfIds.push(Number(s.id));
        for (const b of boxes) if (Number(b.shelf_id) === Number(s.id)) boxIds.push(Number(b.id));
      }
    };
    if (ent === 'zones') {
      for (const c of cabinets) if (Number(c.zone_id) === Number(id)) addCabinet(c.id);
    } else if (ent === 'cabinets') {
      addCabinet(id);
    } else if (ent === 'shelves') {
      shelfIds.push(Number(id));
      for (const b of boxes) if (Number(b.shelf_id) === Number(id)) boxIds.push(Number(b.id));
    } else if (ent === 'boxes') {
      boxIds.push(Number(id));
    }
    return { shelfIds, boxIds };
  }
  function countInventory(placements, _ref2) {
    const shelfIds = _ref2.shelfIds, boxIds = _ref2.boxIds;
    const has = (ids, v) => ids.indexOf(Number(v)) !== -1;
    return (placements || []).filter((p) => Number(p.qty) > 0 &&
      ((p.shelf_id && has(shelfIds, p.shelf_id)) || (p.box_id && has(boxIds, p.box_id)))).length;
  }

  // ---- 首页/看板视图（移植 stats.js 的 shelfView / zoneView / categoryDistOf） ----
  function shelfView(s) {
    const items = [];
    for (const p of s.items) {
      if (Number(p.qty) > 0) items.push({ id: p.item_id, placementId: p.id, name: p.item_name, qty: Number(p.qty), img: p.img, box: null, boxId: null });
    }
    for (const b of s.boxes || []) {
      for (const p of b.items) {
        if (Number(p.qty) > 0) items.push({ id: p.item_id, placementId: p.id, name: p.item_name, qty: Number(p.qty), img: p.img, box: b.name, boxId: b.id });
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
        id: c.id, name: c.name, door: c.door, floor: Number(c.floor) || 1, occupancy: c.occupancy,
        shelves: c.shelves.map(shelfView),
      })),
    };
  }
  function categoryDistOf(items, placements, categories) {
    const catName = new Map((categories || []).map((c) => [Number(c.id), c.name]));
    const qtyByItem = new Map();
    for (const p of placements || []) {
      if (Number(p.qty) > 0) qtyByItem.set(Number(p.item_id), (qtyByItem.get(Number(p.item_id)) || 0) + Number(p.qty));
    }
    const groups = new Map();
    for (const it of items || []) {
      const name = catName.get(Number(it.category_id)) || '未分类';
      if (!groups.has(name)) groups.set(name, { name, kinds: 0, qty: 0 });
      const g = groups.get(name);
      g.kinds += 1;
      g.qty += qtyByItem.get(Number(it.id)) || 0;
    }
    return [...groups.values()].sort((a, b) => b.qty - a.qty || b.kinds - a.kinds || (a.name < b.name ? -1 : 1));
  }

  // ---- 智能分区建议（移植 suggester.js 规则引擎） ----
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
  function suggestLocation(_ref3, category) {
    const shelves = _ref3.shelves || [], boxes = _ref3.boxes || [];
    const placements = _ref3.placements || [], items = _ref3.items || [];
    const containers = [];
    for (const s of shelves) containers.push({ shelfId: Number(s.id), boxId: null, name: s.name });
    for (const b of boxes) containers.push({ shelfId: Number(b.shelf_id), boxId: Number(b.id), name: b.name });
    if (!containers.length) {
      return { shelfId: null, boxId: null, path: [], reason: '还没有任何柜子，请先到「收纳空间」创建柜体，或使用 AI 对话生成。' };
    }
    const categories = _ref3.categories || [];
    const cat = (categories || []).find((c) => c.name === category);
    const catById = new Map((items || []).map((i) => [Number(i.id), Number(i.category_id)]));
    const hints = CATEGORY_HINTS[category] || [];
    const usageOf = (c) => (placements || []).reduce((n, p) =>
      n + ((c.boxId ? Number(p.box_id) === c.boxId : Number(p.shelf_id) === c.shelfId) ? Number(p.qty) : 0), 0);
    const sameCategoryNearby = (c) => {
      if (!cat) return false;
      return (placements || []).some((p) =>
        (c.boxId ? Number(p.box_id) === c.boxId : Number(p.shelf_id) === c.shelfId) &&
        catById.get(Number(p.item_id)) === Number(cat.id));
    };
    const scored = containers.map((c) => {
      let score = 0;
      const reasons = [];
      if (cat && sameCategoryNearby(c)) { score += 5; reasons.push('该位置已有同类物品的存放记录'); }
      if (hints.some((h) => c.name.includes(h))) { score += 3; reasons.push('容器名与「' + category + '」匹配'); }
      const u = usageOf(c);
      if (u < 10) { score += 2; reasons.push('剩余空间充足'); }
      else if (u < 30) score += 1;
      else score -= 1;
      return { c, score, reasons };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const reason = best.reasons.length
      ? '理由：' + [...new Set(best.reasons)].slice(0, 2).join('；') + '。'
      : '理由：当前占用最低的可用格位。';
    return { shelfId: best.c.shelfId, boxId: best.c.boxId, reason };
  }

  return {
    pad, dateStr, todayStr, dayOf,
    nextSortOf, buildMaps, locationPathFrom,
    buildTree, subtreeContainerIds, countInventory,
    shelfView, zoneView, categoryDistOf, suggestLocation,
  };
});
