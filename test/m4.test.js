// M4 测试：搜索（E1/E2）+ 首页聚合（A2/B4 数据面）+ 移位
const test = require('node:test');
const assert = require('node:assert');
const { startServer, api, stop, tinyPng } = require('./helpers');

async function setupWithData(s) {
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });
  const zone = (await api(s.base, 'POST', '/zones', { name: '实验区' })).json.data.id;
  const zone2 = (await api(s.base, 'POST', '/zones', { name: '储物区' })).json.data.id;
  const cab = (await api(s.base, 'POST', '/cabinets', { parentId: zone, name: '1号柜', door: 'double', floor: 1 })).json.data.id;
  const cab2 = (await api(s.base, 'POST', '/cabinets', { parentId: zone2, name: '9号柜', door: 'single', floor: 1 })).json.data.id;
  const sh1 = (await api(s.base, 'POST', '/shelves', { parentId: cab, name: '第1层', kind: 'shelf' })).json.data.id;
  const sh2 = (await api(s.base, 'POST', '/shelves', { parentId: cab2, name: '第1层', kind: 'shelf' })).json.data.id;

  async function intake(name, category, qty, shelfId) {
    const fd = new FormData();
    fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), 'p.png');
    fd.append('mode', 'single');
    const an = (await api(s.base, 'POST', '/intake/analyze', fd)).json.data;
    const cf = await api(s.base, 'POST', '/intake/confirm', {
      queueId: an.id, index: 0, name, category, qty, shelfId, boxId: null, mainImage: 'user',
    });
    assert.ok(cf.json.ok, '入库应成功: ' + JSON.stringify(cf.json));
    return cf.json.data.itemId;
  }

  const stm = await intake('STM32F103C8T6 最小系统板', '开发板/模块', 3, sh1);
  await intake('STM32F407 探索者开发板', '开发板/模块', 1, sh2);
  const multimeter = await intake('数字万用表（黄色外壳）', '仪器设备', 2, sh2);
  return { zone, zone2, cab, cab2, sh1, sh2, stm, multimeter };
}

test('M4.1 精确搜索（E1）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await setupWithData(s);

  const r = await api(s.base, 'GET', '/search?q=STM32&mode=exact');
  assert.ok(r.json.ok);
  const results = r.json.data.results;
  assert.equal(results.length, 2, 'STM32 应命中两块板');
  const first = results.find((x) => x.name.includes('F103'));
  assert.ok(first, '应包含 F103');
  assert.equal(first.totalQty, 3);
  assert.ok(first.placements[0].path.includes('1号柜'), '位置路径正确');

  // 别名命中：Blue Pill 是 F103 的别名
  const byAlias = await api(s.base, 'GET', '/search?q=Blue%20Pill&mode=exact');
  // mock 未给 F407 别名，别名搜索走 aliases 字段
  assert.ok(byAlias.json.ok);
});

test('M4.2 语义搜索 + 降级（E2）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await setupWithData(s);

  // mock 语义：查询词与名称互含 → 万用表
  const r = await api(s.base, 'GET', '/search?q=万用表&mode=semantic');
  assert.ok(r.json.ok);
  assert.equal(r.json.data.mode, 'semantic');
  assert.ok(r.json.data.results.length >= 1, '应返回语义候选');
  assert.equal(r.json.data.results[0].name, '数字万用表（黄色外壳）');
  assert.ok(r.json.data.results[0].matchScore >= 90);
});

