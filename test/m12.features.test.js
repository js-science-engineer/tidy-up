// M12 测试：v2.4 三项新需求
// 1) 总览里实物图片可点击放大（灯箱 + 点按缩放）
// 2) 入库名称查重：输入即提示库里已有同名/近名物品；确认时弹窗问「合并到哪个已入库位置 / 改名 / 仍新建」
// 3) 手机端卡顿与发热治理：性能模式（关毛玻璃 + 停背景漂移）+ 上传压缩 + 图片签名不再触发全量重拉
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, stop, tinyPng } = require('./helpers');
const T = require('../public/js/cloud/tidy-shared.js');
const { createCloudApi } = require('../public/js/cloud/tidy-cloud-api.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function pngForm() {
  const fd = new FormData();
  fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), 't.png');
  return fd;
}

// 建一个 1 区 1 柜 1 层 的骨架，返回层 id
async function shelfOf(base) {
  const z = (await api(base, 'POST', '/zones', { name: '甲区' })).json.data.id;
  await api(base, 'POST', '/cabinets', { parentId: z, name: '柜A', door: 'single' });
  const tree = (await api(base, 'GET', '/structure')).json.data;
  return tree[0].floors[0].cabinets[0].shelves[0].id;
}

async function manualIn(base, { name, qty = 1, shelfId, category = '工具', extra = {} }) {
  const q = await api(base, 'POST', '/intake/manual', pngForm());
  const c = await api(base, 'POST', '/intake/confirm', {
    queueId: q.json.data.id, index: 0, name, qty, category, shelfId, ...extra,
  });
  return c.json;
}

// ---------- 需求 2：名称查重 ----------
test('M12.1 名称相似度：写法差异能识别成"同一件东西"', () => {
  assert.equal(T.nameKey('十字 螺丝刀（小）'), '十字螺丝刀小');
  assert.equal(T.nameKey('Arduino Uno'), 'arduinouno');
  assert.equal(T.nameSim('十字螺丝刀', '十字 螺丝刀'), 1, '空白差异应视为完全相同');
  assert.ok(T.nameSim('十字螺丝刀', '十字螺丝刀（小）') >= 0.8, '括号补充规格仍应高度相似');
  assert.ok(T.nameSim('数字万用表', '数字万用表') === 1);
  assert.ok(T.nameSim('螺丝刀', '烧杯') < 0.6, '无关名称不应误判');

  const items = [
    { id: 1, name: '十字螺丝刀', aliases: '[]', totalQty: 5 },
    { id: 2, name: '数字万用表', aliases: '["万能表"]', totalQty: 1 },
  ];
  const exact = T.findNameMatches('十字螺丝刀', items);
  assert.equal(exact[0].reason, 'exact');
  const similar = T.findNameMatches('十字螺丝刀(小)', items);
  assert.equal(similar[0].item.id, 1);
  assert.ok(similar[0].score > 0.8);
  const byAlias = T.findNameMatches('万能表', items);
  assert.equal(byAlias[0].item.id, 2, '别名命中也要提示');
  assert.deepEqual(T.findNameMatches('烧杯', items), [], '无关名称不该提示');
  assert.deepEqual(T.findNameMatches('十字螺丝刀', items, { excludeId: 1 }), [], '改自己名字时不应提示自己');
});

test('M12.2 查重接口：返回已有物品 + 它所有存放位置', async () => {
  const s = await startServer();
  try {
    const shelfId = await shelfOf(s.base);
    await manualIn(s.base, { name: '十字螺丝刀', qty: 4, shelfId });

    // 完全同名
    let r = await api(s.base, 'GET', '/items/name-check?name=' + encodeURIComponent('十字螺丝刀'));
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(r.json.data.matches.length, 1);
    const m = r.json.data.matches[0];
    assert.equal(m.name, '十字螺丝刀');
    assert.equal(m.reason, 'exact');
    assert.equal(m.totalQty, 4);
    assert.equal(m.placements.length, 1);
    assert.match(m.placements[0].path, /甲区 › 柜A/);

    // 换了写法 / 多了规格后缀
    r = await api(s.base, 'GET', '/items/name-check?name=' + encodeURIComponent('十字 螺丝刀(小)'));
    assert.equal(r.json.data.matches.length, 1, '空白 + 括号规格差异也要能查出来');

    // 无关名称 → 空数组（不能每次都弹窗打扰）
    r = await api(s.base, 'GET', '/items/name-check?name=' + encodeURIComponent('烧杯'));
    assert.deepEqual(r.json.data.matches, []);

    // 空名称不报错
    r = await api(s.base, 'GET', '/items/name-check?name=');
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.data.matches, []);
  } finally { stop(s.proc); }
});

