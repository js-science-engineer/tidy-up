// M7 测试：云端化 —— 共享纯逻辑单测 + 服务端 AI 辅助路由 + 云模式标记
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const T = require('../public/js/cloud/tidy-shared.js');
const { startServer, api, stop, tinyPng } = require('./helpers');

// ---------- 测试数据（镜像 SQLite 语义的字段形状） ----------
function sampleState() {
  return {
    zones: [{ id: 1, name: '区域一', sort: 1, created_at: '2026-10-05 10:00:00' }],
    cabinets: [{ id: 10, zone_id: 1, name: '1号柜', door: 'double', floor: 1, sort: 1, photo: null }],
    shelves: [
      { id: 100, cabinet_id: 10, name: '第1层', kind: 'shelf', sort: 1 },
      { id: 101, cabinet_id: 10, name: '工具抽屉', kind: 'drawer', sort: 2 },
    ],
    boxes: [{ id: 1000, shelf_id: 100, name: '零件盒', color: null, sort: 1 }],
    categories: [{ id: 3, name: '仪器设备', is_preset: 1 }, { id: 6, name: '工具', is_preset: 1 }],
    items: [{ id: 5, name: '万用表', aliases: '[]', category_id: 3, size_class: 'M', note: null }],
    placements: [
      { id: 50, item_id: 5, shelf_id: 100, box_id: null, qty: 2 },
      { id: 51, item_id: 5, shelf_id: null, box_id: 1000, qty: 1 },
    ],
  };
}
function fullState() {
  const s = sampleState();
  const nameOf = new Map(s.items.map((i) => [i.id, i.name]));
  s.placementsFull = s.placements.map((p) => ({ ...p, item_name: nameOf.get(p.item_id), img: null }));
  return s;
}

// ---------- A. 共享纯逻辑 ----------
test('M7.1 buildTree：四级树 + 占用状态（与 lib.getTree 行为一致）', () => {
  const s = fullState();
  const tree = T.buildTree({ zones: s.zones, cabinets: s.cabinets, shelves: s.shelves, boxes: s.boxes, placements: s.placementsFull });
  assert.equal(tree.length, 1);
  const cab = tree[0].floors[0].cabinets[0];
  assert.equal(cab.name, '1号柜');
  assert.equal(cab.occupancy, 50, '仅第1层满（工具抽屉空）→ 满层占比 1/2');
  assert.equal(cab.shelves.length, 2);
  const shelf = cab.shelves.find((x) => x.id === 100);
  assert.equal(shelf.state, 'full');
  assert.equal(shelf.items[0].item_name, '万用表', '树上的存放记录带联接的 item_name');
  assert.equal(shelf.items[0].qty, 2);
});

test('M7.2 locationPathFrom：箱/层两种路径', () => {
  const maps = T.buildMaps(fullState());
  assert.deepEqual(T.locationPathFrom(maps, null, 1000), ['区域一', '1号柜', '第1层', '零件盒']);
  assert.deepEqual(T.locationPathFrom(maps, 101, null), ['区域一', '1号柜', '工具抽屉']);
  assert.deepEqual(T.locationPathFrom(maps, null, 9999), []);
});

test('M7.3 nextSortOf：最大 sort + 1', () => {
  assert.equal(T.nextSortOf([{ sort: 1 }, { sort: 3 }, { sort: 2 }]), 4);
  assert.equal(T.nextSortOf([]), 1);
});

test('M7.4 subtreeContainerIds + countInventory：删除保护数据', () => {
  const s = sampleState();
  const ids = T.subtreeContainerIds(s, 'zones', 1);
  assert.deepEqual(ids, { shelfIds: [100, 101], boxIds: [1000] });
  assert.equal(T.countInventory(s.placements, ids), 2, '2 条库存记录（记录数，非件数）');
  assert.equal(T.countInventory(s.placements.filter((p) => p.id === 50), ids), 1);
});

test('M7.5 categoryDistOf：种类数 + 库存件数', () => {
  const s = fullState();
  const dist = T.categoryDistOf(s.items, s.placements, s.categories);
  assert.equal(dist.length, 1);
  assert.equal(dist[0].name, '仪器设备');
  assert.equal(dist[0].kinds, 1);
  assert.equal(dist[0].qty, 3);
});

test('M7.6 suggestLocation：容器名关键词匹配 + 占用规则', () => {
  const s = fullState();
  const sug = T.suggestLocation(s, '工具');
  assert.equal(sug.shelfId, 101, '「工具抽屉」命中关键词 + 空间充足 → 最优');
  assert.ok(sug.reason.includes('理由'));
  const none = T.suggestLocation({ shelves: [], boxes: [], placements: [], items: [], categories: [] }, '工具');
  assert.ok(none.reason.includes('还没有任何柜子'));
});

