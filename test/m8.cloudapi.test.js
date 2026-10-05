// M8 测试：云端 API 适配器（前端 PostgREST/Storage 翻译层）契约
// 用 mock 云客户端验证：端点翻译、RLS 安全（永不发送 owner_id）、响应形状与本地 REST 完全一致
const test = require('node:test');
const assert = require('node:assert');
const { createCloudApi } = require('../public/js/cloud/tidy-cloud-api.js');

// ---------- mock 云客户端 ----------
function mockClient(initial) {
  const state = JSON.parse(JSON.stringify(initial));
  const calls = { inserts: [], updates: [], deletes: [], storage: [] };
  let seq = 100000;
  const nextId = () => ++seq;

  function makeBuilder(name, rows, op) {
    const b = {
      // 终端
      async then(resolve, reject) {
        try {
          if (op.type === 'select') {
            let out = rows.filter((r) => b.filters.every((f) =>
              f.is ? r[f.col] === null : Number(r[f.col]) === Number(f.val) || r[f.col] === f.val));
            if (b.orders.length) {
              out = [...out].sort((x, y) => {
                for (const o of b.orders) {
                  const dx = x[o.col], dy = y[o.col];
                  const c = o.num ? (Number(dx) - Number(dy)) : String(dx || '').localeCompare(String(dy || ''));
                  if (c !== 0) return o.asc ? c : -c;
                }
                return 0;
              });
            }
            if (b.limitN != null) out = out.slice(0, b.limitN);
            return resolve({ data: op.single ? (out[0] || null) : out, error: null });
          }
          if (op.type === 'insert') {
            const objs = Array.isArray(op.payload) ? op.payload : [op.payload];
            const defaults = { status: 'pending', is_main: 0, source: 'user', qty: 0, sort: 0, floor: 1, is_preset: 0, aliases: '[]' };
            for (const o of objs) {
              if (o.owner_id !== undefined) throw new Error('RLS 违规：客户端发送了 owner_id');
              const row = { ...defaults, ...o, id: o.id ?? nextId(), owner_id: 'userA' };
              rows.push(row);
              calls.inserts.push({ table: name, row });
            }
            return resolve({ data: op.ret ? rows.slice(-objs.length) : null, error: null });
          }
          if (op.type === 'update') {
            for (const r of rows) {
              if (b.filters.every((f) => (f.is ? r[f.col] === null : r[f.col] === f.val))) {
                if (op.payload.owner_id !== undefined) throw new Error('RLS 违规：客户端发送了 owner_id');
                Object.assign(r, op.payload);
              }
            }
            calls.updates.push({ table: name, payload: op.payload });
            return resolve({ data: null, error: null });
          }
          if (op.type === 'delete') {
            const keep = rows.filter((r) => !b.filters.every((f) => (f.is ? r[f.col] === null : r[f.col] === f.val)));
            rows.filter((r) => b.filters.every((f) => (f.is ? r[f.col] === null : r[f.col] === f.val)))
              .forEach((r) => calls.deletes.push({ table: name, row: r }));
            rows.length = 0;
            rows.push(...keep);
            return resolve({ data: null, error: null });
          }
          throw new Error('未知操作 ' + op.type);
        } catch (e) {
          reject(e);
        }
      },
      // 构建器
      select(_cols) { op.ret = true; return b; },
      eq(col, val) { b.filters.push({ col, val }); return b; },
      is(col, nullVal) { b.filters.push({ col, is: nullVal === null }); return b; },
      order(col, o) { b.orders.push({ col, asc: !o || o.ascending !== false, num: ['id', 'sort', 'qty', 'is_main'].includes(col) }); return b; },
      limit(n) { b.limitN = n; return b; },
      maybeSingle() { op.single = true; return b; },
      single() { op.single = true; return b; },
      insert(payload) { op.type = 'insert'; op.payload = payload; return b; },
      update(payload) { op.type = 'update'; op.payload = payload; return b; },
      delete() { op.type = 'delete'; return b; },
      filters: [],
      orders: [],
      limitN: null,
    };
    return b;
  }

  const database = {
    from(name) {
      if (!state[name]) throw new Error('未知表 ' + name);
      return makeBuilder(name, state[name], { type: 'select', filters: [], orders: [] });
    },
    async rpc() { return { data: null, error: null }; },
  };
  const storage = {
    from() { return storage; },
    userPath(u, rel) { return 'users/' + u + '/' + rel; },
    sharedPath(u, rel) { return 'shared/' + u + '/' + rel; },
    async upload(key, file, opts) { calls.storage.push({ op: 'upload', key, contentType: opts && opts.contentType }); return { data: { key }, error: null }; },
    async remove(paths) { calls.storage.push({ op: 'remove', paths }); return { data: paths, error: null }; },
    async move(from, to) { calls.storage.push({ op: 'move', from, to }); return { data: {}, error: null }; },
    async createSignedUrls(paths, ttl) {
      calls.storage.push({ op: 'sign', paths, ttl });
      return { data: paths.map((p) => ({ signedUrl: 'https://signed.test/' + p })), error: null };
    },
  };
  return { state, calls, database, storage };
}