test('M4.3 首页聚合（A2 数据面 / 今日计划）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setupWithData(s);

  const ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
  assert.equal(ov.stats.itemCount, 3);
  assert.equal(ov.stats.zoneCount, 2);
  assert.equal(ov.stats.cabinetCount, 2);
  assert.equal(ov.stats.todayIn, 6, '今日入库数量 = 3+1+2');
  assert.ok(ov.categoryDist.length >= 2, '首页应返回分类分布');
  assert.ok(ov.categoryDist.some((c) => c.name === '开发板/模块' && c.qty === 4), '分类分布件数应正确');

  // 空间总览：两个区域、柜子带占用，且能看到柜内物品明细（v1.2 可视化）
  assert.equal(ov.zones.length, 2);
  const z1 = ov.zones.find((z) => z.name === '实验区');
  assert.ok(z1.cabinets.length >= 1, '区域应包含柜子');
  const shelves = z1.cabinets.flatMap((c) => c.shelves);
  assert.ok(shelves.length >= 1, '柜子应包含层');
  // 柜子创建时自动带一个默认层（空），因此有库存的层应使 shelves 中出现 full 状态
  assert.ok(shelves.some((c) => c.state === 'full'), '有库存的柜子应存在 full 状态的层');
  const stocked = shelves.flatMap((s) => s.items);
  assert.ok(stocked.length >= 1, '总览必须能看到柜内物品明细');
  assert.ok(stocked.some((i) => i.name.includes('STM32') && i.qty === 3), '柜内物品应带名称与数量');
  assert.ok(z1.itemQty === 3, '区域在库件数应统计正确');

  // 今日计划：入库流水
  assert.equal(ov.todayPlan.pendingQueue.length, 0);
  assert.equal(ov.todayPlan.todayLogs.length, 3);

  // 制造一条待确认队列
  const fd = new FormData();
  fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), 'p.png');
  fd.append('mode', 'single');
  await api(s.base, 'POST', '/intake/analyze', fd);
  const ov2 = (await api(s.base, 'GET', '/stats/overview')).json.data;
  assert.equal(ov2.todayPlan.pendingQueue.length, 1, '待确认队列应出现在今日计划');

  // 最近入库
  assert.ok(ov2.recent.length >= 3);
  assert.ok(ov2.recent[0].name.length > 0);
});

test('M4.4 元数据接口（分类+结构树）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await setupWithData(s);
  const meta = (await api(s.base, 'GET', '/stats/meta')).json.data;
  assert.ok(meta.categories.includes('开发板/模块'));
  assert.equal(meta.categories.length, 11, '11 个预设分类');
  assert.equal(meta.zones.length, 2);
});

test('M4.5 移位（move）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setupWithData(s);
  const detail = (await api(s.base, 'GET', '/items/' + ids.stm)).json.data;
  const p = detail.placements[0];
  const mv = await api(s.base, 'POST', `/items/${ids.stm}/move`, { placementId: p.id, shelfId: ids.sh2, boxId: null });
  assert.ok(mv.json.ok, '移位应成功: ' + JSON.stringify(mv.json));
  assert.ok(mv.json.data.location.includes('9号柜'));
  const after = (await api(s.base, 'GET', '/items/' + ids.stm)).json.data;
  assert.ok(after.placements[0].path.includes('储物区'));
  assert.ok(after.logs.some((l) => l.action === 'move'), '应有移位流水');
});

test('M4.6 入库后随时改名（修正识别失误）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setupWithData(s);

  // 改名 + 改类别 + 别名
  const rn = await api(s.base, 'PATCH', '/items/' + ids.stm, {
    name: 'STM32F103C8T6 开发板（蓝板）', category: '开发板/模块',
    aliases: ['Blue Pill', '蓝色小板'], note: '识别修正',
  });
  assert.ok(rn.json.ok, '改名应成功: ' + JSON.stringify(rn.json));
  assert.equal(rn.json.data.name, 'STM32F103C8T6 开发板（蓝板）');

  // 详情与库存不受影响
  const d = (await api(s.base, 'GET', '/items/' + ids.stm)).json.data;
  assert.equal(d.name, 'STM32F103C8T6 开发板（蓝板）');
  assert.equal(d.placements.reduce((n, p) => n + p.qty, 0), 3, '改名不影响数量');
  assert.ok(d.logs.some((l) => l.action === 'edit'), '应留下修正流水');

  // 搜索能命中新名字与新别名
  const r1 = await api(s.base, 'GET', '/search?q=' + encodeURIComponent('蓝板') + '&mode=exact');
  assert.equal(r1.json.data.results.length, 1, '按新名称应能搜到');
  assert.equal(r1.json.data.results[0].id, ids.stm);
  const r2 = await api(s.base, 'GET', '/search?q=' + encodeURIComponent('蓝色小板') + '&mode=exact');
  assert.ok(r2.json.data.results.some((x) => x.id === ids.stm), '按新别名应能搜到该物品');
  assert.ok(d.aliases.includes('蓝色小板') && d.aliases.includes('Blue Pill'), '别名应已更新');

  // 总览/柜内可视化立刻显示新名字
  const ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
  const names = ov.zones.flatMap((z) => z.cabinets).flatMap((c) => c.shelves).flatMap((sh) => sh.items).map((i) => i.name);
  assert.ok(names.some((n) => n.includes('蓝板')), '总览应显示新名称');

  // 空名称拒绝
  const bad = await api(s.base, 'PATCH', '/items/' + ids.stm, { name: '   ' });
  assert.equal(bad.json.ok, false, '空名称应被拒绝');

  // 重名冲突拒绝（已存在同名物品）
  const dup = await api(s.base, 'PATCH', '/items/' + ids.stm, { name: '数字万用表（黄色外壳）' });
  assert.equal(dup.json.ok, false, '重名应被拒绝');
});

