// M2 测试：AI 对话生成结构 + 应用（对应 PRD 验收 B1）
const test = require('node:test');
const assert = require('node:assert');
const { startServer, api, stop } = require('./helpers');

const EXAMPLE = '两层。第一层 5 个柜子：1 个双开门 + 4 个单开门。第二层 3 个柜子，都是双开门。';

test('M2.1 AI 生成结构预览（B1）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });

  const r = await api(s.base, 'POST', '/structure/generate', { text: EXAMPLE });
  assert.ok(r.json.ok, '生成应成功: ' + JSON.stringify(r.json));
  const tree = r.json.data;
  assert.equal(tree.zoneName, '区域一');
  assert.equal(tree.floors.length, 2, '应为两层');
  assert.equal(tree.floors[0].cabinets.length, 5, '第一层 5 柜');
  assert.equal(tree.floors[1].cabinets.length, 3, '第二层 3 柜');
  const doors1 = tree.floors[0].cabinets.map((c) => c.door);
  assert.equal(doors1.filter((d) => d === 'double').length, 1, '第一层 1 个双开门');
  assert.equal(doors1.filter((d) => d === 'single').length, 4, '第一层 4 个单开门');
  assert.ok(tree.floors[1].cabinets.every((c) => c.door === 'double'), '第二层全部双开门');
  // 自动编号连续
  const names = tree.floors.flatMap((f) => f.cabinets.map((c) => c.name));
  assert.deepEqual(names, ['1号柜','2号柜','3号柜','4号柜','5号柜','6号柜','7号柜','8号柜']);
});

test('M2.2 应用结构入库 + GET /structure 可查（B1）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });

  const gen = (await api(s.base, 'POST', '/structure/generate', { text: EXAMPLE })).json.data;
  const ap = await api(s.base, 'POST', '/structure/apply', gen);
  assert.ok(ap.json.ok, '应用应成功: ' + JSON.stringify(ap.json));

  const tree = (await api(s.base, 'GET', '/structure')).json.data;
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, '区域一');
  const cabs = tree[0].floors.flatMap((f) => f.cabinets);
  assert.equal(cabs.length, 8, '共 8 柜');
  assert.ok(cabs.every((c) => c.shelves.length >= 1), '每个柜子至少一个格位');
  assert.ok(cabs.every((c) => c.occupancy === 0), '新柜占用 0%');

  // 无意义描述应报错而非崩溃
  const bad = await api(s.base, 'POST', '/structure/generate', { text: '随便说点什么' });
  assert.equal(bad.status, 400, '无法解析的描述应 400');
});

test('M2.3 编辑链路：柜子改名/换门型 → 加抽屉 → 加箱子 → 删除区域', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });

  const gen = (await api(s.base, 'POST', '/structure/generate', { text: EXAMPLE })).json.data;
  const ap = (await api(s.base, 'POST', '/structure/apply', gen)).json.data;
  const tree0 = (await api(s.base, 'GET', '/structure')).json.data;
  const cab1 = tree0[0].floors[0].cabinets[0];

  const rn = await api(s.base, 'PATCH', '/cabinets/' + cab1.id, { name: '主柜', door: 'drawer' });
  assert.ok(rn.json.ok);
  let tree = rn.json.data.tree;
  assert.equal(tree[0].floors[0].cabinets[0].name, '主柜');
  assert.equal(tree[0].floors[0].cabinets[0].door, 'drawer');

  const sh = (await api(s.base, 'POST', '/shelves', { parentId: cab1.id, name: '抽屉1', kind: 'drawer' })).json.data;
  const bx = (await api(s.base, 'POST', '/boxes', { parentId: sh.id, name: '零件盒', color: '#5b9bfc' })).json.data;
  assert.ok(sh.id && bx.id);
  tree = (await api(s.base, 'GET', '/structure')).json.data;
  const cab = tree[0].floors[0].cabinets.find((c) => c.id === cab1.id);
  assert.equal(cab.shelves.length, 2, '原 1 格位 + 新抽屉');
  assert.equal(cab.shelves[1].boxes.length, 1);

  const del = await api(s.base, 'DELETE', '/zones/' + ap.zoneId);
  assert.ok(del.json.ok, '空区域可整体删除');
  const treeEnd = (await api(s.base, 'GET', '/structure')).json.data;
  assert.equal(treeEnd.length, 0);
});
