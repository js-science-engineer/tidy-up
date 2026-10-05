// M5 测试：备份/恢复（F1/F2）+ 容错边界（C6/未知实体）+ 全链路回归
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, api, stop, tinyPng } = require('./helpers');

async function intakeItem(s, name, shelfId, qty = 1) {
  const fd = new FormData();
  fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), 'p.png');
  fd.append('mode', 'single');
  const an = (await api(s.base, 'POST', '/intake/analyze', fd)).json.data;
  const cf = await api(s.base, 'POST', '/intake/confirm', {
    queueId: an.id, index: 0, name, category: '工具', qty, shelfId, boxId: null, mainImage: 'user',
  });
  assert.ok(cf.json.ok, '入库应成功: ' + JSON.stringify(cf.json));
  return cf.json.data.itemId;
}

async function buildStructure(s) {
  const zone = (await api(s.base, 'POST', '/zones', { name: '区域一' })).json.data.id;
  const cab = (await api(s.base, 'POST', '/cabinets', { parentId: zone, name: '1号柜', door: 'double', floor: 1 })).json.data.id;
  const shelf = (await api(s.base, 'POST', '/shelves', { parentId: cab, name: '第1层', kind: 'shelf' })).json.data.id;
  return { zone, cab, shelf };
}

test('M5.1 手动备份 + 备份列表（F1）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });
  const ids = await buildStructure(s);
  await intakeItem(s, '螺丝刀套装', ids.shelf, 2);

  const b = await api(s.base, 'POST', '/backup');
  assert.ok(b.json.ok, '备份应成功: ' + JSON.stringify(b.json));
  const zipPath = path.join(s.backupDir, b.json.data.file);
  assert.ok(fs.existsSync(zipPath), '备份 zip 应存在');
  assert.ok(fs.statSync(zipPath).size > 0, '备份不能为空');
  assert.equal(b.json.data.backups.length >= 1, true);

  // 重复备份 → 列表增长
  await api(s.base, 'POST', '/backup');
  const list = (await api(s.base, 'GET', '/backup/list')).json.data;
  assert.ok(list.length >= 2);
});

test('M5.2 启动自动备份：当天无备份则自动生成一次（F1）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  // 等待启动后异步自动备份完成
  await new Promise((r) => setTimeout(r, 1500));
  const list = (await api(s.base, 'GET', '/backup/list')).json.data;
  assert.ok(list.length >= 1, '启动应自动产生 1 份备份');
});

test('M5.3 恢复流程：备份 → 继续变化 → 恢复 → 重启后数据一致（F2）', async (t) => {
  const s1 = await startServer();
  t.after(() => stop(s1.proc));
  await api(s1.base, 'PUT', '/settings', { provider: 'mock' });
  const ids = await buildStructure(s1);
  const itemA = await intakeItem(s1, '万用表A', ids.shelf, 3);

  // 备份（此时只有 1 件物品）
  const b = (await api(s1.base, 'POST', '/backup')).json.data;
  const backupFile = b.file;

  // 备份后继续变化：再入 1 件
  await intakeItem(s1, '后来的新物品', ids.shelf, 5);
  let list = (await api(s1.base, 'GET', '/items')).json.data;
  assert.equal(list.length, 2, '恢复前应有 2 件');

  // 恢复（应先做应急备份，然后要求重启）
  const r = await api(s1.base, 'POST', '/backup/restore', { file: backupFile });
  assert.ok(r.json.ok, '恢复应成功: ' + JSON.stringify(r.json));
  assert.equal(r.json.data.needRestart, true);
  assert.ok(r.json.data.emergencyBackup, '恢复前应有应急备份');
  stop(s1.proc);
  await new Promise((r2) => setTimeout(r2, 800));

  // 重启（同一数据目录）→ 数据应回到备份时点
  const s2 = await startServer({ dataDir: s1.dataDir, backupDir: s1.backupDir });
  t.after(() => stop(s2.proc));
  list = (await api(s2.base, 'GET', '/items')).json.data;
  assert.equal(list.length, 1, '恢复后应只剩备份时的 1 件');
  assert.equal(list[0].name, '万用表A');
  assert.equal(list[0].totalQty, 3);
  // 图片也应恢复
  const detail = (await api(s2.base, 'GET', '/items/' + list[0].id)).json.data;
  const userImg = detail.images.find((i) => i.source === 'user');
  if (userImg && !/^https?:/.test(userImg.file)) {
    const imgResp = await fetch(s2.base + '/' + userImg.file);
    assert.equal(imgResp.status, 200, '恢复后的图片文件应可访问');
  }
});

test('M5.4 边界与容错：未知实体 404 / 非法备份名 400 / 非法端口 400', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));

  const unknown = await api(s.base, 'POST', '/notcenter', { name: 'x' });
  assert.equal(unknown.status, 404, '未知实体应 404');

  const badRestore = await api(s.base, 'POST', '/backup/restore', { file: '../../evil.zip' });
  assert.equal(badRestore.status, 400, '非法备份文件名应 400');

  const badPort = await api(s.base, 'PUT', '/settings', { port: 80 });
  assert.equal(badPort.status, 400, '非法端口应 400');

  const notFound = await api(s.base, 'GET', '/items/99999');
  assert.equal(notFound.status, 404, '不存在的物品应 404');
});

test('M5.5 全链路回归：生成→入库→出库→搜索→首页→备份', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });

  // 1. AI 生成结构
  const gen = (await api(s.base, 'POST', '/structure/generate', {
    text: '两层。第一层 5 个柜子：1 个双开门 + 4 个单开门。第二层 3 个柜子，都是双开门。',
  })).json.data;
  const ap = (await api(s.base, 'POST', '/structure/apply', gen)).json.data;
  const tree = (await api(s.base, 'GET', '/structure')).json.data;
  const shelf = tree[0].floors[0].cabinets[0].shelves[0];

  // 2. 识别入库
  const fd = new FormData();
  fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), 'p.png');
  fd.append('mode', 'single');
  const an = (await api(s.base, 'POST', '/intake/analyze', fd)).json.data;
  const cf = (await api(s.base, 'POST', '/intake/confirm', {
    queueId: an.id, index: 0, name: 'STM32F103C8T6 最小系统板', qty: 2,
    shelfId: shelf.id, boxId: null, mainImage: 'user',
  })).json.data;
  assert.ok(cf.itemId);

  // 3. 出库 1 件
  const detail = (await api(s.base, 'GET', '/items/' + cf.itemId)).json.data;
  const out = await api(s.base, 'POST', `/items/${cf.itemId}/out`, { placementId: detail.placements[0].id, qty: 1 });
  assert.equal(out.json.data.remain, 1);

  // 4. 搜索
  const sr = (await api(s.base, 'GET', '/search?q=STM32&mode=exact')).json.data;
  assert.equal(sr.results.length, 1);
  assert.equal(sr.results[0].totalQty, 1);

  // 5. 首页
  const ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
  assert.equal(ov.stats.itemCount, 1);
  assert.equal(ov.stats.todayIn, 2);

  // 6. 备份
  const b = (await api(s.base, 'POST', '/backup')).json.data;
  assert.ok(b.file);
});