test('M7.7 zoneView / shelfView：前端可视化形状', () => {
  const s = fullState();
  const tree = T.buildTree({ zones: s.zones, cabinets: s.cabinets, shelves: s.shelves, boxes: s.boxes, placements: s.placementsFull });
  const z = T.zoneView(tree[0]);
  assert.equal(z.cabinetCount, 1);
  assert.equal(z.itemQty, 3);
  const shelf = z.cabinets[0].shelves.find((x) => x.id === 100);
  assert.equal(shelf.total, 3, '层 total = 层上直放 2 件 + 箱内 1 件');
  assert.equal(shelf.items.length, 2, '两条明细：直放 + 箱内');
  assert.deepEqual(shelf.items[0], { id: 5, placementId: 50, name: '万用表', qty: 2, img: null, box: null, boxId: null });
  assert.equal(shelf.items[1].box, '零件盒');
});

// ---------- B. 服务端：/ai/semantic-search + analyze-json + system/info ----------
test('M7.8 语义搜索 AI 路由（mock）：匹配排序 + 参数校验', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });

  const ok1 = await api(s.base, 'POST', '/ai/semantic-search', {
    query: '万用', candidates: [{ id: 1, name: '万用表', aliases: ['multimeter'], category: '仪器设备' }],
  });
  assert.equal(ok1.status, 200);
  assert.equal(ok1.json.data.matches.length, 1);
  assert.equal(ok1.json.data.matches[0].id, 1);
  assert.ok(ok1.json.data.matches[0].score > 0);

  const bad = await api(s.base, 'POST', '/ai/semantic-search', { query: '', candidates: [] });
  assert.equal(bad.status, 400, '空 query 应 400');
});

test('M7.9 语义搜索限流：第 31 次 429', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });
  const body = { query: '万用', candidates: [{ id: 1, name: '万用表', aliases: [], category: '仪器设备' }] };
  let last;
  for (let i = 0; i < 31; i++) last = await api(s.base, 'POST', '/ai/semantic-search', body);
  assert.equal(last.status, 429, '超出限流应 429');
});

test('M7.10 识别 JSON 变体（云端用）：不落盘直接返回 rec', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });
  const r = await api(s.base, 'POST', '/intake/analyze-json', {
    mode: 'single', imageBase64: tinyPng().toString('base64'), mime: 'image/png',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.rec.items.length, 1);
  assert.ok(r.json.data.rec.items[0].name.includes('STM32'));
  const bad = await api(s.base, 'POST', '/intake/analyze-json', { mode: 'single' });
  assert.equal(bad.status, 400, '缺 imageBase64 应 400');
});

test('M7.11 system/info：版本号与云模式标记（本地默认 false）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const info = (await api(s.base, 'GET', '/system/info')).json.data;
  assert.equal(info.version, '0.7.0');
  assert.equal(info.cloud, false, '本地开发未设 TIDY_CLOUD 应为 false');
});

test('M7.12 system/info：TIDY_CLOUD=1 时返回云配置', async (t) => {
  const dataDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tidy-cloud-'));
  const proc = spawn(process.env.NODE_EXE || process.execPath,
    ['server/index.js'], {
      cwd: require('path').join(__dirname, '..'),
      env: { ...process.env, PORT: '0', TIDY_DATA_DIR: dataDir, TIDY_CLOUD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  try {
    let port = 0;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const m = /TidyLab listening on http:\/\/localhost:(\d+)/.exec(out);
      if (m) { port = Number(m[1]); break; }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert.ok(port, '云模式服务应能启动');
    const r = await fetch(`http://127.0.0.1:${port}/api/system/info`);
    const j = await r.json();
    assert.equal(j.data.cloud.endpoint, 'https://tidylab.app.workbuddy.host');
    assert.ok(String(j.data.cloud.publishableKey).startsWith('wbpk_'));
  } finally {
    stop(proc);
  }
});

// ---------- M7.13 recognizer：类别白名单回落 + 结果规范化 ----------
test('M7.13 recognizer.analyze：类别白名单 / 字段规范化 / 批量 bbox', async () => {
  const { analyze } = require('../server/services/recognizer.js');
  const provider = {
    async chat() {
      return JSON.stringify({
        items: [
          { name: '杜邦线', aliases: ['跳线'], category: '零食', size: 'XL', confidence: 2.2, bbox: [10, '20', 300.4, 400] },
          { name: '', category: '工具', confidence: NaN },
        ],
        webQuery: 'dupont wire',
      });
    },
  };
  const rec = await analyze(provider, { mode: 'batch', imageBase64: 'aGk=', mime: 'image/png' });
  assert.equal(rec.items.length, 2);
  assert.equal(rec.items[0].category, '其他', '列表外类别必须回落"其他"');
  assert.equal(rec.items[0].size, 'S', '非法 size 回落 S');
  assert.equal(rec.items[0].confidence, 1, '越界 confidence 钳制到 [0,1]（2.2→1）');
  assert.deepEqual(rec.items[0].bbox, [10, 20, 300.4, 400], 'bbox 全部数值化');
  assert.equal(rec.items[1].name, '未知物品', '空 name 回落未知物品');
  assert.equal(rec.items[1].category, '工具', '合法类别保留');
  assert.equal(rec.webQuery, 'dupont wire');
});
