// 云端模式 API 适配器：把前端 window.api(method, path, body) 的 REST 契约
// 翻译为 WorkBuddy 云数据面调用（PostgREST + Storage），AI/设置端点代理回 Express。
// 身份隔离由云端 RLS（owner_id = auth.uid()）保证：客户端永不发送 owner_id。
// UMD：浏览器挂 window.CloudApi，Node 测试直接 require。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CloudApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const T = (typeof TidyShared !== 'undefined') ? TidyShared : require('./tidy-shared.js');
  const DOORS = ['double', 'single', 'drawer'];
  const ENT = {
    zones: { table: 'zones', parent: null, label: '区域' },
    cabinets: { table: 'cabinets', parent: 'zone_id', label: '柜子' },
    shelves: { table: 'shelves', parent: 'cabinet_id', label: '层/抽屉' },
    boxes: { table: 'boxes', parent: 'shelf_id', label: '箱子' },
  };
  const SIGN_TTL = 3600; // 签名图 URL 有效期（秒）

  function fileExt(nameOrType, fallback) {
    const m = /\.([a-z0-9]+)$/i.exec(String(nameOrType || ''));
    if (m) return '.' + m[1].toLowerCase();
    const t = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[nameOrType];
    return t || fallback || '.jpg';
  }
  function rand6() { return Math.random().toString(36).slice(2, 8); }
  function parseAliases(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }

  function createCloudApi(opts) {
    const cloud = opts.cloud;               // WorkBuddy SDK client
    const uid = String(opts.uid);           // 登录用户 id（storage 路径用）
    const serverFetch = opts.serverFetch;   // (method, path, body) → data；AI/设置代理
    const readFileBase64 = opts.readFileBase64; // 可注入（Node 测试）；浏览器默认 FileReader
    const db = cloud.database;
    const store = cloud.storage.from('runtime');

    // ---- 签名图 URL 缓存（key → {url, exp}） ----
    const imgCache = new Map();

    async function signedUrl(key) {
      if (!key) return '';
      if (/^https?:\/\//.test(key)) return key;
      const hit = imgCache.get(key);
      if (hit && hit.exp > Date.now()) return hit.url;
      const { data, error } = await store.createSignedUrls([key], SIGN_TTL);
      if (error || !data || !data[0] || !data[0].signedUrl) return '';
      imgCache.set(key, { url: data[0].signedUrl, exp: Date.now() + (SIGN_TTL - 60) * 1000 });
      return data[0].signedUrl;
    }

    // ---- unwrap：{data,error} → data 或 throw（async：SDK 查询是 thenable） ----
    async function unwrap(res, label) {
      const r = await res;
      if (r && r.error) {
        const e = new Error((r.error && r.error.message) || '云端数据操作失败' + (label ? '：' + label : ''));
        if (r.error && /42501|row-level/.test(String(r.error.message || ''))) e.status = 403;
        throw e;
      }
      return r ? r.data : null;
    }
    function must(row, label) {
      if (!row) { const e = new Error(label + '不存在'); e.status = 404; throw e; }
      return row;
    }
    function fail(status, msg) { const e = new Error(msg); e.status = status; throw e; }

    // ---- 上下文加载：业务表并行拉取（RLS 已按 owner 过滤） ----
    async function loadContext() {
      const [zones, cabinets, shelves, boxes, categories, items, placements, images] = await Promise.all([
        unwrap(db.from('zones').select('*')),
        unwrap(db.from('cabinets').select('*')),
        unwrap(db.from('shelves').select('*')),
        unwrap(db.from('boxes').select('*')),
        unwrap(db.from('categories').select('*')),
        unwrap(db.from('items').select('*')),
        unwrap(db.from('placements').select('*')),
        unwrap(db.from('item_images').select('*')),
      ]);
      const maps = T.buildMaps({ zones, cabinets, shelves, boxes });
      const mainImg = new Map();
      for (const im of images) {
        const k = Number(im.item_id);
        const cur = mainImg.get(k);
        if (!cur || (Number(im.is_main) === 1 && Number(cur.is_main) !== 1) ||
          (Number(im.is_main) === Number(cur.is_main) && Number(im.id) > Number(cur.id))) mainImg.set(k, im);
      }
      const placementsFull = placements.map((p) => ({
        ...p, item_name: (items.find((i) => Number(i.id) === Number(p.item_id)) || {}).name || '',
        img: (mainImg.get(Number(p.item_id)) || {}).file || null,
      }));
      return {
        zones, cabinets, shelves, boxes, categories, items, placements, images, maps, mainImg,
        tree: T.buildTree({ zones, cabinets, shelves, boxes, placements: placementsFull }),
        placementsFull,
        pathOf: (shelfId, boxId) => T.locationPathFrom(maps, shelfId, boxId),
        addLog: (log) => unwrap(db.from('logs').insert({
          item_id: log.itemId || null, action: log.action, qty: log.qty || 0,
          location: log.location || '', detail: log.detail || '',
        })),
      };
    }

    // ---- 通用结构 CRUD ----
    async function entCreate(entKey, b) {
      const ent = ENT[entKey];
      if (!ent) fail(404, '未知实体');
      b = b || {};
      const ctx = await loadContext();
      let parentId = null;
      if (ent.parent) {
        parentId = Number(b.parentId);
        if (!parentId) fail(400, '缺少父级 parentId');
        const parentTable = { zone_id: 'zones', cabinet_id: 'cabinets', shelf_id: 'shelves' }[ent.parent];
        must((ctx[parentTable] || []).find((r) => Number(r.id) === parentId), '父级');
      }
      if (entKey === 'cabinets' && !DOORS.includes(b.door)) fail(400, '门型必须是 double/single/drawer');
      if (entKey === 'shelves' && b.kind && !['shelf', 'drawer'].includes(b.kind)) fail(400, '类型必须是 shelf/drawer');
      const name = String(b.name || '').trim();
      if (!name) fail(400, '名称不能为空');
      const parentRows = !ent.parent ? ctx[ent.table]
        : ctx[ent.table].filter((r) => Number(r[ent.parent]) === parentId);
      const sort = T.nextSortOf(parentRows);
      let row;
      if (entKey === 'zones') {
        row = (await unwrap(db.from('zones').insert({ name, sort }).select()))[0];
      } else if (entKey === 'cabinets') {
        row = (await unwrap(db.from('cabinets').insert({
          zone_id: parentId, name, door: b.door || 'single', floor: Math.max(1, Number(b.floor) || 1), sort,
        }).select()))[0];
        await unwrap(db.from('shelves').insert({
          cabinet_id: Number(row.id),
          name: (b.door || 'single') === 'drawer' ? '抽屉1' : '第1层',
          kind: (b.door || 'single') === 'drawer' ? 'drawer' : 'shelf', sort: 1,
        }));
      } else if (entKey === 'shelves') {
        row = (await unwrap(db.from('shelves').insert({
          cabinet_id: parentId, name, kind: b.kind === 'drawer' ? 'drawer' : 'shelf', sort,
        }).select()))[0];
      } else {
        row = (await unwrap(db.from('boxes').insert({
          shelf_id: parentId, name, color: b.color || null, sort,
        }).select()))[0];
      }
      await ctx.addLog({ action: 'structure', location: name, detail: '新建' + ent.label });
      return { id: Number(row.id), tree: (await loadContext()).tree };
    }

    async function entPatch(entKey, id, b) {
      const ent = ENT[entKey];
      if (!ent) fail(404, '未知实体');
      b = b || {};
      let ctx = await loadContext();
      must(ctx[ent.table].find((r) => Number(r.id) === Number(id)), ent.label);
      const patch = {};
      if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) fail(400, '名称不能为空'); patch.name = n; }
      if (entKey === 'cabinets' && b.door !== undefined) {
        if (!DOORS.includes(b.door)) fail(400, '门型不合法');
        patch.door = b.door;
      }
      if (entKey === 'cabinets' && b.floor !== undefined) patch.floor = Math.max(1, Number(b.floor) || 1);
      if (entKey === 'shelves' && b.kind !== undefined) {
        if (!['shelf', 'drawer'].includes(b.kind)) fail(400, '类型不合法');
        patch.kind = b.kind;
      }
      if (entKey === 'boxes' && b.color !== undefined) patch.color = b.color;
      if (b.sort !== undefined) patch.sort = Number(b.sort) || 0;
      if (!Object.keys(patch).length) fail(400, '没有可更新字段');
      await unwrap(db.from(ent.table).update(patch).eq('id', Number(id)));
      await ctx.addLog({ action: 'structure', detail: '修改' + ent.label });
      return { tree: (await loadContext()).tree };
    }

    async function entDelete(entKey, id) {
      const ent = ENT[entKey];
      if (!ent) fail(404, '未知实体');
      const ctx = await loadContext();
      const row = must(ctx[ent.table].find((r) => Number(r.id) === Number(id)), ent.label);
      const ids = T.subtreeContainerIds({ cabinets: ctx.cabinets, shelves: ctx.shelves, boxes: ctx.boxes }, entKey, id);
      const inv = T.countInventory(ctx.placements, ids);
      if (inv > 0) fail(400, '该' + ent.label + '下还有 ' + inv + ' 条库存记录，请先取出或移走物品');
      await unwrap(db.from(ent.table).delete().eq('id', Number(row.id)));
      await ctx.addLog({ action: 'structure', detail: '删除' + ent.label });
      return { tree: (await loadContext()).tree };
    }

    // ---- 柜子实拍照片 ----
    async function cabPhoto(id, formData) {
      const ctx = await loadContext();
      const cab = must(ctx.cabinets.find((r) => Number(r.id) === Number(id)), '柜子');
      const file = formData && formData.get && formData.get('image');
      if (!file) fail(400, '请上传图片（字段名 image）');
      const ext = fileExt(file.name || file.type, '.jpg');
      const key = cloud.storage.userPath(uid, 'cabinets/' + id + '/cab-' + Date.now() + '-' + rand6() + ext);
      await store.upload(key, file, { contentType: file.type || 'image/jpeg' });
      const old = cab.photo;
      await unwrap(db.from('cabinets').update({ photo: key }).eq('id', Number(id)));
      if (old && old !== key && /^users\//.test(old)) { try { await store.remove([old]); } catch { /* 旧图清理失败忽略 */ } }
      await ctx.addLog({ action: 'structure', location: cab.name, detail: '更新柜子实拍照片' });
      return { photo: key, tree: (await loadContext()).tree };
    }
    async function cabPhotoDelete(id) {
      const ctx = await loadContext();
      const cab = must(ctx.cabinets.find((r) => Number(r.id) === Number(id)), '柜子');
      if (cab.photo && /^users\//.test(cab.photo)) { try { await store.remove([cab.photo]); } catch { /* 忽略 */ } }
      await unwrap(db.from('cabinets').update({ photo: null }).eq('id', Number(id)));
      await ctx.addLog({ action: 'structure', location: cab.name, detail: '删除柜子实拍照片' });
      return { tree: (await loadContext()).tree };
    }

    // ---- 识别入库 ----
    function fileToBase64(file) {
      if (readFileBase64) return Promise.resolve(readFileBase64(file));
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).replace(/^data:[^;]+;base64,/, ''));
        fr.onerror = () => reject(new Error('读取图片失败'));
        fr.readAsDataURL(file);
      });
    }

    async function intakeAnalyze(formData) {
      const file = formData && formData.get && formData.get('image');
      if (!file) fail(400, '请上传图片（字段名 image）');
      const mode = formData.get('mode') === 'batch' ? 'batch' : 'single';
      const ext = fileExt(file.name || file.type, '.jpg');
      const key = cloud.storage.userPath(uid, 'intake/' + Date.now() + '-' + rand6() + ext);
      await store.upload(key, file, { contentType: file.type || 'image/jpeg' });
      const imageBase64 = await fileToBase64(file);
      const ai = await serverFetch('POST', '/intake/analyze-json', { mode, imageBase64, mime: file.type || 'image/jpeg' });
      const rec = ai.rec || ai;
      const ctx = await loadContext();
      (rec.items || []).forEach((it) => {
        const sug = T.suggestLocation(ctx, it.category);
        it.suggestion = { ...sug, path: ctx.pathOf(sug.shelfId, sug.boxId) };
        it.webImages = [];
      });
      const payload = { mode, file: key, mime: file.type || 'image/jpeg', previewUrl: null, rec };
      const row = (await unwrap(db.from('intake_queue').insert({ payload: JSON.stringify(payload) }).select()))[0];
      return { id: Number(row.id), ...payload, previewUrl: await signedUrl(key) };
    }

    async function intakeQueue() {
      const rows = await unwrap(db.from('intake_queue').select('*').eq('status', 'pending').order('id', { ascending: false }));
      const out = [];
      for (const r of rows) {
        let p = {};
        try { p = JSON.parse(r.payload); } catch { /* 容错 */ }
        out.push({ id: Number(r.id), created_at: r.created_at, ...p, previewUrl: p.file ? await signedUrl(p.file) : '' });
      }
      return out;
    }

    async function intakeDismiss(b) {
      const id = Number((b || {}).id);
      const row = await unwrap(db.from('intake_queue').select('*').eq('id', id).maybeSingle());
      must(row, '队列项');
      await unwrap(db.from('intake_queue').update({ status: 'dismissed' }).eq('id', id));
      try {
        const p = JSON.parse(row.payload || '{}');
        if (p.file && /^users\//.test(p.file)) await store.remove([p.file]);
      } catch { /* 清理失败忽略 */ }
      return {};
    }

    async function intakeConfirm(b) {
      b = b || {};
      const qRow = await unwrap(db.from('intake_queue').select('*').eq('id', Number(b.queueId)).maybeSingle());
      must(qRow, '队列项');
      const payload = JSON.parse(qRow.payload || '{}');
      const item = (payload.rec && payload.rec.items || [])[Number(b.index) || 0];
      if (!item) fail(400, '队列项中没有该物品');
      const name = String(b.name || item.name || '').trim();
      if (!name) fail(400, '物品名称不能为空');
      const qty = Math.max(0, Number(b.qty !== undefined ? b.qty : (item.qty !== undefined ? item.qty : 1)));
      const shelfId = b.shelfId ? Number(b.shelfId) : null;
      const boxId = b.boxId ? Number(b.boxId) : null;
      if (!shelfId && !boxId) fail(400, '请选择存放位置（层或箱子）');
      if (boxId) must((await unwrap(db.from('boxes').select('*').eq('id', boxId).maybeSingle())), '箱子');
      if (shelfId) must((await unwrap(db.from('shelves').select('*').eq('id', shelfId).maybeSingle())), '层');

      const categories = await unwrap(db.from('categories').select('*'));
      const wantCat = String(b.category || item.category || '其他');
      const cat = categories.find((c) => c.name === wantCat) || categories.find((c) => c.name === '其他');

      const existing = await unwrap(db.from('items').select('id').eq('name', name).maybeSingle());
      let itemId;
      const merged = !!existing;
      if (existing) itemId = Number(existing.id);
      else {
        const ins = (await unwrap(db.from('items').insert({
          name,
          aliases: JSON.stringify(b.aliases || item.aliases || []),
          category_id: cat ? Number(cat.id) : null,
          size_class: ['S', 'M', 'L'].includes(b.size) ? b.size : (item.size || 'S'),
          note: b.note || null,
        }).select()))[0];
        itemId = Number(ins.id);
      }

      // 图片：识别原图从 intake/ 移入 items/<id>/，作为实物主图
      if (payload.file && /^users\//.test(payload.file)) {
        await unwrap(db.from('item_images').update({ is_main: 0 }).eq('item_id', itemId));
        const ext = fileExt(payload.mime || payload.file, '.jpg');
        const newKey = cloud.storage.userPath(uid, 'items/' + itemId + '/photo-' + Date.now() + '-' + rand6() + ext);
        try { await store.move(payload.file, newKey); } catch { /* 已移动/不存在则直接引用新键 */ }
        await unwrap(db.from('item_images').insert({ item_id: itemId, file: newKey, source: 'user', is_main: 1 }));
      }

      // 同容器已有存放记录 → 累加；否则新建
      let q = db.from('placements').select('*').eq('item_id', itemId);
      q = shelfId === null ? q.is('shelf_id', null) : q.eq('shelf_id', shelfId);
      q = boxId === null ? q.is('box_id', null) : q.eq('box_id', boxId);
      const sameLoc = await unwrap(q.maybeSingle());
      if (sameLoc) {
        await unwrap(db.from('placements').update({ qty: Number(sameLoc.qty) + qty, updated_at: new Date().toISOString() }).eq('id', Number(sameLoc.id)));
      } else {
        await unwrap(db.from('placements').insert({ item_id: itemId, shelf_id: shelfId, box_id: boxId, qty }));
      }
      const ctx = await loadContext();
      const loc = ctx.pathOf(shelfId, boxId).join(' › ');
      await ctx.addLog({
        itemId, action: 'in', qty, location: loc,
        detail: '识别入库（置信度 ' + Math.round(Number(item.confidence || 0) * 100) + '%）',
      });
      await unwrap(db.from('intake_queue').update({ status: 'done' }).eq('id', Number(qRow.id)));
      return { itemId, merged, location: loc, qty };
    }

    async function itemOut(id, b) {
      b = b || {};
      const p = await unwrap(db.from('placements').select('*').eq('id', Number(b.placementId)).eq('item_id', Number(id)).maybeSingle());
      if (!p) fail(404, '找不到该存放记录');
      const all = b.all === true || b.all === 'true';
      const qty = all ? Number(p.qty) : Math.max(0, Number(b.qty) || 0);
      if (qty <= 0) fail(400, '取出数量必须大于 0');
      if (qty > Number(p.qty)) fail(400, '取出数量超过库存（当前 ' + p.qty + '）');
      const remain = Number(p.qty) - qty;
      await unwrap(db.from('placements').update({ qty: remain, updated_at: new Date().toISOString() }).eq('id', Number(p.id)));
      const ctx = await loadContext();
      const loc = ctx.pathOf(p.shelf_id, p.box_id).join(' › ');
      await ctx.addLog({ itemId: Number(id), action: 'out', qty, location: loc, detail: remain === 0 ? '已取空' : '剩余 ' + remain });
      return { remain, emptied: remain === 0, location: loc };
    }

    async function itemMove(id, b) {
      b = b || {};
      const p = await unwrap(db.from('placements').select('*').eq('id', Number(b.placementId)).eq('item_id', Number(id)).maybeSingle());
      if (!p) fail(404, '找不到该存放记录');
      const shelfId = b.shelfId ? Number(b.shelfId) : null;
      const boxId = b.boxId ? Number(b.boxId) : null;
      if (!shelfId && !boxId) fail(400, '请选择目标位置');
      if (boxId) must((await unwrap(db.from('boxes').select('*').eq('id', boxId).maybeSingle())), '箱子');
      if (shelfId) must((await unwrap(db.from('shelves').select('*').eq('id', shelfId).maybeSingle())), '层');
      await unwrap(db.from('placements').update({ shelf_id: shelfId, box_id: boxId, updated_at: new Date().toISOString() }).eq('id', Number(p.id)));
      const ctx = await loadContext();
      const loc = ctx.pathOf(shelfId, boxId).join(' › ');
      await ctx.addLog({ itemId: Number(id), action: 'move', qty: Number(p.qty), location: loc, detail: '移位' });
      return { location: loc };
    }

    async function itemPatch(id, b) {
      b = b || {};
      const ctx0 = await loadContext();
      const item = must(ctx0.items.find((r) => Number(r.id) === Number(id)), '物品');
      const name = b.name === undefined ? item.name : String(b.name).trim();
      if (!name) fail(400, '物品名称不能为空');
      if (name !== item.name) {
        const dup = ctx0.items.find((r) => r.name === name && Number(r.id) !== Number(id));
        if (dup) fail(409, '已存在同名物品「' + name + '」，请换一个名称');
      }
      let cat = null;
      if (b.category !== undefined) {
        cat = ctx0.categories.find((c) => c.name === b.category) || ctx0.categories.find((c) => c.name === '其他');
      }
      const aliases = b.aliases === undefined ? item.aliases : JSON.stringify(b.aliases || []);
      const size = ['S', 'M', 'L'].includes(b.size) ? b.size : item.size_class;
      const note = b.note === undefined ? item.note : (b.note || null);
      const catId = cat ? Number(cat.id) : item.category_id;
      await unwrap(db.from('items').update({ name, category_id: catId, aliases, size_class: size, note }).eq('id', Number(id)));
      const changed = [];
      if (name !== item.name) changed.push('名称 ' + item.name + ' → ' + name);
      const oldCat = item.category_id ? ctx0.categories.find((c) => Number(c.id) === Number(item.category_id)) : null;
      if (cat && (!oldCat || oldCat.name !== cat.name)) changed.push('类别 ' + (oldCat ? oldCat.name : '未分类') + ' → ' + cat.name);
      if (b.note !== undefined && note !== item.note) changed.push('备注更新');
      if (changed.length) await ctx0.addLog({ itemId: Number(id), action: 'edit', qty: 0, location: '', detail: '手工修正：' + changed.join('；') });
      const fresh = await unwrap(db.from('items').select('*').eq('id', Number(id)).maybeSingle());
      return { ...fresh, aliases: parseAliases(fresh && fresh.aliases), category: cat ? cat.name : (oldCat ? oldCat.name : '') };
    }

    async function itemDetail(id) {
      const ctx = await loadContext();
      const item = must(ctx.items.find((r) => Number(r.id) === Number(id)), '物品');
      const cat = item.category_id ? ctx.categories.find((c) => Number(c.id) === Number(item.category_id)) : null;
      const images = ctx.images.filter((im) => Number(im.item_id) === Number(id))
        .sort((a, b) => (Number(b.is_main) - Number(a.is_main)) || (Number(a.id) - Number(b.id)));
      const placements = ctx.placements.filter((p) => Number(p.item_id) === Number(id))
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((p) => ({ ...p, path: ctx.pathOf(p.shelf_id, p.box_id).join(' › ') }));
      const logs = (await unwrap(db.from('logs').select('*').eq('item_id', Number(id)).order('id', { ascending: false }).limit(50)));
      return { ...item, aliases: parseAliases(item.aliases), category: cat ? cat.name : '', images, placements, logs };
    }

    async function itemList(query) {
      const ctx = await loadContext();
      let rows = [...ctx.items].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 200).map((i) => {
        const totalQty = ctx.placements.filter((p) => Number(p.item_id) === Number(i.id))
          .reduce((n, p) => n + Number(p.qty), 0);
        const main = ctx.images.filter((im) => Number(im.item_id) === Number(i.id) && Number(im.is_main) === 1)
          .sort((a, b) => Number(a.id) - Number(b.id))[0];
        const cat = i.category_id ? ctx.categories.find((c) => Number(c.id) === Number(i.category_id)) : null;
        return { ...i, aliases: parseAliases(i.aliases), category: cat ? cat.name : '', img: main ? main.file : null, totalQty };
      });
      const q = String(query.get('q') || '').trim().toLowerCase();
      if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) ||
        r.aliases.some((a) => String(a).toLowerCase().includes(q)));
      const cid = query.get('categoryId');
      if (cid) rows = rows.filter((r) => Number(r.category_id) === Number(cid));
      return rows;
    }

    // ---- 搜索 ----
    function matchExact(r, lower) {
      return r.name.toLowerCase().includes(lower) ||
        r.aliases.some((a) => String(a).toLowerCase().includes(lower)) ||
        (r.category || '').toLowerCase().includes(lower);
    }
    async function search(query) {
      const q = String(query.get('q') || '').trim();
      const mode = query.get('mode') === 'semantic' ? 'semantic' : 'exact';
      if (!q) fail(400, '请输入搜索内容');
      const lower = q.toLowerCase();
      const ctx = await loadContext();
      const summaries = [...ctx.items].sort((a, b) => Number(b.id) - Number(a.id)).map((i) => {
        const cat = i.category_id ? ctx.categories.find((c) => Number(c.id) === Number(i.category_id)) : null;
        const main = ctx.mainImg.get(Number(i.id));
        return {
          ...i, aliases: parseAliases(i.aliases), category: cat ? cat.name : '',
          totalQty: ctx.placements.filter((p) => Number(p.item_id) === Number(i.id)).reduce((n, p) => n + Number(p.qty), 0),
          img: main ? main.file : null,
        };
      });
      const withPlacements = (rows) => rows.map((r) => ({
        ...r,
        placements: ctx.placements.filter((p) => Number(p.item_id) === Number(r.id) && Number(p.qty) > 0)
          .sort((a, b) => Number(a.id) - Number(b.id))
          .map((p) => ({ id: Number(p.id), qty: Number(p.qty), path: ctx.pathOf(p.shelf_id, p.box_id).join(' › ') })),
      }));
      let results, usedMode = mode;
      if (mode === 'exact') {
        results = summaries.filter((r) => matchExact(r, lower));
      } else {
        try {
          const ai = await serverFetch('POST', '/ai/semantic-search', {
            query: q,
            candidates: summaries.map((i) => ({ id: Number(i.id), name: i.name, aliases: i.aliases, category: i.category })),
          });
          const byId = new Map(summaries.map((i) => [Number(i.id), i]));
          results = (ai.matches || [])
            .filter((m) => byId.has(Number(m.id)))
            .sort((a, b) => Number(b.score) - Number(a.score))
            .slice(0, 5)
            .map((m) => ({ ...byId.get(Number(m.id)), matchScore: Math.round(Number(m.score) * 100), matchReason: m.reason || '' }));
        } catch (e) {
          results = summaries.filter((r) => matchExact(r, lower)).map((r) => ({ ...r, matchScore: null, matchReason: '' }));
          usedMode = 'exact-fallback';
        }
      }
      const cid = query.get('categoryId');
      if (cid) results = results.filter((r) => Number(r.category_id) === Number(cid));
      const zid = query.get('zoneId');
      if (zid) {
        const zoneShelves = new Set(ctx.shelves.filter((s) => {
          const cab = ctx.cabinets.find((c) => Number(c.id) === Number(s.cabinet_id));
          return cab && Number(cab.zone_id) === Number(zid);
        }).map((s) => Number(s.id)));
        results = results.filter((r) => ctx.placements.some((p) => Number(p.item_id) === Number(r.id) && Number(p.qty) > 0 &&
          ((p.box_id && (() => { const b = ctx.boxes.find((bx) => Number(bx.id) === Number(p.box_id)); return b && zoneShelves.has(Number(b.shelf_id)); })()) ||
            (p.shelf_id && zoneShelves.has(Number(p.shelf_id))))));
      }
      return { mode: usedMode, query: q, results: withPlacements(results) };
    }

    // ---- 统计（首页 / 看板 / 元数据） ----
    async function statsOverview() {
      const ctx = await loadContext();
      const today = T.todayStr();
      const stats = {
        itemCount: ctx.items.length,
        zoneCount: ctx.zones.length,
        cabinetCount: ctx.cabinets.length,
        shelfCount: ctx.shelves.length,
        boxCount: ctx.boxes.length,
        inStock: ctx.placements.reduce((n, p) => n + Number(p.qty), 0),
        todayIn: (await unwrap(db.from('logs').select('*').eq('action', 'in')))
          .filter((l) => T.dayOf(l.created_at) === today).reduce((n, l) => n + Number(l.qty || 0), 0),
      };
      const pendingQueue = (await unwrap(db.from('intake_queue').select('*').eq('status', 'pending').order('id', { ascending: false })))
        .map((r) => {
          let p = {};
          try { p = JSON.parse(r.payload); } catch { /* 容错 */ }
          return { id: Number(r.id), mode: p.mode, names: ((p.rec && p.rec.items) || []).map((i) => i.name).join('、'), created_at: r.created_at };
        });
      const itemName = new Map(ctx.items.map((i) => [Number(i.id), i.name]));
      const todayLogs = (await unwrap(db.from('logs').select('*').order('id', { ascending: false }).limit(200)))
        .filter((l) => ['in', 'out', 'move', 'edit'].includes(l.action) && T.dayOf(l.created_at) === today)
        .slice(0, 20).map((l) => ({ ...l, item_name: itemName.get(Number(l.item_id)) || null }));
      const recent = [...ctx.items].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 8).map((i) => {
        const cat = i.category_id ? ctx.categories.find((c) => Number(c.id) === Number(i.category_id)) : null;
        const main = ctx.mainImg.get(Number(i.id));
        return {
          id: Number(i.id), name: i.name, category: cat ? cat.name : '', img: main ? main.file : null,
          totalQty: ctx.placements.filter((p) => Number(p.item_id) === Number(i.id)).reduce((n, p) => n + Number(p.qty), 0),
        };
      });
      return {
        stats,
        zones: ctx.tree.map(T.zoneView),
        categoryDist: T.categoryDistOf(ctx.items, ctx.placements, ctx.categories),
        todayPlan: { pendingQueue, todayLogs },
        recent,
      };
    }

    async function statsBoard() {
      const ctx = await loadContext();
      const totals = {
        items: ctx.items.length, zones: ctx.zones.length, cabinets: ctx.cabinets.length,
        shelves: ctx.shelves.length, boxes: ctx.boxes.length,
        inStock: ctx.placements.reduce((n, p) => n + Number(p.qty), 0),
      };
      const categoryDist = T.categoryDistOf(ctx.items, ctx.placements, ctx.categories);
      const zoneOccupancy = ctx.tree.map((z) => {
        const v = T.zoneView(z);
        return { name: z.name, cabinets: v.cabinetCount, occupancy: v.occupancy, qty: v.itemQty };
      }).sort((a, b) => b.qty - a.qty);
      const topItems = [...ctx.items].map((i) => {
        const ps = ctx.placements.filter((p) => Number(p.item_id) === Number(i.id));
        const cat = i.category_id ? ctx.categories.find((c) => Number(c.id) === Number(i.category_id)) : null;
        const main = ctx.mainImg.get(Number(i.id));
        return {
          id: Number(i.id), name: i.name, category: cat ? cat.name : '', img: main ? main.file : null,
          qty: ps.reduce((n, p) => n + Number(p.qty), 0),
          spots: ps.filter((p) => Number(p.qty) > 0).length,
        };
      }).sort((a, b) => b.qty - a.qty || Number(b.id) - Number(a.id)).slice(0, 10);
      const trend = [];
      for (let d = 6; d >= 0; d--) {
        const dt = new Date(Date.now() - d * 86400000);
        const ds = T.dateStr(dt);
        trend.push({ date: ds, label: (dt.getMonth() + 1) + '/' + dt.getDate(), inQty: 0, outQty: 0 });
      }
      const allLogs = await unwrap(db.from('logs').select('*').order('id', { ascending: false }).limit(500));
      for (const l of allLogs) {
        const ds = T.dayOf(l.created_at);
        const slot = trend.find((t) => t.date === ds);
        if (slot) {
          if (l.action === 'in') slot.inQty += Number(l.qty || 0);
          if (l.action === 'out') slot.outQty += Number(l.qty || 0);
        }
      }
      const itemName = new Map(ctx.items.map((i) => [Number(i.id), i.name]));
      const recentLogs = allLogs.filter((l) => ['in', 'out', 'move', 'edit'].includes(l.action)).slice(0, 80)
        .map((l) => {
          const main = l.item_id ? ctx.mainImg.get(Number(l.item_id)) : null;
          return { ...l, item_name: itemName.get(Number(l.item_id)) || null, img: main ? main.file : null };
        });
      return { totals, categoryDist, zoneOccupancy, topItems, trend, recentLogs };
    }

    async function statsMeta() {
      const ctx = await loadContext();
      const categories = [...ctx.categories]
        .sort((a, b) => (Number(b.is_preset) - Number(a.is_preset)) || (Number(a.id) - Number(b.id)))
        .map((c) => c.name);
      return { categories, zones: ctx.tree };
    }

    // ---- 结构 AI 生成 + 应用 ----
    async function structureApply(b) {
      b = b || {};
      const zoneName = b.zoneName, floors = b.floors;
      if (!zoneName || !Array.isArray(floors) || !floors.length) fail(400, '结构数据不完整');
      const ctx = await loadContext();
      const zone = (await unwrap(db.from('zones').insert({ name: zoneName, sort: T.nextSortOf(ctx.zones) }).select()))[0];
      for (const f of floors) {
        for (const c of (f.cabinets || [])) {
          const cab = (await unwrap(db.from('cabinets').insert({
            zone_id: Number(zone.id), name: c.name,
            door: DOORS.includes(c.door) ? c.door : 'single',
            floor: Number(f.floor) || 1,
            sort: T.nextSortOf(ctx.cabinets.filter((x) => Number(x.zone_id) === Number(zone.id))),
          }).select()))[0];
          const shelfList = (c.shelves && c.shelves.length) ? c.shelves
            : [{ name: c.door === 'drawer' ? '抽屉1' : '第1层', kind: c.door === 'drawer' ? 'drawer' : 'shelf' }];
          for (const s of shelfList) {
            await unwrap(db.from('shelves').insert({
              cabinet_id: Number(cab.id), name: s.name,
              kind: s.kind === 'drawer' ? 'drawer' : 'shelf', sort: T.nextSortOf(ctx.shelves.filter((x) => Number(x.cabinet_id) === Number(cab.id))),
            }));
          }
        }
      }
      await ctx.addLog({ action: 'structure', location: zoneName, detail: 'AI 生成结构：' + floors.length + ' 层' });
      return { zoneId: Number(zone.id), tree: (await loadContext()).tree };
    }

    // ---- 主分发器 ----
    // 递归收集响应中的云存储 key（users/ 前缀）并批量签名
    async function resolveImages(data) {
      const keys = new Set();
      (function walk(v) {
        if (typeof v === 'string') { if (/^users\//.test(v)) keys.add(v); }
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      })(data);
      const miss = [...keys].filter((k) => {
        const h = imgCache.get(k);
        return !h || h.exp <= Date.now();
      });
      if (!miss.length) return false;
      const res = await store.createSignedUrls(miss, SIGN_TTL);
      if (res.error || !res.data) return false;
      res.data.forEach((d, i) => {
        if (d && d.signedUrl) imgCache.set(miss[i], { url: d.signedUrl, exp: Date.now() + (SIGN_TTL - 60) * 1000 });
      });
      return true;
    }

    return {
      signedUrl,
      imgCache,
      resolveImages,
      api: async function api(method, rawPath, body) {
        const [path, qs] = String(rawPath).split('?');
        const query = new URLSearchParams(qs || '');
        method = String(method).toUpperCase();

        // AI / 设置类：代理回 Express 服务端（Key 在服务端，不下发）
        if (method === 'POST' && path === '/structure/generate') return serverFetch('POST', '/structure/generate', body);
        if (method === 'GET' && path === '/settings') return serverFetch('GET', '/settings');
        if (method === 'PUT' && path === '/settings') return serverFetch('PUT', '/settings', body);
        if (method === 'POST' && path === '/settings/test-ai') return serverFetch('POST', '/settings/test-ai');
        if (method === 'GET' && path === '/system/info') return serverFetch('GET', '/system/info');

        // 结构
        if (method === 'GET' && path === '/structure') return (await loadContext()).tree;
        if (method === 'POST' && path === '/structure/apply') return structureApply(body);
        if (method === 'POST' && /^\/cabinets\/\d+\/photo$/.test(path)) return cabPhoto(path.match(/\d+/)[0], body);
        if (method === 'DELETE' && /^\/cabinets\/\d+\/photo$/.test(path)) return cabPhotoDelete(path.match(/\d+/)[0]);
        const mEnt = path.match(/^\/(zones|cabinets|shelves|boxes)(?:\/(\d+))?$/);
        if (mEnt) {
          if (method === 'POST' && !mEnt[2]) return entCreate(mEnt[1], body);
          if (method === 'PATCH' && mEnt[2]) return entPatch(mEnt[1], mEnt[2], body);
          if (method === 'DELETE' && mEnt[2]) return entDelete(mEnt[1], mEnt[2]);
        }

        // 识别入库
        if (method === 'POST' && path === '/intake/analyze') return intakeAnalyze(body);
        if (method === 'GET' && path === '/intake/queue') return intakeQueue();
        if (method === 'POST' && path === '/intake/dismiss') return intakeDismiss(body);
        if (method === 'POST' && path === '/intake/confirm') return intakeConfirm(body);

        // 物品
        if (method === 'GET' && path === '/items') return itemList(query);
        if (method === 'GET' && /^\/items\/\d+$/.test(path)) return itemDetail(path.match(/\d+/)[0]);
        if (method === 'PATCH' && /^\/items\/\d+$/.test(path)) return itemPatch(path.match(/\d+/)[0], body);
        if (method === 'POST' && /^\/items\/\d+\/out$/.test(path)) return itemOut(path.match(/\d+/)[0], body);
        if (method === 'POST' && /^\/items\/\d+\/move$/.test(path)) return itemMove(path.match(/\d+/)[0], body);

        // 搜索
        if (method === 'GET' && path === '/search') return search(query);

        // 统计
        if (method === 'GET' && path === '/stats/overview') return statsOverview();
        if (method === 'GET' && path === '/stats/board') return statsBoard();
        if (method === 'GET' && path === '/stats/meta') return statsMeta();

        // 备份：云端模式不提供本地 zip 备份
        if (method === 'GET' && path === '/backup/list') return [];
        if (path.indexOf('/backup') === 0) fail(400, '云端模式数据由云数据库托管，无需本地 zip 备份');

        fail(404, '接口不存在: ' + path);
      },
    };
  }

  return { createCloudApi };
});