function baseState() {
  return {
    zones: [{ id: 1, owner_id: 'userA', name: '区域一', sort: 1, created_at: '2026-10-05T10:00:00Z' }],
    cabinets: [{ id: 10, owner_id: 'userA', zone_id: 1, name: '1号柜', door: 'double', floor: 1, sort: 1, photo: null }],
    shelves: [{ id: 100, owner_id: 'userA', cabinet_id: 10, name: '第1层', kind: 'shelf', sort: 1 }],
    boxes: [{ id: 1000, owner_id: 'userA', shelf_id: 100, name: '零件盒', color: null, sort: 1 }],
    categories: [
      { id: 2, name: '开发板/模块', is_preset: 1 }, { id: 3, name: '仪器设备', is_preset: 1 },
      { id: 6, name: '工具', is_preset: 1 }, { id: 11, name: '其他', is_preset: 1 },
    ],
    items: [{ id: 5, owner_id: 'userA', name: '万用表', aliases: '[]', category_id: 3, size_class: 'M', note: null }],
    item_images: [{ id: 500, owner_id: 'userA', item_id: 5, file: 'users/userA/items/5/a.png', source: 'user', is_main: 1 }],
    placements: [
      { id: 50, owner_id: 'userA', item_id: 5, shelf_id: 100, box_id: null, qty: 2, updated_at: '2026-10-05T10:00:00Z' },
    ],
    logs: [],
    intake_queue: [],
  };
}

function makeApi(state, serverHandler) {
  const mc = mockClient(state);
  const serverFetch = serverHandler || (async () => { throw new Error('不应调用服务端'); });
  const capi = createCloudApi({
    cloud: { database: mc.database, storage: mc.storage },
    uid: 'userA',
    serverFetch,
    readFileBase64: () => 'QUFB', // 'AAA'
  });
  return { capi, mc, state: mc.state }; // state 为 mock 内部真实数据（深拷贝后）
}
const fd = (file, mode) => {
  const f = new FormData();
  f.append('image', new Blob(['x'], { type: 'image/png' }), 'shot.png');
  if (mode) f.append('mode', mode);
  return f;
};

// ---------- 结构 ----------
test('M8.1 GET /structure：树形状与本地一致', async () => {
  const { capi } = makeApi(baseState());
  const tree = await capi.api('GET', '/structure');
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, '区域一');
  assert.equal(tree[0].floors[0].cabinets[0].shelves[0].state, 'full');
});

test('M8.2 新建实体 + 柜子默认层 + 结构日志', async () => {
  const st = baseState();
  const { capi, mc } = makeApi(st);
  const r = await capi.api('POST', '/zones', { name: '区域二' });
  assert.ok(r.id > 0);
  assert.equal(r.tree.length, 2);
  const cab = await capi.api('POST', '/cabinets', { parentId: r.id, name: '9号柜', door: 'drawer' });
  const tree = (await capi.api('GET', '/structure')).find((z) => z.id === r.id);
  const c = tree.floors[0].cabinets.find((x) => x.id === cab.id);
  assert.equal(c.shelves.length, 1, '新柜自动带一个抽屉');
  assert.equal(c.shelves[0].kind, 'drawer');
  assert.ok(mc.calls.inserts.some((i) => i.table === 'logs' && i.row.action === 'structure'), '写结构日志');
  // 校验类错误
  await assert.rejects(() => capi.api('POST', '/cabinets', { parentId: r.id, name: 'x', door: 'bad' }), /门型/);
  await assert.rejects(() => capi.api('POST', '/shelves', { name: '缺父级' }), /parentId/);
});

