// M10 测试：实验室共享空间（v2.2）
// 覆盖：空间过滤（个人 / 实验室）、图片存储路径（users vs shared）、实验室端点、邀请码加入、个人数据导入
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createCloudApi } = require('../public/js/cloud/tidy-cloud-api.js');

// ---------- mock 云客户端（PostgREST + Storage + rpc） ----------
function mockCloud(initial, actorUid) {
  const state = JSON.parse(JSON.stringify(initial));
  const calls = { inserts: [], updates: [], deletes: [], rpc: [], storage: [] };
  let seq = 100000;
  const nextId = () => ++seq;

  const myLabIds = () => new Set((state.lab_members || [])
    .filter((m) => m.user_id === actorUid).map((m) => Number(m.lab_id)));
  const myEditableLabIds = () => new Set((state.lab_members || [])
    .filter((m) => m.user_id === actorUid && ['owner', 'editor'].includes(m.role)).map((m) => Number(m.lab_id)));
  // 模拟数据库 RLS：能看见的行 = 自己创建的，或所属实验室在本人的实验室列表里
  function visible(table, r) {
    if (table === 'categories') return true;
    if (table === 'labs') return r.owner_id === actorUid || myLabIds().has(Number(r.id));
    if (table === 'lab_members') return r.user_id === actorUid || myLabIds().has(Number(r.lab_id));
    if (!('owner_id' in r)) return true;
    return r.owner_id === actorUid || (r.lab_id != null && myLabIds().has(Number(r.lab_id)));
  }
  // 模拟 RLS 写权限：个人数据只有本人可改；实验室数据需要本人在该室为 owner/editor
  function writable(table, r) {
    if (table === 'categories') return false;
    if (table === 'labs') return r.owner_id === actorUid;
    if (table === 'lab_members') {
      return r.user_id === actorUid
        || (state.labs || []).some((l) => Number(l.id) === Number(r.lab_id) && l.owner_id === actorUid);
    }
    if (!('owner_id' in r)) return true;
    return r.owner_id === actorUid || (r.lab_id != null && myEditableLabIds().has(Number(r.lab_id)));
  }

  // 与真实 PostgREST 一致：lab_id 为空的行在"个人空间"查询里应被 is('lab_id', null) 命中
  function match(r, filters) {
    return filters.every((f) => {
      if (f.op === 'is') return r[f.col] === null || r[f.col] === undefined;
      if (f.op === 'neq') return r[f.col] !== f.val;
      return r[f.col] === f.val || Number(r[f.col]) === Number(f.val);
    });
  }

  function builder(name) {
    const b = {
      _name: name, _op: 'select', _filters: [], _limit: null, _single: false, _ret: false, _payload: null,
      eq(c, v) { b._filters.push({ col: c, val: v, op: 'eq' }); return b; },
      is(c, v) { b._filters.push({ col: c, val: v, op: 'is' }); return b; },
      neq(c, v) { b._filters.push({ col: c, val: v, op: 'neq' }); return b; },
      order() { return b; },
      limit(n) { b._limit = n; return b; },
      select() { b._ret = true; return b; },
      maybeSingle() { b._single = true; return b; },
      single() { b._single = true; return b; },
      insert(p) { b._op = 'insert'; b._payload = p; return b; },
      update(p) { b._op = 'update'; b._payload = p; return b; },
      delete() { b._op = 'delete'; return b; },
      then(resolve, reject) { try { resolve(exec(b)); } catch (e) { reject(e); } },
    };
    return b;
  }

  function exec(b) {
    const rows = state[b._name] || (state[b._name] = []);
    if (b._op === 'select') {
      let out = rows.filter((r) => match(r, b._filters) && visible(b._name, r));
      if (b._limit != null) out = out.slice(0, b._limit);
      return { data: b._single ? (out[0] || null) : out, error: null };
    }
    if (b._op === 'insert') {
      const objs = Array.isArray(b._payload) ? b._payload : [b._payload];
      const added = [];
      for (const o of objs) {
        if (o.owner_id !== undefined) throw new Error('RLS 违规：客户端发送了 owner_id');
        const row = { ...o, id: nextId() };
        // 模拟列默认值：owner_id / user_id DEFAULT auth.uid()
        if (row.owner_id === undefined && rows.some((r) => 'owner_id' in r)) row.owner_id = actorUid;
        if (b._name === 'lab_members' && row.user_id === undefined) row.user_id = actorUid;
        rows.push(row);
        added.push(row);
        calls.inserts.push({ table: b._name, row, sent: { ...o } });
      }
      return { data: b._ret ? added : null, error: null };
    }
    if (b._op === 'update') {
      const hit = rows.filter((r) => match(r, b._filters) && writable(b._name, r));
      for (const r of hit) {
        if (b._payload.owner_id !== undefined) throw new Error('RLS 违规：客户端发送了 owner_id');
        Object.assign(r, b._payload);
      }
      calls.updates.push({ table: b._name, payload: b._payload, filters: b._filters, count: hit.length });
      return { data: b._ret ? hit : null, error: null };
    }
    if (b._op === 'delete') {
      const ok = (r) => match(r, b._filters) && writable(b._name, r);
      const hit = rows.filter(ok);
      const keep = rows.filter((r) => !ok(r));
      hit.forEach((r) => calls.deletes.push({ table: b._name, row: r }));
      rows.length = 0; rows.push(...keep);
      return { data: b._ret ? hit : null, error: null };
    }
    throw new Error('未知操作 ' + b._op);
  }

  const database = {
    from(name) { return builder(name); },
    async rpc(fn, args) {
      calls.rpc.push({ fn, args });
      if (fn === 'join_lab') {
        const code = String(args.p_code || '').toUpperCase();
        const lab = (state.labs || []).find((l) => l.invite_code === code);
        if (!lab) return { data: null, error: { message: '邀请码无效，请向实验室管理员确认' } };
        if (lab.invite_expires_at && Date.parse(lab.invite_expires_at) < Date.now()) {
          return { data: null, error: { message: '邀请码已过期' } };
        }
        const me = 'userB';
        if (!(state.lab_members || []).some((m) => m.lab_id === lab.id && m.user_id === me)) {
          state.lab_members.push({ id: nextId(), lab_id: lab.id, user_id: me, display_name: args.p_display_name, role: 'editor', created_at: '2026-10-16' });
        }
        return { data: { id: lab.id, name: lab.name, owner_name: lab.owner_name }, error: null };
      }
      return { data: null, error: null };
    },
  };
  const storage = {
    from() { return storage; },
    userPath(u, rel) { return 'users/' + u + '/' + rel; },
    sharedPath(u, rel) { return 'shared/' + u + '/' + rel; },
    async upload(key, file, opts) { calls.storage.push({ op: 'upload', key, contentType: opts && opts.contentType }); return { data: { key }, error: null }; },
    async remove(p) { calls.storage.push({ op: 'remove', paths: p }); return { data: p, error: null }; },
    async move(from, to) { calls.storage.push({ op: 'move', from, to }); return { data: {}, error: null }; },
    async createSignedUrls(p, ttl) {
      calls.storage.push({ op: 'sign', paths: p, ttl });
      return { data: p.map((k) => ({ signedUrl: 'https://signed.test/' + k })), error: null };
    },
  };
  return { state, calls, database, storage };
}