test('M4.7 统计看板汇总数据（分类/占用/TOP/趋势）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await setupWithData(s);

  const b = (await api(s.base, 'GET', '/stats/board')).json.data;
  assert.equal(b.totals.items, 3);
  assert.equal(b.totals.zoneCount === undefined ? b.totals.zones : b.totals.zones, 2);
  assert.equal(b.totals.cabinets, 2);
  assert.ok(b.totals.shelves >= 2);
  assert.equal(b.totals.inStock, 6, '在库件数 = 3+1+2');

  assert.ok(b.categoryDist.some((c) => c.name === '开发板/模块' && c.qty === 4), '分类分布应含开发板/模块 4 件');
  assert.equal(b.zoneOccupancy.length, 2);
  assert.equal(b.zoneOccupancy[0].qty >= b.zoneOccupancy[1].qty, true, '区域占用按件数降序');
  assert.equal(b.topItems[0].qty, 3, '库存 TOP1 应为 3 件的 STM32');
  assert.equal(b.topItems[0].spots, 1, '应给出存放位置数量');
  assert.equal(b.trend.length, 7, '趋势应为近 7 天');
  const today = b.trend[6];
  assert.equal(today.inQty, 6, '今日入库应计入趋势');
  assert.ok(today.label.includes('/'), '趋势应有日期标签');
});

test('M4.8 总览柜内物品带 placementId，可据此拖拽移位（v1.3）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setupWithData(s);

  // 总览柜内明细必须携带 placementId，前端拖拽才能定位到具体存放记录（同一物品多位置各一份）
  let ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
  const z1 = ov.zones.find((z) => z.name === '实验区');
  const shelf = z1.cabinets.flatMap((c) => c.shelves).find((x) => x.items.length);
  assert.ok(shelf, '总览应能看到有物品的层');
  const chip = shelf.items.find((i) => i.name.includes('STM32') && i.qty === 3);
  assert.ok(chip, '总览应能看到 STM32 芯片');
  assert.ok(Number.isInteger(chip.placementId) && chip.placementId > 0, '柜内物品应带 placementId');
  assert.equal(chip.boxId, null, '层内直接摆放的物品 boxId 应为 null');

  // 模拟"把该芯片拖到另一层的柜子"：用总览给出的 placementId 调 move
  const mv = await api(s.base, 'POST', `/items/${chip.id}/move`, { placementId: chip.placementId, shelfId: ids.sh2, boxId: null });
  assert.ok(mv.json.ok, '拖拽移位应成功: ' + JSON.stringify(mv.json));
  assert.ok(mv.json.data.location.includes('9号柜'), '返回的落点应为目标柜');

  // 总览刷新：原层不再有这条存放记录，目标区域出现
  ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
  const allChips = (zoneName) => ov.zones.find((z) => z.name === zoneName).cabinets.flatMap((c) => c.shelves).flatMap((x) => x.items);
  assert.equal(allChips('实验区').some((i) => i.placementId === chip.placementId), false, '原层不应再有该存放记录');
  assert.equal(allChips('储物区').some((i) => i.placementId === chip.placementId), true, '目标层应出现该存放记录');
  assert.equal(allChips('储物区').find((i) => i.placementId === chip.placementId).qty, 3, '移位后数量不变');

  // 移位流水
  const d = (await api(s.base, 'GET', '/items/' + chip.id)).json.data;
  assert.ok(d.logs.some((l) => l.action === 'move'), '应留下移位流水');
  assert.equal(d.placements.reduce((n, p) => n + p.qty, 0), 3, '总库存不受移位影响');
});

test('M4.9 拖拽移位非法落点被拒绝（v1.3）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setupWithData(s);
  const ov = (await api(s.base, 'GET', '/stats/overview')).json.data;
  const chip = ov.zones.flatMap((z) => z.cabinets).flatMap((c) => c.shelves).flatMap((x) => x.items).find((i) => i.name.includes('STM32'));

  // 不存在的层 → 404，且物品位置不变
  const bad = await api(s.base, 'POST', `/items/${chip.id}/move`, { placementId: chip.placementId, shelfId: 999999, boxId: null });
  assert.equal(bad.json.ok, false, '目标层不存在应被拒绝');
  assert.equal(bad.status, 404);
  const d = (await api(s.base, 'GET', '/items/' + chip.id)).json.data;
  assert.ok(d.placements[0].path.includes('1号柜'), '失败的移位不应改变原位置');

  // 目标位置为空 → 400
  const empty = await api(s.base, 'POST', `/items/${chip.id}/move`, { placementId: chip.placementId });
  assert.equal(empty.json.ok, false, '未指定目标位置应被拒绝');
  assert.equal(empty.status, 400);

  // 找不到存放记录 → 404
  const noP = await api(s.base, 'POST', `/items/${chip.id}/move`, { placementId: 999999, shelfId: ids.sh2 });
  assert.equal(noP.json.ok, false, '存放记录不存在应被拒绝');
  assert.equal(noP.status, 404);
});

