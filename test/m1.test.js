// M1 骨架测试：服务启动、静态页、设置切换、四级结构 CRUD（对应 PRD 验收 A1 部分、B2/B3）
const test = require('node:test');
const assert = require('node:assert');
const { startServer, api, stop } = require('./helpers');

test('M1.1 服务启动 + 系统信息 + 静态页', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));

  const info = await api(s.base, 'GET', '/system/info');
  assert.equal(info.status, 200);
  assert.ok(info.json.ok, 'system/info 应成功');
  assert.ok(info.json.data.port > 0);
  assert.ok(Array.isArray(info.json.data.lanUrls));

  const page = await fetch(s.base + '/');
  assert.equal(page.status, 200, '首页应可访问');
  const html = await page.text();
  assert.ok(html.includes('id="app"'), '前端挂载点存在');
  assert.ok(html.includes('liquidFilter'), '液态玻璃滤镜存在');

  const css = await fetch(s.base + '/css/design-tokens.css');
  assert.equal(css.status, 200);
  const vue = await fetch(s.base + '/assets/vue.global.prod.js');
  assert.equal(vue.status, 200, 'Vue 本地文件可访问');
});

test('M1.2 设置：切换 mock 供应商 + Key 打码（F3）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));

  const set = await api(s.base, 'PUT', '/settings', { provider: 'mock', glm: { key: 'sk-test-1234567890abcd' } });
  assert.equal(set.json.data.provider, 'mock');
  assert.ok(set.json.data.glm.key.includes('****'), 'Key 必须打码');
  assert.ok(!JSON.stringify(set.json).includes('sk-test-1234567890abcd'), '明文 Key 不得出现在响应中');

  const get = await api(s.base, 'GET', '/settings');
  assert.ok(get.json.data.glm.key.includes('****'));
});

test('M1.3 四级结构 CRUD（B2/B3）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });

  // 建 区域→柜→层→箱
  const z = await api(s.base, 'POST', '/zones', { name: '区域一' });
  assert.ok(z.json.ok, '建区域: ' + JSON.stringify(z.json));
  const zoneId = z.json.data.id;
  const c = await api(s.base, 'POST', '/cabinets', { parentId: zoneId, name: '1号柜', door: 'double', floor: 1 });
  assert.ok(c.json.ok, '建柜: ' + JSON.stringify(c.json));
  const cabId = c.json.data.id;
  const sh = await api(s.base, 'POST', '/shelves', { parentId: cabId, name: '格位1', kind: 'shelf' });
  assert.ok(sh.json.ok);
  const shelfId = sh.json.data.id;
  const bx = await api(s.base, 'POST', '/boxes', { parentId: shelfId, name: '防静电零件盒A' });
  assert.ok(bx.json.ok);
  const boxId = bx.json.data.id;

  // 树形状（柜子创建时自动带一个默认层“第1层”，加上测试显式创建的“格位1”共 2 层）
  const tree = (await api(s.base, 'GET', '/structure')).json.data;
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, '区域一');
  assert.equal(tree[0].floors.length, 1);
  assert.equal(tree[0].floors[0].cabinets.length, 1);
  assert.equal(tree[0].floors[0].cabinets[0].door, 'double');
  const cabs0 = tree[0].floors[0].cabinets[0];
  assert.equal(cabs0.shelves.length, 2, '柜子应含默认层 + 显式创建的层');
  const gewei = cabs0.shelves.find((x) => x.name === '格位1');
  assert.ok(gewei, '显式创建的层存在');
  assert.equal(gewei.boxes.length, 1);

  // 重命名
  const rn = await api(s.base, 'PATCH', '/boxes/' + boxId, { name: '零件盒B' });
  assert.ok(rn.json.ok);
  const tree2 = (await api(s.base, 'GET', '/structure')).json.data;
  const gewei2 = tree2[0].floors[0].cabinets[0].shelves.find((x) => x.name === '格位1');
  assert.equal(gewei2.boxes[0].name, '零件盒B');

  // 门型校验
  const bad = await api(s.base, 'POST', '/cabinets', { parentId: zoneId, name: 'x柜', door: 'triple' });
  assert.equal(bad.status, 400, '非法门型应 400');

  // 无库存 → 删除柜子成功（级联层与箱）
  const del = await api(s.base, 'DELETE', '/cabinets/' + cabId);
  assert.ok(del.json.ok, '无库存删除应成功: ' + JSON.stringify(del.json));
  const tree3 = (await api(s.base, 'GET', '/structure')).json.data;
  assert.equal(tree3[0].floors.length, 0, '柜子删除后楼层应为空');
});

test('M1.4 有库存的容器不可删除', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });

  const z = (await api(s.base, 'POST', '/zones', { name: 'Z' })).json.data.id;
  const c = (await api(s.base, 'POST', '/cabinets', { parentId: z, name: 'C', door: 'single', floor: 1 })).json.data.id;
  const sh = (await api(s.base, 'POST', '/shelves', { parentId: c, name: 'S', kind: 'shelf' })).json.data.id;

  // 直接构造一条物品+存放（用 mock 识别流程外的方式：先建队列再确认太绕，这里用 confirm 的最小路径）
  const fd = new FormData();
  fd.append('image', new Blob([require('./helpers').tinyPng()], { type: 'image/png' }), 't.png');
  fd.append('mode', 'single');
  const an = await api(s.base, 'POST', '/intake/analyze', fd);
  assert.ok(an.json.ok, 'mock 识别应成功: ' + JSON.stringify(an.json));
  const qid = an.json.data.id;
  const cf = await api(s.base, 'POST', '/intake/confirm', {
    queueId: qid, index: 0, name: '测试物品', qty: 3, shelfId: sh, boxId: null,
  });
  assert.ok(cf.json.ok, '确认入库应成功: ' + JSON.stringify(cf.json));

  const del = await api(s.base, 'DELETE', '/shelves/' + sh);
  assert.equal(del.status, 400, '有库存的层不可删除');
  assert.ok(del.json.error.includes('库存'), '错误信息应提示库存');
});