test('M12.3 合并入库：并入已有位置，名称记为别名，不新增物品', async () => {
  const s = await startServer();
  try {
    const shelfId = await shelfOf(s.base);
    await manualIn(s.base, { name: '十字螺丝刀', qty: 4, shelfId });
    const before = (await api(s.base, 'GET', '/items')).json.data;
    assert.equal(before.length, 1);

    const chk = (await api(s.base, 'GET', '/items/name-check?name=' + encodeURIComponent('十字螺丝刀（小）'))).json.data;
    const hit = chk.matches[0];

    // 用户选择：合并到已有物品，并到「已入库过的那个位置」
    const r = await manualIn(s.base, {
      name: '十字螺丝刀（小）', qty: 3, shelfId,
      extra: { mergeItemId: hit.id, mergePlacementId: hit.placements[0].id },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data.merged, true);
    assert.equal(r.data.mergedName, '十字螺丝刀', '保留库里已有的规范名');
    assert.equal(r.data.aliasAdded, '十字螺丝刀（小）', '这次的写法记成别名，下次搜索/查重都能命中');
    assert.equal(r.data.location, hit.placements[0].path, '数量应并到用户选的那个位置');

    const after = (await api(s.base, 'GET', '/items')).json.data;
    assert.equal(after.length, 1, '不允许再长出一条"同物不同名"的物品');
    assert.equal(after[0].totalQty, 7, '4 + 3 累加');
    assert.deepEqual(after[0].aliases, ['十字螺丝刀（小）']);

    // 别名入库后可被搜索到
    const hitSearch = (await api(s.base, 'GET', '/search?q=' + encodeURIComponent('十字螺丝刀（小）'))).json.data;
    assert.ok(hitSearch.results.some((x) => x.name === '十字螺丝刀'));
  } finally { stop(s.proc); }
});

test('M12.4 合并但"放到我这次选的位置"：新增存放点，不去动老位置', async () => {
  const s = await startServer();
  try {
    const shelfId = await shelfOf(s.base);
    // 第二个层：同柜再加一层
    const cabId = (await api(s.base, 'GET', '/structure')).json.data[0].floors[0].cabinets[0].id;
    const st = await api(s.base, 'POST', '/shelves', { parentId: cabId, name: '第2层', kind: 'shelf' });
    const shelf2 = st.json.data.tree ? st.json.data.tree[0].floors[0].cabinets[0].shelves[1].id : null;
    assert.ok(shelf2, '第二层应创建成功');

    await manualIn(s.base, { name: '十字螺丝刀', qty: 2, shelfId });
    const hit = (await api(s.base, 'GET', '/items/name-check?name=' + encodeURIComponent('十字螺丝刀'))).json.data.matches[0];

    const r = await manualIn(s.base, {
      name: '十字螺丝刀', qty: 5, shelfId: shelf2,
      extra: { mergeItemId: hit.id },   // 不带 mergePlacementId → 放到这次选的位置
    });
    assert.equal(r.data.merged, true);
    assert.match(r.data.location, /第2层/);

    const detail = (await api(s.base, 'GET', '/items/' + hit.id)).json.data;
    assert.equal(detail.placements.length, 2, '两处独立存放点');
    assert.deepEqual(detail.placements.map((p) => p.qty).sort((a, b) => a - b), [2, 5]);
  } finally { stop(s.proc); }
});

test('M12.5 不改名照常新建：名称确实不同时不合并', async () => {
  const s = await startServer();
  try {
    const shelfId = await shelfOf(s.base);
    await manualIn(s.base, { name: '十字螺丝刀', qty: 1, shelfId });
    const r = await manualIn(s.base, { name: '一字螺丝刀', qty: 1, shelfId });
    assert.equal(r.data.merged, false);
    assert.equal((await api(s.base, 'GET', '/items')).json.data.length, 2);
  } finally { stop(s.proc); }
});

test('M12.6 合并时把错误名字并到正确物品：记录里留下合并痕迹', async () => {
  const s = await startServer();
  try {
    const shelfId = await shelfOf(s.base);
    await manualIn(s.base, { name: '数字万用表', qty: 1, shelfId });
    // 用户把「万用表」并到「数字万用表」：名称写法不同，应记成别名并在日志里留痕
    const r = await manualIn(s.base, {
      name: '万用表', qty: 2, shelfId,
      extra: { mergeItemId: 1 },
    });
    assert.equal(r.data.merged, true);
    assert.equal(r.data.aliasAdded, '万用表');
    const detail = (await api(s.base, 'GET', '/items/1')).json.data;
    assert.ok(detail.logs.some((l) => l.action === 'in' && /合并到/.test(l.detail || '')), '日志里应写明合并到哪件物品');
    assert.deepEqual(detail.aliases, ['万用表']);
  } finally { stop(s.proc); }
});

// ---------- 云端适配器：同样的两件事 ----------
// 精简版 PostgREST mock（与 m8 同语义，够 m12 用）
function mockClient(initial) {
  const state = JSON.parse(JSON.stringify(initial));
  let seq = 900000;
  const nextId = () => ++seq;
  function builder(name, rows, op) {
    const b = {
      async then(resolve, reject) {
        try {
          if (op.type === 'select') {
            const out = rows.filter((r) => b.filters.every((f) => (f.is ? r[f.col] === null || r[f.col] === undefined
              : Number(r[f.col]) === Number(f.val) || r[f.col] === f.val)));
            return resolve({ data: op.single ? (out[0] || null) : out, error: null });
          }
          if (op.type === 'insert') {
            const objs = Array.isArray(op.payload) ? op.payload : [op.payload];
            for (const o of objs) {
              if (o.owner_id !== undefined) throw new Error('RLS 违规：客户端发送了 owner_id');
              rows.push({ is_main: 0, qty: 0, aliases: '[]', ...o, id: o.id || nextId(), owner_id: 'userA' });
            }
            return resolve({ data: op.ret ? rows.slice(-objs.length) : null, error: null });
          }
          if (op.type === 'update') {
            for (const r of rows) {
              if (b.filters.every((f) => (f.is ? r[f.col] === null || r[f.col] === undefined : r[f.col] === f.val))) {
                if (op.payload.owner_id !== undefined) throw new Error('RLS 违规');
                Object.assign(r, op.payload);
              }
            }
            return resolve({ data: null, error: null });
          }
          return resolve({ data: null, error: null });
        } catch (e) { reject(e); }
      },
      select() { op.ret = true; return b; },
      eq(col, val) { b.filters.push({ col, val }); return b; },
      is(col, v) { b.filters.push({ col, is: v === null }); return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() { op.single = true; return b; },
      single() { op.single = true; return b; },
      insert(p) { op.type = 'insert'; op.payload = p; return b; },
      update(p) { op.type = 'update'; op.payload = p; return b; },
      delete() { op.type = 'delete'; return b; },
      filters: [],
    };
    return b;
  }
  return {
    state,
    database: { from: (n) => builder(n, state[n], { type: 'select', filters: [] }), async rpc() { return { data: null, error: null }; } },
    storage: {
      from() { return this; },
      userPath: (u, rel) => 'users/' + u + '/' + rel,
      sharedPath: (u, rel) => 'shared/' + u + '/' + rel,
      async upload(k) { return { data: { key: k }, error: null }; },
      async remove() { return { data: [], error: null }; },
      async move() { return { data: {}, error: null }; },
      async createSignedUrls(paths) { return { data: paths.map((p) => ({ signedUrl: 'https://signed.test/' + p })), error: null }; },
    },
  };
}

function cloudBase() {
  return {
    categories: [{ id: 6, name: '工具', is_preset: 1 }, { id: 11, name: '其他', is_preset: 1 }],
    zones: [{ id: 1, owner_id: 'userA', name: '区域一', sort: 1 }],
    cabinets: [{ id: 10, owner_id: 'userA', zone_id: 1, name: '1号柜', door: 'single', floor: 1, sort: 1, photo: null }],
    shelves: [{ id: 100, owner_id: 'userA', cabinet_id: 10, name: '第1层', kind: 'shelf', sort: 1 }],
    boxes: [],
    items: [{ id: 5, owner_id: 'userA', name: '十字螺丝刀', aliases: '[]', category_id: 6, size_class: 'S', note: null }],
    item_images: [],
    placements: [{ id: 50, owner_id: 'userA', item_id: 5, shelf_id: 100, box_id: null, qty: 2 }],
    logs: [],
    intake_queue: [{ id: 7, owner_id: 'userA', status: 'pending', payload: JSON.stringify({ mode: 'manual', manual: true, file: null, rec: { items: [] } }) }],
  };
}

test('M12.7 云端同样支持查重与合并（位置/别名/日志行为与本地一致）', async () => {
  const mc = mockClient(cloudBase());
  const capi = createCloudApi({ cloud: { database: mc.database, storage: mc.storage }, uid: 'userA', serverFetch: async () => ({}) });

  const chk = await capi.api('GET', '/items/name-check?name=' + encodeURIComponent('十字螺丝刀（小）'));
  assert.equal(chk.matches.length, 1);
  assert.equal(chk.matches[0].id, 5);
  assert.equal(chk.matches[0].placements[0].path, '区域一 › 1号柜 › 第1层');
  assert.equal(chk.matches[0].placements[0].qty, 2);

  const cf = await capi.api('POST', '/intake/confirm', {
    queueId: 7, index: 0, name: '十字螺丝刀（小）', qty: 3, shelfId: 100, mergeItemId: 5, mergePlacementId: 50,
  });
  assert.equal(cf.merged, true);
  assert.equal(cf.mergedName, '十字螺丝刀');
  assert.equal(cf.aliasAdded, '十字螺丝刀（小）');
  assert.equal(mc.state.placements.find((p) => p.id === 50).qty, 5);
  assert.equal(mc.state.items.length, 1, '云端也不允许同名物品分裂');
  assert.deepEqual(JSON.parse(mc.state.items[0].aliases), ['十字螺丝刀（小）']);
  assert.ok(mc.state.logs.some((l) => /合并到/.test(l.detail || '')));
});

// ---------- 需求 1：总览图片放大（前端接线） ----------
test('M12.8 总览图片放大：灯箱 DOM / 点按缩放 / Esc 关闭都已接线', () => {
  const dash = read('public/js/components/Dashboard.js');
  assert.ok(dash.includes('openZoom'), '应有放大方法');
  assert.ok(dash.includes('photo-viewer'), '应有灯箱容器');
  assert.ok(dash.includes('@click.stop="openZoom(it)"'), '最近入库的实物图应可点击放大');
  assert.ok(dash.includes('openZoom(p, c.name'), '柜内每层的物品缩略图也应可点击放大');
  assert.ok(dash.includes("class=\"pv-stage\" @click=\"toggleZoom\""), '灯箱内点图片可切换放大倍率');
  assert.ok(dash.includes("e.key === 'Escape'"), 'Esc 应能关闭灯箱');
  assert.ok(dash.includes('zoomed'), '应有放大状态');
  const css = read('public/css/app.css');
  assert.ok(css.includes('.photo-viewer'), '灯箱样式应存在');
  assert.ok(css.includes('.pv-stage img.zoomed'), '放大倍数样式应存在');
  assert.ok(css.includes('body.photo-open'), '打开灯箱时锁滚动');
});

// ---------- 需求 2：前端查重交互接线 ----------
test('M12.9 识别入库页：输入即查重 + 合并弹窗（合并/改名/仍新建）', () => {
  const scan = read('public/js/components/ScanIntake.js');
  assert.ok(scan.includes("api('GET', '/items/name-check?name='"), '应调用查重接口');
  assert.ok(scan.includes('onNameInput'), '输入名称时应触发查重');
  assert.ok(scan.includes('dup-hint'), '应有行内查重提示');
  assert.ok(scan.includes('dupMerge'), '应能合并入库');
  assert.ok(scan.includes('mergeItemId'), '合并时把已有物品 id 传给后端');
  assert.ok(scan.includes('mergePlacementId'), '支持并入已有入库位置');
  assert.ok(scan.includes('dupRename'), '应能改名重填');
  assert.ok(scan.includes('仍作为新物品'), '名称确实不同时允许新建');
  assert.ok(scan.includes('doConfirm'), '查重通过后走统一入库流程');
});

// ---------- 需求 3：手机性能 ----------
test('M12.10 手机性能：性能模式、背景动画与玻璃模糊都被关掉', () => {
  const app = read('public/js/app.js');
  assert.ok(app.includes('perf-lite'), 'app.js 应给 body 加 perf-lite');
  assert.ok(app.includes('detectPerfLite'), '应自动检测手机/触屏/低端设备');
  assert.ok(app.includes("'(pointer:coarse)'"), '触屏设备应默认开启性能模式');
  assert.ok(app.includes('__setPerfLite'), '设置页可手动切换');

  const css = read('public/css/app.css');
  assert.ok(/body\.perf-lite \.glass[\s\S]{0,200}backdrop-filter:none/.test(css), '性能模式应关掉 backdrop-filter');
  // 光斑是 position:fixed + blur(110px) 的固定层，滚动时每帧重新合成 —— 实测占掉 15fps，
  // 性能模式下必须整层移除，换成画在 body 上的静态径向渐变
  assert.ok(css.includes('body.perf-lite .blob{ display:none'), '背景光斑层应整层移除');
  assert.ok(/body\.perf-lite\{[\s\S]{0,400}radial-gradient/.test(css), '应改用无滤镜的静态渐变还原配色');
  assert.ok(css.includes('body.perf-lite::after{ display:none'), '全屏噪点层应关闭');
  assert.ok(css.includes('background-attachment: scroll'), 'iOS 上不要 fixed 背景');
  assert.ok(css.includes('(pointer:coarse)'), '保留触屏专项优化');

  const pet = read('public/css/pet.css');
  assert.ok(pet.includes('body.perf-lite .pet-3d'), '性能模式下宠物待机动画也应停止');
  // zzz 的三个 span 曾经常驻 animation:infinite —— 即使 opacity:0 不可见也一直在跑
  assert.ok(/\.zzz span\{[\s\S]{0,200}animation: none/.test(pet), 'Zzz 默认不应跑动画');
  assert.ok(/\.acting-sleep \.zzz span\{ animation: zfloat/.test(pet), '只有睡着时才启动 Zzz 动画');

  const set = read('public/js/components/SettingsPage.js');
  assert.ok(set.includes('setPerf'), '设置页应有性能模式开关');
  assert.ok(set.includes('性能优先'), '应有可读的开关文案');
});

test('M12.11 手机性能：上传前压缩 + 图片签名不再触发整页重拉', () => {
  const apiSrc = read('public/js/api.js');
  assert.ok(apiSrc.includes('window.shrinkImage'), '应提供统一压缩函数');
  assert.ok(apiSrc.includes('maxEdge'), '应按长边限制尺寸');
  assert.ok(apiSrc.includes('imgVersion'), '应有独立的图片版本号');
  assert.ok(!/if \(resolved\) window\.store\.dataVersion\+\+/.test(apiSrc), '签名成功不该再 +dataVersion（会导致全量重拉）');
  assert.ok(/void window\.store\.imgVersion/.test(apiSrc), 'imgSrc 应订阅图片版本号以触发重渲染');

  const scan = read('public/js/components/ScanIntake.js');
  assert.ok(scan.includes('window.shrinkImage'), '识别入库上传前应压缩');
  const studio = read('public/js/components/Studio.js');
  assert.ok(studio.includes('window.shrinkImage'), '柜子照片上传前也应压缩');
});
