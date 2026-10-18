// M15 切模块体验：GET 缓存 / 请求合并 / 骨架屏 / 加载指示
// 直接在一个最小沙箱里跑真实的 public/js/api.js，验证行为而不是只看源码字样。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function makeSandbox(handler) {
  const calls = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    structuredClone,
    URLSearchParams,
    Blob: class {},
    FormData: class {},
    Vue: { reactive: (o) => o },
    fetch: async (url, opt) => {
      calls.push({ url, method: (opt && opt.method) || 'GET' });
      const data = await handler(url, opt);
      return { status: 200, json: async () => ({ ok: true, data }) };
    },
    document: { addEventListener() {}, createElement: () => ({ style: {}, getContext: () => null }) },
    navigator: { userAgent: 'node' },
    location: { href: 'http://x/' },
    localStorage: { getItem: () => null, setItem() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/api.js'), sandbox);
  return { sandbox, calls };
}

test('M15.1 GET 结果被缓存：反复切模块不会重复请求', async () => {
  const { sandbox, calls } = makeSandbox(async () => ({ n: 1 }));
  const a = await sandbox.api('GET', '/stats/overview');
  const b = await sandbox.api('GET', '/stats/overview');
  assert.equal(calls.length, 1, '同一路径第二次应走缓存');
  assert.deepEqual(a, b);
});

test('M15.2 缓存命中返回副本：两个页面各改各的不会互相污染', async () => {
  const { sandbox } = makeSandbox(async () => ({ list: [1, 2] }));
  const a = await sandbox.api('GET', '/items');
  a.list.push(3);
  const b = await sandbox.api('GET', '/items');
  assert.deepEqual(b.list, [1, 2], '拿到的应是副本，不能被上一个页面改坏');
});

test('M15.3 写操作后立刻作废缓存（改完必须看到新数据）', async () => {
  const { sandbox, calls } = makeSandbox(async (url, opt) => {
    if (((opt && opt.method) || 'GET') !== 'GET') return { done: true };
    return { v: calls.length };
  });
  await sandbox.api('GET', '/items');
  await sandbox.api('POST', '/items/1/out', { qty: 1 });
  await sandbox.api('GET', '/items');
  const gets = calls.filter((c) => c.method === 'GET').length;
  assert.equal(gets, 2, '写之后必须重新拉，不能吃旧缓存');
});

test('M15.4 同一个请求并发发两次只打一次（连点导航不重复请求）', async () => {
  let resolveFn;
  const gate = new Promise((r) => { resolveFn = r; });
  const { sandbox, calls } = makeSandbox(async () => { await gate; return { ok: 1 }; });
  const p1 = sandbox.api('GET', '/structure');
  const p2 = sandbox.api('GET', '/structure');
  resolveFn();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(calls.length, 1, '并发应合并成一个请求');
  assert.deepEqual(r1, r2);
});

test('M15.5 请求进行中 store.pending 有值，结束后归零（顶栏进度条依据）', async () => {
  let resolveFn;
  const gate = new Promise((r) => { resolveFn = r; });
  const { sandbox } = makeSandbox(async () => { await gate; return {}; });
  assert.equal(sandbox.store.pending, 0);
  const p = sandbox.api('GET', '/stats/meta');
  assert.equal(sandbox.store.pending, 1, '发请求时应 +1');
  resolveFn();
  await p;
  assert.equal(sandbox.store.pending, 0, '结束后应归零');
});

test('M15.6 空间切换不会串数据（缓存 key 带空间）', async () => {
  const { sandbox, calls } = makeSandbox(async () => ({ space: sandbox.store.space.type }));
  sandbox.store.space = { type: 'personal', labId: null };
  const a = await sandbox.api('GET', '/items');
  sandbox.store.space = { type: 'lab', labId: 7 };
  const b = await sandbox.api('GET', '/items');
  assert.equal(calls.length, 2, '换空间必须重新请求');
  assert.equal(a.space, 'personal');
  assert.equal(b.space, 'lab');
});