test('M8.3 修改/删除 + 库存保护', async () => {
  const { capi, state } = makeApi(baseState());
  const rn = await capi.api('PATCH', '/cabinets/10', { name: '主柜', door: 'drawer' });
  assert.equal(rn.tree[0].floors[0].cabinets[0].name, '主柜');
  // 第1层下有 2 件库存 → 拒删
  await assert.rejects(() => capi.api('DELETE', '/shelves/100'), /库存记录/);
  await assert.rejects(() => capi.api('PATCH', '/cabinets/10', {}), /没有可更新字段/);
  // 清空库存后可删（级联箱子和物品不受影响测试仅覆盖结构删除）
  state.placements.length = 0;
  const del = await capi.api('DELETE', '/zones/1');
  assert.equal(del.tree.length, 0);
});

test('M8.4 柜子实拍照片：上传/删除走云存储', async () => {
  const st = baseState();
  const { capi, mc } = makeApi(st);
  const r = await capi.api('POST', '/cabinets/10/photo', fd());
  assert.ok(r.photo.startsWith('users/userA/cabinets/10/'), '照片应存到用户目录');
  assert.ok(r.tree.length >= 1);
  assert.ok(mc.calls.storage.some((s) => s.op === 'upload' && s.key === r.photo));
  const d = await capi.api('DELETE', '/cabinets/10/photo');
  assert.equal(d.tree[0].floors[0].cabinets[0].photo, null);
  assert.ok(mc.calls.storage.some((s) => s.op === 'remove' && s.paths[0] === r.photo), '旧照片应删除');
  await assert.rejects(() => capi.api('POST', '/cabinets/999/photo', fd()), /柜子不存在/);
});

// ---------- 识别入库 ----------
test('M8.5 识别：上传原图到云存储 + 建队列 + 分区建议', async () => {
  const { capi } = makeApi(baseState(), async (method, path, body) => {
    if (method === 'POST' && path === '/intake/analyze-json') {
      assert.ok(body.imageBase64 && body.mime === 'image/png');
      return { rec: { mode: body.mode, items: [{ name: 'STM32 板', aliases: [], category: '开发板/模块', size: 'S', confidence: 0.9 }], webQuery: 'x' } };
    }
    throw new Error('意外调用 ' + path);
  });
  const r = await capi.api('POST', '/intake/analyze', fd(null, 'single'));
  assert.ok(r.id > 0);
  assert.ok(r.previewUrl.startsWith('https://signed.test/users/userA/intake/'), '预览图应换签名 URL');
  // 「开发板/模块」命中「零件盒」关键词 + 空间充足 → 建议入箱
  assert.equal(r.rec.items[0].suggestion.path.join(' › '), '区域一 › 1号柜 › 第1层 › 零件盒');
  const queue = await capi.api('GET', '/intake/queue');
  assert.equal(queue.length, 1);
  assert.ok(queue[0].previewUrl.startsWith('https://signed.test/'), '队列回读也要签名 URL');
});

test('M8.6 确认入库：新建物品 + 主图移动 + 日志 + 队列闭环', async () => {
  const { capi, mc, state } = makeApi(baseState(), async () => ({ rec: { mode: 'single', items: [{ name: 'STM32 板', aliases: ['开发板'], category: '开发板/模块', size: 'S', confidence: 0.9 }], webQuery: '' } }));
  const an = await capi.api('POST', '/intake/analyze', fd(null, 'single'));
  const cf = await capi.api('POST', '/intake/confirm', { queueId: an.id, index: 0, qty: 3, shelfId: 100 });
  assert.equal(cf.itemId > 5, true);
  assert.equal(cf.merged, false);
  assert.equal(cf.location, '区域一 › 1号柜 › 第1层');
  const item = state.items.find((i) => i.id === cf.itemId);
  assert.equal(item.category_id, 2, '「开发板/模块」→ id 2');
  assert.ok(mc.calls.storage.some((s) => s.op === 'move' && s.to.startsWith('users/userA/items/' + cf.itemId + '/')), '原图应移入 items/<id>/');
  assert.ok(state.item_images.find((i) => i.item_id === cf.itemId && i.is_main === 1), '主图记录写入');
  assert.ok(state.logs.some((l) => l.action === 'in' && l.item_id === cf.itemId));
  assert.equal(state.intake_queue.find((q) => q.id === an.id).status, 'done', '队列标记 done');
});

