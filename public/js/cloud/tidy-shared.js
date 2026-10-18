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
  // items 必须完整返回：早期版本在这里 slice(0,8)，导致一格里超过 8 件物品时
  // 总览永远只能看到前 8 件（"部分物品显示不出来"）。
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
      items,
      more: 0,
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

  // ---- 排序：把 id 移到同层相邻位置，返回新的 id 顺序（纯函数，前端/后端共用语义） ----
  // 入参 order 是当前同级列表的 id 数组；返回调整后的数组。越界时原样返回。
  function moveInOrder(order, id, dir) {
    const list = (order || []).map(Number);
    const i = list.indexOf(Number(id));
    if (i < 0) return list;
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return list;
    const next = list.slice();
    next[i] = list[j];
    next[j] = list[i];
    return next;
  }
  // 把 id 插到指定下标（0-based）；用于"新建时指定顺序"
  function insertAtOrder(order, id, index) {
    const list = (order || []).map(Number).filter((x) => x !== Number(id));
    const i = Math.max(0, Math.min(list.length, Number(index) || 0));
    list.splice(i, 0, Number(id));
    return list;
  }

  // ---- 搜索匹配（本地服务端 / 云端浏览器共用同一套打分，保证两端结果一致） ----
  // 修复点：早期实现只做 name.includes(q)，多词、别名、备注、类别都搜不到；
  // 且类别筛选按 id 比较、下拉却传类别名，导致一选类别就零结果。
  function parseAliases(v) {
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    if (typeof v !== 'string' || !v) return [];
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a.map((x) => String(x)).filter(Boolean) : [];
    } catch { return []; }
  }
  function normText(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，,、;；·・_\-/]+/g, '');
  }
  function splitTokens(q) {
    return String(q || '').toLowerCase()
      .split(/[\s\u3000,，、;；]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  // 子序列匹配：「万用」能命中「数字万用表」，但「用万」不行（保序）
  function isSubsequence(hay, needle) {
    if (!needle) return false;
    let i = 0;
    for (let k = 0; k < hay.length && i < needle.length; k++) if (hay[k] === needle[i]) i++;
    return i === needle.length;
  }

  // 单条物品的匹配分；0 表示不命中
  function scoreItem(item, tokens, wholeQuery) {
    const name = normText(item.name);
    const cat = normText(item.category);
    const note = normText(item.note);
    const aliases = parseAliases(item.aliases).map(normText).filter(Boolean);
    let total = 0;
    for (const raw of tokens) {
      const tk = normText(raw);
      if (!tk) continue;
      let best = 0;
      if (name === tk) best = 120;
      else if (name.indexOf(tk) === 0) best = 100;
      else if (name.indexOf(tk) >= 0) best = 80;
      else if (aliases.some((a) => a === tk)) best = 75;
      else if (aliases.some((a) => a.indexOf(tk) >= 0)) best = 60;
      else if (cat.indexOf(tk) >= 0) best = 40;
      else if (note.indexOf(tk) >= 0) best = 25;
      else if (tk.length >= 2 && isSubsequence(name, tk)) best = 18;
      if (!best) return 0;          // 多个词是「且」关系：任一 token 落空即不命中
      total += best;
    }
    if (wholeQuery && name === normText(wholeQuery)) total += 40;
    return total;
  }

  // 返回按匹配度降序的 { item, score } 列表
  function matchItems(items, query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const tokens = splitTokens(q);
    if (!tokens.length) return [];
    const out = [];
    for (const it of items || []) {
      const score = scoreItem(it, tokens, q);
      if (score > 0) out.push({ item: it, score });
    }
    out.sort((a, b) => b.score - a.score || Number(b.item.totalQty || 0) - Number(a.item.totalQty || 0) || Number(a.item.id) - Number(b.item.id));
    return out;
  }

  // 类别筛选：同时接受类别 id 与类别名（修复"选类别必零结果"）
  function categoryMatches(item, categoryId, categoryName) {
    if (!categoryId) return true;
    const want = String(categoryId).trim();
    if (item.category_id != null && Number(item.category_id) === Number(want)) return true;
    if (categoryName && normText(item.category) === normText(categoryName)) return true;
    return false;
  }

  // ---- 入库名称查重（本地服务端 / 云端浏览器共用，保证两端判定一致） ----
  // 背景：入库时名称完全由用户手填，同一件实物很容易被写成「十字螺丝刀」「十字螺丝刀(小)」
  // 「十字 螺丝刀」等多个名字，最后库里散成一堆"不同物品"。这里给出一个稳定的归一化
  // 键 + 相似度，供入库前提示"库里已有相近物品，是否合并"。
  function nameKey(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s\u3000]+/g, '')                       // 空格（含全角）
      .replace(/[()（）\[\]【】「」『』《》<>]/g, '')      // 各种括号本身
      .replace(/[，,。.、;；:：!！?？'"“”‘’·・_\-—–~～|\\/*+#@&]/g, ''); // 标点/符号
  }
  // 编辑距离（名字都很短，直接 O(n*m) 就够）
  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }
  // 0~1 相似度：完全相同 1；一方包含另一方（≥2 字）至少 0.82；其余按编辑距离比例
  function nameSim(a, b) {
    const A = nameKey(a), B = nameKey(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    const sim = 1 - editDistance(A, B) / Math.max(A.length, B.length);
    if (A.length >= 2 && B.length >= 2 && (A.indexOf(B) >= 0 || B.indexOf(A) >= 0)) {
      return Math.max(sim, 0.82);
    }
    return sim;
  }
  // 在已有物品里找「刚输入的名字」的重复项。
  // 返回 [{ item, score, reason }]，reason: exact（完全同名）/ alias（命中别名）
  //        / contain（互相包含）/ similar（写法接近）
  function findNameMatches(name, items, opts) {
    const o = opts || {};
    const key = nameKey(name);
    if (!key) return [];
    const min = typeof o.min === 'number' ? o.min : 0.62;
    const excludeId = o.excludeId != null && o.excludeId !== '' ? Number(o.excludeId) : null;
    const out = [];
    for (const it of items || []) {
      if (!it) continue;
      if (excludeId != null && Number(it.id) === excludeId) continue;
      const nk = nameKey(it.name);
      if (!nk) continue;
      const al = parseAliases(it.aliases).map(nameKey).filter(Boolean);
      let score = 0;
      let reason = '';
      if (nk === key) { score = 1; reason = 'exact'; }
      else if (al.indexOf(key) >= 0) { score = 0.95; reason = 'alias'; }
      else {
        const s = nameSim(key, nk);
        if (s >= min) {
          score = s;
          reason = (key.indexOf(nk) >= 0 || nk.indexOf(key) >= 0) ? 'contain' : 'similar';
        } else {
          // 与某个别名非常接近（例如旧名「万用表」被记为别名，新输入「万用表计」）
          let best = 0;
          for (const a of al) best = Math.max(best, nameSim(key, a));
          if (best >= 0.8) { score = best * 0.9; reason = 'alias'; }
        }
      }
      if (score > 0) out.push({ item: it, score: Math.round(score * 1000) / 1000, reason });
    }
    out.sort((x, y) => y.score - x.score
      || Number(y.item.totalQty || 0) - Number(x.item.totalQty || 0)
      || Number(x.item.id) - Number(y.item.id));
    return out.slice(0, o.limit || 5);
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
    moveInOrder, insertAtOrder,
    parseAliases, normText, splitTokens, scoreItem, matchItems, categoryMatches,
    nameKey, nameSim, editDistance, findNameMatches,
  };
});
