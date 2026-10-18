// M11 测试：v2.3 六项体验修复
// 1) 区域 / 柜子 / 层 / 箱 可调顺序（新建时指定位置 + 上下移动）
// 2) 识别页支持「手动文字录入」；数量可双击直接键入
// 3) 可把某个空间设为「打开网站时的默认空间」
// 4) 总览完整展示每层全部物品；图片不再丢失（主图兜底 + 自愈签名）
// 5) 搜索可用且更准（多词 / 别名 / 类别名筛选）
// 6) 移动端降耗（时钟降频 + 后台暂停 + 玻璃拟态降级 + 图片懒加载）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, stop, tinyPng } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function pngForm() {
  const fd = new FormData();
  fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), 't.png');
  return fd;
}

// 一张图 + 手动填名称，落到指定层
async function manualIn(base, { name, qty = 1, shelfId, category = '工具' }) {
  const q = await api(base, 'POST', '/intake/manual', pngForm());
  assert.equal(q.json.ok, true, '手动录入建队列失败：' + JSON.stringify(q.json));
  const id = q.json.data.id;
  const c = await api(base, 'POST', '/intake/confirm', { queueId: id, index: 0, name, qty, category, shelfId });
  assert.equal(c.json.ok, true, '手动入库失败：' + JSON.stringify(c.json));
  return c.json.data;
}

test('M11.1 新建区域时可指定顺序（index=0 排到最前）', async () => {
  const s = await startServer();
  try {
    const a = await api(s.base, 'POST', '/zones', { name: '甲区' });
    const b = await api(s.base, 'POST', '/zones', { name: '乙区' });
    assert.equal(a.json.ok && b.json.ok, true);
    const c = await api(s.base, 'POST', '/zones', { name: '丙区', index: 0 });
    assert.equal(c.json.ok, true);
    const names = c.json.data.tree.map((z) => z.name);
    assert.deepEqual(names, ['丙区', '甲区', '乙区'], 'index=0 应插到最前');

    const t = await api(s.base, 'POST', '/zones', { name: '丁区', index: 2 });
    assert.deepEqual(t.json.data.tree.map((z) => z.name), ['丙区', '甲区', '丁区', '乙区'], 'index=2 应插到第三位');
  } finally { stop(s.proc); }
});

test('M11.2 区域可上下移动；越界/重复/跨父级被拒绝', async () => {
  const s = await startServer();
  try {
    const a = await api(s.base, 'POST', '/zones', { name: '甲区' });
    const b = await api(s.base, 'POST', '/zones', { name: '乙区' });
    const z1 = a.json.data.id;
    const z2 = b.json.data.id;

    // 把第二个挪到第一位
    let r = await api(s.base, 'POST', '/structure/reorder', { ent: 'zones', ids: [z2, z1] });
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.data.tree.map((z) => z.name), ['乙区', '甲区']);

    // 重复 id → 400
    r = await api(s.base, 'POST', '/structure/reorder', { ent: 'zones', ids: [z1, z1] });
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /重复/);

    // 未知实体 → 400
    r = await api(s.base, 'POST', '/structure/reorder', { ent: 'nope', ids: [z1] });
    assert.equal(r.json.ok, false);
  } finally { stop(s.proc); }
});

test('M11.3 柜子只在同一父级内排序（跨区域必须报错）', async () => {
  const s = await startServer();
  try {
    const z1 = (await api(s.base, 'POST', '/zones', { name: '甲区' })).json.data.id;
    const z2 = (await api(s.base, 'POST', '/zones', { name: '乙区' })).json.data.id;
    const c1 = (await api(s.base, 'POST', '/cabinets', { parentId: z1, name: '柜A', door: 'single' })).json.data.id;
    const c2 = (await api(s.base, 'POST', '/cabinets', { parentId: z1, name: '柜B', door: 'single' })).json.data.id;
    const c3 = (await api(s.base, 'POST', '/cabinets', { parentId: z2, name: '柜C', door: 'single' })).json.data.id;

    const r = await api(s.base, 'POST', '/structure/reorder', { ent: 'cabinets', ids: [c2, c1] });
    assert.equal(r.json.ok, true);
    const zone1 = r.json.data.tree.find((z) => z.id === z1);
    const flat = zone1.floors.flatMap((f) => f.cabinets.map((c) => c.name));
    assert.deepEqual(flat, ['柜B', '柜A']);

    const bad = await api(s.base, 'POST', '/structure/reorder', { ent: 'cabinets', ids: [c1, c3] });
    assert.equal(bad.json.ok, false);
    assert.match(bad.json.error, /同一上级/);
  } finally { stop(s.proc); }
});