function baseState() {
  return {
    zones: [
      { id: 1, owner_id: 'userA', name: '个人区域', sort: 1, lab_id: null },
      { id: 2, owner_id: 'userA', name: '实验室区域', sort: 1, lab_id: 7 },
    ],
    cabinets: [
      { id: 10, owner_id: 'userA', zone_id: 1, name: '个人柜', door: 'double', floor: 1, sort: 1, photo: null, lab_id: null },
      { id: 70, owner_id: 'userA', zone_id: 2, name: '实验室柜', door: 'single', floor: 1, sort: 1, photo: null, lab_id: 7 },
    ],
    shelves: [
      { id: 100, owner_id: 'userA', cabinet_id: 10, name: '第1层', kind: 'shelf', sort: 1, lab_id: null },
      { id: 700, owner_id: 'userA', cabinet_id: 70, name: '第1层', kind: 'shelf', sort: 1, lab_id: 7 },
    ],
    boxes: [],
    categories: [{ id: 11, name: '其他', is_preset: 1 }],
    items: [
      { id: 5, owner_id: 'userA', name: '万用表', aliases: '[]', category_id: 11, size_class: 'M', note: null, lab_id: null },
      { id: 6, owner_id: 'userA', name: '示波器', aliases: '[]', category_id: 11, size_class: 'L', note: null, lab_id: 7 },
    ],
    item_images: [],
    placements: [
      { id: 50, owner_id: 'userA', item_id: 5, shelf_id: 100, box_id: null, qty: 1, updated_at: 'x', lab_id: null },
      { id: 60, owner_id: 'userA', item_id: 6, shelf_id: 700, box_id: null, qty: 2, updated_at: 'x', lab_id: 7 },
    ],
    logs: [],
    intake_queue: [],
    labs: [
      { id: 7, name: '智能感知实验室', owner_id: 'userA', owner_name: '老张', invite_code: 'ABCD2345', invite_expires_at: '2099-01-01T00:00:00Z', created_at: '2026-10-16' },
    ],
    lab_members: [
      { id: 1, lab_id: 7, user_id: 'userA', display_name: '老张', role: 'owner', created_at: '2026-10-16' },
    ],
  };
}