test('M8.7 同名合并：多位置独立数量累加', async () => {
  const { capi, state } = makeApi(baseState(), async () => ({ rec: { mode: 'single', items: [{ name: '万用表', aliases: [], category: '仪器设备', size: 'M', confidence: 0.9 }] } }));
  // 无图入库（模拟 payload.file 为空的路径）
  const q = await capi.api('POST', '/intake/analyze', fd(null, 'single'));
  // 直接改队列 payload 移除文件键 → 走无图分支
  state.intake_queue.find((x) => x.id === q.id).payload = JSON.stringify({ mode: 'single', file: null, mime: 'image/png', previewUrl: null, rec: { items: [{ name: '万用表', category: '仪器设备', size: 'M', confidence: 0.9 }] } });
  const c1 = await capi.api('POST', '/intake/confirm', { queueId: q.id, index: 0, qty: 2, shelfId: 100 });
  assert.equal(c1.itemId, 5, '同名物品应合并到 id 5');
  assert.equal(c1.merged, true);
  const c2 = await capi.api('POST', '/intake/confirm', { queueId: q.id, index: 0, qty: 1, shelfId: 100 });
  assert.equal(c2.merged, true);
  const p = state.placements.find((x) => x.item_id === 5 && x.shelf_id === 100);
  assert.equal(p.qty, 5, '同容器累加：2 + 2 + 1');
});

test('M8.8 出库/移位：数量校验 + 日志', async () => {
  const { capi, state } = makeApi(baseState());
  const out = await capi.api('POST', '/items/5/out', { placementId: 50, qty: 1 });
  assert.equal(out.remain, 1);
  assert.equal(out.emptied, false);
  await assert.rejects(() => capi.api('POST', '/items/5/out', { placementId: 50, qty: 99 }), /超过库存/);
  const all = await capi.api('POST', '/items/5/out', { placementId: 50, all: true });
  assert.equal(all.remain, 0);
  assert.equal(all.emptied, true);
  assert.ok(state.logs.some((l) => l.action === 'out' && l.detail === '已取空'));
  state.placements.find((p) => p.id === 50).qty = 2;
  const mv = await capi.api('POST', '/items/5/move', { placementId: 50, boxId: 1000 });
  assert.equal(mv.location, '区域一 › 1号柜 › 第1层 › 零件盒');
  assert.equal(state.placements.find((p) => p.id === 50).box_id, 1000);
  await assert.rejects(() => capi.api('POST', '/items/5/move', { placementId: 999, boxId: 1000 }), /找不到该存放记录/);
});

test('M8.9 编辑物品：改名查重 + 类别解析', async () => {
  const { capi, state } = makeApi(baseState());
  const r = await capi.api('PATCH', '/items/5', { name: '数字万用表', category: '工具', note: '校准过' });
  assert.equal(r.name, '数字万用表');
  assert.equal(r.category, '工具');
  // 造一条同名 → 409
  state.items.push({ id: 6, owner_id: 'userA', name: '万用表', aliases: '[]', category_id: null, size_class: 'S' });
  await assert.rejects(() => capi.api('PATCH', '/items/5', { name: '万用表' }), /同名/);
  await assert.rejects(() => capi.api('PATCH', '/items/999', { name: 'x' }), /物品不存在/);
});

test('M8.10 详情与列表：聚合字段（totalQty / img / placements.path）', async () => {
  const { capi } = makeApi(baseState());
  const list = await capi.api('GET', '/items');
  assert.equal(list.length, 1);
  assert.equal(list[0].totalQty, 2);
  assert.equal(list[0].img, 'users/userA/items/5/a.png');
  assert.equal(list[0].category, '仪器设备');
  // 过滤
  const miss = await capi.api('GET', '/items?q=不存在的东西');
  assert.equal(miss.length, 0);
  const hit = await capi.api('GET', '/items?q=万用');
  assert.equal(hit.length, 1);
  const d = await capi.api('GET', '/items/5');
  assert.equal(d.placements[0].path, '区域一 › 1号柜 › 第1层');
  assert.ok(d.logs !== undefined);
  await assert.rejects(() => capi.api('GET', '/items/999'), /物品不存在/);
});