test('M11.4 手动录入可绕开 AI：照片 + 自填名称/数量直接入库', async () => {
  const s = await startServer();
  try {
    const z = (await api(s.base, 'POST', '/zones', { name: '甲区' })).json.data.id;
    const cab = await api(s.base, 'POST', '/cabinets', { parentId: z, name: '柜A', door: 'single' });
    const shelfId = cab.json.data.tree[0].floors[0].cabinets[0].shelves[0].id;

    const r = await manualIn(s.base, { name: '自填螺丝刀', qty: 12, shelfId });
    assert.equal(r.qty, 12);
    assert.match(r.location, /甲区/);

    const items = await api(s.base, 'GET', '/items');
    const it = items.json.data.find((i) => i.name === '自填螺丝刀');
    assert.ok(it, '应出现在物品列表');
    assert.ok(it.img, '应带上用户上传的照片');

    // 手动队列不该污染"待确认"队列
    const q = await api(s.base, 'GET', '/intake/queue');
    assert.equal((q.json.data || []).length, 0);
  } finally { stop(s.proc); }
});

test('M11.5 搜索：多词、别名、类别名筛选都能命中', async () => {
  const s = await startServer();
  try {
    const z = (await api(s.base, 'POST', '/zones', { name: '甲区' })).json.data.id;
    await api(s.base, 'POST', '/cabinets', { parentId: z, name: '柜A', door: 'single' });
    const shelfId = (await api(s.base, 'GET', '/structure')).json.data[0].floors[0].cabinets[0].shelves[0].id;

    const q1 = await api(s.base, 'POST', '/intake/manual', pngForm());
    await api(s.base, 'POST', '/intake/confirm', {
      queueId: q1.json.data.id, index: 0, name: '数字万用表', qty: 2, category: '工具',
      aliases: ['multimeter', '万能表'], shelfId,
    });
    await manualIn(s.base, { name: 'Arduino Uno', qty: 1, shelfId, category: '开发板/模块' });

    const hit = async (qs) => (await api(s.base, 'GET', '/search?' + qs)).json.data;

    // 多词（且关系）
    let d = await hit('q=' + encodeURIComponent('数字 万用'));
    assert.equal(d.results.length, 1);
    assert.equal(d.results[0].name, '数字万用表');

    // 别名
    d = await hit('q=multimeter');
    assert.equal(d.results[0].name, '数字万用表');

    // 中文别名
    d = await hit('q=' + encodeURIComponent('万能表'));
    assert.equal(d.results[0].name, '数字万用表');

    // 类别名筛选（历史 bug：下拉传类别名、后端按 category_id 比数字 → 永远 0 结果）
    d = await hit('q=' + encodeURIComponent('模块') + '&categoryId=' + encodeURIComponent('开发板/模块'));
    assert.ok(d.results.length >= 1, '按类别名筛选应有结果');
    assert.ok(d.results.every((r) => r.category === '开发板/模块'));

    // 子序列：万用 → 数字万用表
    d = await hit('q=' + encodeURIComponent('万用'));
    assert.ok(d.results.some((r) => r.name === '数字万用表'));
  } finally { stop(s.proc); }
});

test('M11.6 总览不截断：一层里的全部物品都要返回', async () => {
  const s = await startServer();
  try {
    const z = (await api(s.base, 'POST', '/zones', { name: '甲区' })).json.data.id;
    await api(s.base, 'POST', '/cabinets', { parentId: z, name: '柜A', door: 'single' });
    const shelfId = (await api(s.base, 'GET', '/structure')).json.data[0].floors[0].cabinets[0].shelves[0].id;

    for (let i = 1; i <= 11; i++) {
      await manualIn(s.base, { name: '零件' + i, qty: 1, shelfId });
    }
    const ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
    const shelf = ov.zones[0].cabinets[0].shelves[0];
    assert.equal(shelf.items.length, 11, '11 件物品必须全部返回（早期 slice(0,8) 只剩 8 件）');
    assert.equal(shelf.items.reduce((n, i) => n + i.qty, 0), 11);
  } finally { stop(s.proc); }
});

test('M11.7 图片兜底：is_main 全为 0 时仍能取到主图（历史丢图原因）', async () => {
  const s = await startServer();
  try {
    const z = (await api(s.base, 'POST', '/zones', { name: '甲区' })).json.data.id;
    await api(s.base, 'POST', '/cabinets', { parentId: z, name: '柜A', door: 'single' });
    const shelfId = (await api(s.base, 'GET', '/structure')).json.data[0].floors[0].cabinets[0].shelves[0].id;
    await manualIn(s.base, { name: '示波器', qty: 1, shelfId });

    // 直接改库：把 is_main 抹成 0（老版本曾出现"全是 0"的状态）
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(s.dataDir, 'tidy.db');
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE item_images SET is_main=0').run();
    db.close();

    const ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
    const item = ov.zones[0].cabinets[0].shelves[0].items[0];
    assert.ok(item.img, 'is_main 全为 0 时也必须回退取最新一张，而不是空');
  } finally { stop(s.proc); }
});