function makeApi(state, uid) {
  const actor = uid || 'userA';
  const mc = mockCloud(state, actor);
  const capi = createCloudApi({
    cloud: { database: mc.database, storage: mc.storage },
    uid: actor,
    serverFetch: async () => { throw new Error('不应调用服务端'); },
    readFileBase64: () => 'QUFB',
  });
  return { capi, mc, state: mc.state };
}

const fd = () => {
  const f = new FormData();
  f.append('image', new Blob(['x'], { type: 'image/png' }), 'shot.png');
  return f;
};

// ---------- 空间过滤 ----------
test('M10.1 个人空间：只读到 lab_id 为空的数据，写入不带 lab_id', async () => {
  const { capi, mc } = makeApi(baseState());
  const tree = await capi.api('GET', '/structure');
  assert.equal(tree.length, 1, '应只看到个人空间的区域');
  assert.equal(tree[0].name, '个人区域');

  const items = await capi.api('GET', '/items');
  assert.deepEqual(items.map((i) => i.name), ['万用表'], '物品列表也只应含个人空间物品');

  await capi.api('POST', '/zones', { name: '区域九' });
  const ins = mc.calls.inserts.find((i) => i.table === 'zones');
  assert.equal(ins.row.lab_id, undefined, '个人空间写入不得携带 lab_id');
});

test('M10.2 实验室空间：只读到本实验室数据，写入带 lab_id', async () => {
  const { capi, mc } = makeApi(baseState());
  capi.setSpace({ type: 'lab', labId: 7 });

  const tree = await capi.api('GET', '/structure');
  assert.equal(tree.length, 1, '应只看到实验室的区域');
  assert.equal(tree[0].name, '实验室区域');

  const items = await capi.api('GET', '/items');
  assert.deepEqual(items.map((i) => i.name), ['示波器'], '物品列表应只含实验室物品');

  await capi.api('POST', '/zones', { name: '实验区二' });
  const ins = mc.calls.inserts.find((i) => i.table === 'zones');
  assert.equal(ins.row.lab_id, 7, '实验室空间写入必须带 lab_id');
});