// ---------- 搜索 / 统计 / 设置代理 ----------
test('M8.11 搜索：精确 + 语义（AI 代理）+ 区域筛选', async () => {
  const st = baseState();
  const { capi } = makeApi(st, async (method, path, body) => {
    assert.equal(path, '/ai/semantic-search');
    return { matches: [{ id: 5, score: 0.9, reason: '匹配' }] };
  });
  const ex = await capi.api('GET', '/search?q=' + encodeURIComponent('万用'));
  assert.equal(ex.mode, 'exact');
  assert.equal(ex.results.length, 1);
  assert.equal(ex.results[0].placements[0].path, '区域一 › 1号柜 › 第1层');
  const sem = await capi.api('GET', '/search?q=测电压的&mode=semantic');
  assert.equal(sem.mode, 'semantic');
  assert.equal(sem.results[0].matchScore, 90);
  const zone = await capi.api('GET', '/search?q=万用&zoneId=1');
  assert.equal(zone.results.length, 1, '区域 1 下的物品命中');
  const zoneMiss = await capi.api('GET', '/search?q=万用&zoneId=999');
  assert.equal(zoneMiss.results.length, 0);
  const empty = capi.api('GET', '/search?q=');
  await assert.rejects(() => empty, /请输入搜索内容/);
});

test('M8.12 统计：overview / board / meta 聚合', async () => {
  const st = baseState();
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ds = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T10:00:00Z`;
  st.logs.push(
    { id: 900, owner_id: 'userA', item_id: 5, action: 'in', qty: 3, location: 'x', detail: '', created_at: ds },
    { id: 901, owner_id: 'userA', item_id: 5, action: 'out', qty: 1, location: 'x', detail: '', created_at: ds },
  );
  const { capi } = makeApi(st);
  const ov = await capi.api('GET', '/stats/overview');
  assert.equal(ov.stats.itemCount, 1);
  assert.equal(ov.stats.inStock, 2);
  assert.equal(ov.stats.todayIn, 3);
  assert.equal(ov.recent.length, 1);
  assert.equal(ov.zones[0].itemQty, 2);
  assert.equal(ov.categoryDist[0].name, '仪器设备');
  const board = await capi.api('GET', '/stats/board');
  assert.equal(board.trend.length, 7);
  assert.equal(board.topItems[0].qty, 2);
  assert.equal(board.topItems[0].spots, 1);
  assert.equal(board.recentLogs.length, 2);
  const meta = await capi.api('GET', '/stats/meta');
  assert.ok(meta.categories.includes('仪器设备'));
  assert.equal(meta.zones.length, 1);
});

test('M8.13 设置走服务端代理；备份在云端明确拒绝', async () => {
  const { capi } = makeApi(baseState(), async (method, path) => {
    if (path === '/settings') return { provider: 'glm' };
    if (path === '/settings/test-ai') return { reply: 'OK' };
    throw new Error('意外调用 ' + path);
  });
  const cfg = await capi.api('GET', '/settings');
  assert.equal(cfg.provider, 'glm');
  const t = await capi.api('POST', '/settings/test-ai');
  assert.equal(t.reply, 'OK');
  await assert.rejects(() => capi.api('POST', '/backup'), /云端模式/);
  await assert.rejects(() => capi.api('GET', '/no/such/api'), /接口不存在/);
});

test('M8.14 RLS 安全：任何写操作不携带 owner_id；签名 URL 带缓存', async () => {
  const st = baseState();
  const { capi, mc } = makeApi(st);
  await capi.api('POST', '/zones', { name: '区域三' });
  await capi.api('PATCH', '/cabinets/10', { name: '改名' });
  for (const i of mc.calls.inserts) assert.equal(i.row.owner_id, 'userA', 'owner_id 由 mock 服务端自动填充，客户端未发送');
  for (const u of mc.calls.updates) assert.equal(u.payload.owner_id, undefined, '更新不得携带 owner_id');
  // 签名缓存
  const u1 = await capi.signedUrl('users/userA/items/5/a.png');
  const u2 = await capi.signedUrl('users/userA/items/5/a.png');
  assert.equal(u1, u2);
  const hit = capi.imgCache.get('users/userA/items/5/a.png');
  assert.ok(hit && hit.exp > Date.now(), '缓存生效');
});