// v1.5：收纳空间的柜子可以上传"实体柜子实拍照片"，用于可视化与录入时对照实物
function photoForm(name) {
  const fd = new FormData();
  fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), name);
  return fd;
}
const findCab = (tree, id) => {
  for (const z of tree) for (const f of z.floors) for (const c of f.cabinets) if (c.id === id) return c;
  return null;
};

test('M4.10 柜子实拍照片：上传 / 更换 / 删除（v1.5）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setupWithData(s);

  // 新柜子默认没有照片，但字段必须存在（前端据此判断显不显示）
  let tree = (await api(s.base, 'GET', '/structure')).json.data;
  assert.equal(findCab(tree, ids.cab).photo, null, '新柜子默认没有实拍照片');

  // 上传：返回托管相对路径，且图片可访问
  const up1 = await api(s.base, 'POST', `/cabinets/${ids.cab}/photo`, photoForm('cab.png'));
  assert.ok(up1.json.ok, '上传应成功: ' + JSON.stringify(up1.json));
  const photo1 = up1.json.data.photo;
  assert.match(photo1, /^images\/cabinet-\d+\/cab-\d+\.png$/, '应返回托管相对路径，实际 ' + photo1);
  const img1 = await fetch(s.base + '/' + photo1);
  assert.equal(img1.status, 200, '上传的照片应可访问');
  assert.equal(img1.headers.get('content-type'), 'image/png');
  assert.equal(findCab(up1.json.data.tree, ids.cab).photo, photo1, '结构树应带出 photo 供前端渲染');

  // 入库位置选择器用的 /stats/meta 也要带 photo
  const meta = (await api(s.base, 'GET', '/stats/meta')).json.data;
  const metaCab = meta.zones.flatMap((z) => z.floors).flatMap((f) => f.cabinets).find((c) => c.id === ids.cab);
  assert.equal(metaCab.photo, photo1, '识别入库的位置选择器应能拿到柜子照片');

  // 更换：新文件生效、旧文件被清理，不留垃圾
  const up2 = await api(s.base, 'POST', `/cabinets/${ids.cab}/photo`, photoForm('cab2.png'));
  assert.ok(up2.json.ok);
  const photo2 = up2.json.data.photo;
  assert.notEqual(photo2, photo1, '更换后应是全新的文件');
  assert.equal((await fetch(s.base + '/' + photo1)).status, 404, '旧照片文件应被清理');
  assert.equal((await fetch(s.base + '/' + photo2)).status, 200);

  // 不碰物品与库存
  const items = (await api(s.base, 'GET', '/items')).json.data;
  assert.equal(items.length, 3, '柜子照片不应影响物品数据');
  assert.equal(items.reduce((n, i) => n + i.totalQty, 0), 6, '柜子照片不应影响库存');

  // 删除：字段清空且文件清理
  const del = await api(s.base, 'DELETE', `/cabinets/${ids.cab}/photo`);
  assert.ok(del.json.ok);
  assert.equal(findCab(del.json.data.tree, ids.cab).photo, null, '删除后 photo 应清空');
  assert.equal((await fetch(s.base + '/' + photo2)).status, 404, '删除后文件应被清理');
  // 幂等：没有照片时再删一次也不报错
  assert.ok((await api(s.base, 'DELETE', `/cabinets/${ids.cab}/photo`)).json.ok, '重复删除应幂等');

  // 非法输入
  assert.equal((await api(s.base, 'POST', '/cabinets/999999/photo', photoForm('x.png'))).status, 404, '柜子不存在应 404');
  const badFd = new FormData();
  badFd.append('image', new Blob(['not an image'], { type: 'text/plain' }), 'a.txt');
  assert.equal((await api(s.base, 'POST', `/cabinets/${ids.cab}/photo`, badFd)).status, 400, '非图片应被拒绝');
  const noFile = new FormData();
  noFile.append('foo', 'bar');
  assert.equal((await api(s.base, 'POST', `/cabinets/${ids.cab}/photo`, noFile)).status, 400, '未带图片应被拒绝');
});