test('M10.3 统计与流水同样按空间隔离', async () => {
  const { capi } = makeApi(baseState());
  const p = await capi.api('GET', '/stats/overview');
  assert.equal(p.stats.itemCount, 1, '个人空间：1 个物品');
  assert.equal(p.stats.inStock, 1);

  capi.setSpace({ type: 'lab', labId: 7 });
  const l = await capi.api('GET', '/stats/overview');
  assert.equal(l.stats.itemCount, 1, '实验室空间：1 个物品');
  assert.equal(l.stats.inStock, 2, '实验室空间在库数量应独立统计');
});

// ---------- 图片存储路径 ----------
test('M10.4 图片路径：个人走 users/，实验室走 shared/<uid>/labs/<id>/', async () => {
  const { capi, mc } = makeApi(baseState());

  await capi.api('POST', '/cabinets/10/photo', fd());
  const k1 = mc.calls.storage.find((s) => s.op === 'upload').key;
  assert.ok(k1.startsWith('users/userA/cabinets/10/'), '个人空间图片应存 users/ 前缀，实际 ' + k1);

  capi.setSpace({ type: 'lab', labId: 7 });
  mc.calls.storage.length = 0;
  await capi.api('POST', '/cabinets/70/photo', fd());
  const k2 = mc.calls.storage.find((s) => s.op === 'upload').key;
  assert.ok(k2.startsWith('shared/userA/labs/7/cabinets/70/'), '实验室图片应存 shared/ 前缀，实际 ' + k2);
});

test('M10.5 签名图收集同时覆盖 users/ 与 shared/ 前缀', async () => {
  const { capi, mc } = makeApi(baseState());
  const hit = await capi.resolveImages({
    ok: true, data: { a: 'users/userA/items/5/a.png', b: 'shared/userB/labs/7/items/6/b.png', c: 'not-a-key' },
  });
  assert.equal(hit, true);
  const sign = mc.calls.storage.find((s) => s.op === 'sign');
  assert.deepEqual([...sign.paths].sort(), ['shared/userB/labs/7/items/6/b.png', 'users/userA/items/5/a.png']);
});

// ---------- 实验室端点 ----------
test('M10.6 GET /labs：返回我参与（或我创建）的实验室与成员', async () => {
  const { capi } = makeApi(baseState());
  const labs = await capi.api('GET', '/labs');
  assert.equal(labs.length, 1);
  assert.equal(labs[0].name, '智能感知实验室');
  assert.equal(labs[0].isOwner, true);
  assert.equal(labs[0].members.length, 1);
  assert.equal(labs[0].members[0].role, 'owner');
  assert.equal(labs[0].members[0].isMe, true);
});

test('M10.7 POST /labs：建室后创建者自动成为管理员成员', async () => {
  const { capi, mc } = makeApi(baseState());
  const lab = await capi.api('POST', '/labs', { name: '机器人实验室', displayName: '老张' });
  assert.ok(lab.id, '应返回新实验室 id');
  assert.equal(lab.isOwner, true);
  assert.match(lab.inviteCode, /^[A-Z2-9]{8}$/, '应生成 8 位不含易混字符的邀请码');

  const mIns = mc.calls.inserts.find((i) => i.table === 'lab_members');
  assert.ok(mIns, '应写入成员记录');
  assert.equal(mIns.row.role, 'owner');
  assert.equal(mIns.sent.user_id, undefined, 'user_id 由数据库默认值 auth.uid() 填充，客户端不发送');
  assert.equal(mIns.row.user_id, 'userA', '数据库默认值把创建者填成成员');
});