test('M15.7 每页数据没到齐时都有骨架屏（不是一片空白）', () => {
  const skel = read('public/js/components/PageSkeleton.js');
  assert.ok(/Components\.PageSkeleton/.test(skel), '应注册 PageSkeleton 组件');
  assert.ok(/page-skeleton/.test(skel), '组件名应为 page-skeleton');

  const index = read('public/index.html');
  assert.ok(index.includes('/js/components/PageSkeleton.js'), 'index.html 必须加载骨架屏组件');

  const pages = {
    'public/js/components/Dashboard.js': 'v-if="!ov && !error"',
    'public/js/components/Studio.js': 'v-if="!loaded"',
    'public/js/components/StatsPage.js': 'v-if="!b && !error"',
    // 失败时也要收掉骨架屏（改显示可重试的错误卡片），否则会"永远在转"
    'public/js/components/SettingsPage.js': 'v-if="!cfg && !loadErr"',
  };
  for (const [f, cond] of Object.entries(pages)) {
    const src = read(f);
    assert.ok(src.includes('<page-skeleton'), `${f} 缺少骨架屏`);
    assert.ok(src.includes(cond), `${f} 骨架屏的显示条件不对（应为 ${cond}）`);
  }
});

test('M15.8 点开物品详情立刻有反馈（遮罩 + 加载态），不是点了没反应', () => {
  const src = read('public/js/components/ItemDetail.js');
  assert.ok(/v-if="store\.detailItemId && !item"[\s\S]{0,200}detail-loading/.test(src),
    '详情未到时应先显示遮罩与加载态');
  // 详情与类别表并行请求
  assert.ok(/Promise\.all\(\[\s*api\('GET', '\/items\/' \+ id\)/.test(src), '详情与类别表应并行请求');
});

test('M15.9 设置页三个请求并行，不串行等待', () => {
  const src = read('public/js/components/SettingsPage.js');
  const fn = /async refresh\(\) \{([\s\S]*?)\n    \},/.exec(src);
  assert.ok(fn, '应有 refresh 方法');
  assert.ok(/Promise\.all\(/.test(fn[1]), 'refresh 应用 Promise.all 并行');
  assert.ok(!/await api\('GET', '\/settings'\)[\s\S]{0,80}await api\('GET', '\/system\/info'\)/.test(fn[1]),
    '不应再串行 await 多个 GET');
});

test('M15.10 云端：读接口共享上下文快照，写操作立即失效且不跨空间', () => {
  const src = read('public/js/cloud/tidy-cloud-api.js');
  assert.ok(/function readCtx\(\)/.test(src), '应有读快照');
  assert.ok(/function invalidateReadCtx\(\)/.test(src), '写操作要能让快照失效');
  assert.ok(/if \(method !== 'GET'\) invalidateReadCtx\(\)/.test(src), '非 GET 请求应清快照');
  assert.ok(/readCtxCache\.sig === sig/.test(src), '快照必须校验空间标识，不能跨空间复用');
  for (const fn of ['statsOverview', 'statsBoard', 'statsMeta', 'itemList']) {
    const m = new RegExp('async function ' + fn + '\\([^)]*\\) \\{[\\s\\S]{0,200}?await readCtx\\(\\)').test(src);
    assert.ok(m, `${fn} 应使用读快照`);
  }
});

test('M15.11 卡住时一定有出口：骨架屏超时可以重新加载，加载失败可以重试', () => {
  const skel = read('public/js/components/PageSkeleton.js');
  assert.ok(/setTimeout\(\(\) => \{ this\.slow = true; \}, 8000\)/.test(skel), '骨架屏超过 8 秒应提示慢');
  assert.ok(/retry\(\) \{ location\.reload\(\); \}/.test(skel), '应提供重新加载入口');
  assert.ok(/beforeUnmount\(\) \{ clearTimeout\(this\._t\); \}/.test(skel), '组件销毁要清掉定时器');

  for (const [f, words] of [
    ['public/js/components/Studio.js', ['loadErr', 'finally { this.loaded = true; }', '重试']],
    ['public/js/components/SettingsPage.js', ['loadErr', 'reload()', '重试']],
  ]) {
    const src = read(f);
    for (const w of words) assert.ok(src.includes(w), `${f} 缺少 ${w}`);
  }
});