test('M11.8 前端接线：手动模式 / 双击数量 / 默认空间 / 懒加载 / 移动端降级', () => {
  const scan = read('public/js/components/ScanIntake.js');
  assert.ok(scan.includes("mode==='manual'"), '识别页应有手动模式按钮');
  assert.ok(scan.includes('startManual'), '应能进入手动录入');
  assert.ok(scan.includes("api('POST', '/intake/manual'"), '手动录入应调用专用接口');
  assert.ok(scan.includes('@dblclick="startEditQty'), '数量应支持双击直接键入');
  assert.ok(scan.includes('class="qty-input"'), '双击后应出现可输入的输入框');

  // 默认空间
  const boot = read('public/js/cloud/boot.js');
  assert.ok(boot.includes('tidy-space-default:'), '默认空间应按账号持久化');
  assert.ok(boot.includes('const target = def || saved;'), '默认空间优先级应高于"上次所在空间"');
  const top = read('public/js/components/TopBar.js');
  assert.ok(top.includes('setDefault'), '顶栏应有"设为默认"');
  assert.ok(top.includes("this.narrow ? 15000 : 1000"), '手机上时钟应降频（每秒重绘很耗电）');
  assert.ok(top.includes('visibilitychange'), '切后台应停表');

  // 总览默认完整展示
  const dash = read('public/js/components/Dashboard.js');
  assert.ok(/collapsed\s*:\s*\[\]/.test(dash), '总览默认应完整展开');
  assert.ok(dash.includes(': s.items;'), '未折叠时返回全部物品');

  // 图片
  const apiSrc = read('public/js/api.js');
  assert.ok(apiSrc.includes('__imgEnsure'), '图片应按需补签');
  assert.ok(apiSrc.includes('IMG_PLACEHOLDER'), '签不出来时应给占位图而不是空白');
  const cloudSrc = read('public/js/cloud/tidy-cloud-api.js');
  assert.ok(cloudSrc.includes('SIGN_FAIL_MS'), '签名失败应进冷却，避免死循环');
  assert.ok(cloudSrc.includes('ORDER BY') || cloudSrc.includes('is_main'), '主图应有兜底选择逻辑');
  assert.ok(/return OWNED_KEY\.test\(s\)/.test(cloudSrc), '只有 users/ shared/ 前缀才算图片 key');

  // 懒加载
  const detail = read('public/js/components/ItemDetail.js');
  assert.ok(detail.includes('loading="lazy"') || dash.includes('loading="lazy"'), '列表图片应懒加载');

  // 移动端 CSS 降级
  const css = read('public/css/app.css');
  assert.ok(css.includes('(pointer:coarse)'), '触屏应降级玻璃拟态');
  assert.ok(css.includes('body.page-hidden'), '后台应暂停动画');
  const pet = read('public/css/pet.css');
  assert.ok(pet.includes('(pointer:coarse)'), '触屏应关掉宠物常驻动画');
  const petJs = read('public/js/components/PetWidget.js');
  assert.ok(petJs.includes('COARSE_POINTER'), '触屏不应启用视线追踪循环');
});

test('M11.9 所有组件模板都能被 Vue 真正编译（防"改完模板整页白屏"）', () => {
  const vm = require('node:vm');
  const src = read('public/assets/vue.global.prod.js') + '\n;globalThis.__VUE__ = Vue;';
  vm.runInThisContext(src, { filename: 'vue.global.prod.js' });
  const Vue = globalThis.__VUE__;
  assert.equal(typeof Vue.compile, 'function');

  // 编译器解 HTML 实体时会用一个 div 做 decoder，这里给个最小实现
  const fakeEl = () => {
    const el = {
      _html: '', textContent: '',
      set innerHTML(v) {
        el._html = v;
        el.textContent = v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&').replace(/&#10;/g, '\n');
      },
      get innerHTML() { return el._html; },
      get children() { return [{ getAttribute: () => el.getAttribute() }]; },
      setAttribute() {},
      getAttribute() { const m = /^<div foo="([\s\S]*)">$/.exec(el._html); return m ? m[1] : el._html; },
      appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {},
      style: {}, classList: { add() {}, remove() {} },
    };
    return el;
  };
  globalThis.document = { createElement: fakeEl, createElementNS: fakeEl, addEventListener() {}, removeEventListener() {} };
  globalThis.window = globalThis;
  globalThis.Components = {};
  globalThis.t = (k) => k;
  globalThis.imgSrc = () => '';
  globalThis.store = {};

  const dir = path.join(ROOT, 'public/js/components');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    vm.runInThisContext(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });
  }
  const names = Object.keys(globalThis.Components);
  assert.ok(names.length >= 10, '应加载到全部组件，实际 ' + names.length);
  for (const [name, comp] of Object.entries(globalThis.Components)) {
    if (!comp || typeof comp.template !== 'string') continue;
    assert.doesNotThrow(() => Vue.compile(comp.template, { onError: (e) => { throw e; } }), name + ' 模板编译失败');
  }
});