test('M10.8 POST /labs/join：走受控函数 join_lab，避免客户端直写成员表', async () => {
  const { capi, mc } = makeApi(baseState(), 'userB');
  const lab = await capi.api('POST', '/labs/join', { code: 'abcd2345', displayName: '小李' });
  assert.equal(lab.id, 7, '邀请码应大小写不敏感');
  assert.equal(mc.calls.rpc[0].fn, 'join_lab');
  assert.equal(mc.calls.rpc[0].args.p_code, 'ABCD2345');
  assert.ok(mc.state.lab_members.some((m) => m.user_id === 'userB' && m.lab_id === 7), '应写入成员');

  await assert.rejects(() => capi.api('POST', '/labs/join', { code: 'WRONG999' }), /邀请码无效/);
});

test('M10.9 POST /labs/:id/upgrade：把个人空间数据整体迁入实验室', async () => {
  const { capi, mc } = makeApi(baseState());
  const r = await capi.api('POST', '/labs/7/upgrade');
  assert.ok(r.moved >= 3, '应迁移 zones/cabinets/shelves/items/placements 等，实际 ' + r.moved);

  const updTables = mc.calls.updates.map((u) => u.table);
  for (const t of ['zones', 'cabinets', 'items']) assert.ok(updTables.includes(t), '应包含 ' + t);
  // 每张表都必须限定"仅个人空间的行"（lab_id IS NULL），不能误伤实验室数据
  for (const u of mc.calls.updates) {
    assert.ok(u.filters.some((f) => f.col === 'lab_id' && f.op === 'is'), u.table + ' 迁移必须限定 lab_id IS NULL');
    assert.equal(u.payload.lab_id, 7);
  }
});

test('M10.10 移除成员 / 退出 / 删除实验室端点齐备且受权限约束', async () => {
  const { capi, mc } = makeApi(baseState());

  await capi.api('DELETE', '/labs/members/1');
  assert.ok(mc.calls.deletes.some((d) => d.table === 'lab_members' && d.row.id === 1));

  await capi.api('DELETE', '/labs/7');
  assert.ok(mc.calls.deletes.some((d) => d.table === 'labs' && d.row.id === 7), '管理员可删除实验室');

  // 非管理员不能删除：mock 用 filters 命中 0 行模拟 RLS 拦截
  const { capi: capi2 } = makeApi(baseState(), 'userB');
  await assert.rejects(() => capi2.api('DELETE', '/labs/7'), /只有实验室管理员/);
});

test('M10.11 非管理员退出本人实验室（自己的成员记录）', async () => {
  const st = baseState();
  st.lab_members.push({ id: 2, lab_id: 7, user_id: 'userB', display_name: '小李', role: 'editor', created_at: '2026-10-16' });
  const { capi, mc } = makeApi(st, 'userB');
  await capi.api('POST', '/labs/7/leave');
  const del = mc.calls.deletes.find((d) => d.table === 'lab_members');
  assert.equal(del.row.id, 2, '只应删除自己的成员记录');
});

// ---------- 前端接线 ----------
test('M10.12 前端接线：实验室页已挂载、启动引导处理邀请链接', () => {
  const ROOT = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('/js/components/LabPage.js'), 'index.html 应引入实验室页');

  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  assert.ok(app.includes("view==='lab'"), 'app.js 应注册 #/lab 路由');

  const boot = fs.readFileSync(path.join(ROOT, 'public', 'js', 'cloud', 'boot.js'), 'utf8');
  assert.ok(boot.includes("searchParams.get('join')"), '启动引导应识别 ?join= 邀请链接');
  assert.ok(boot.includes('__tidySetSpace'), '应导出空间切换入口');
  assert.ok(boot.includes('tidy-space:'), '当前空间应持久化（刷新后保持）');

  const api = fs.readFileSync(path.join(ROOT, 'public', 'js', 'api.js'), 'utf8');
  assert.ok(api.includes('spaceLabel'), '应提供当前空间显示名');

  const topbar = fs.readFileSync(path.join(ROOT, 'public', 'js', 'components', 'TopBar.js'), 'utf8');
  assert.ok(topbar.includes('openSpace'), '顶栏应提供空间切换入口');
});
