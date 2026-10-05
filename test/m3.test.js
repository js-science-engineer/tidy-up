// M3 测试：识别入库闭环（对应 PRD 验收 C1/C2/C4/C5/C6、D1）
const test = require('node:test');
const assert = require('node:assert');
const { startServer, api, stop, tinyPng } = require('./helpers');

const PRESETS = ['电子元件','开发板/模块','仪器设备','线材/连接件','工具','化学试剂','耗材','结构件/五金','包装/收纳','文档/资料','其他'];

async function setup(s) {
  await api(s.base, 'PUT', '/settings', { provider: 'mock' });
  const zone = (await api(s.base, 'POST', '/zones', { name: '区域一' })).json.data.id;
  const cab = (await api(s.base, 'POST', '/cabinets', { parentId: zone, name: '1号柜', door: 'double', floor: 1 })).json.data.id;
  const shelf1 = (await api(s.base, 'POST', '/shelves', { parentId: cab, name: '第1层', kind: 'shelf' })).json.data.id;
  const shelf2 = (await api(s.base, 'POST', '/shelves', { parentId: cab, name: '第2层', kind: 'shelf' })).json.data.id;
  const box = (await api(s.base, 'POST', '/boxes', { parentId: shelf1, name: '防静电零件盒A' })).json.data.id;
  return { zone, cab, shelf1, shelf2, box };
}

function makeForm(mode = 'single') {
  const fd = new FormData();
  fd.append('image', new Blob([tinyPng()], { type: 'image/png' }), 'photo.png');
  fd.append('mode', mode);
  return fd;
}

test('M3.1 单物识别 + 确认入库（C1/C2/C3）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setup(s);

  const an = await api(s.base, 'POST', '/intake/analyze', makeForm('single'));
  assert.ok(an.json.ok, 'analyze 应成功: ' + JSON.stringify(an.json));
  const q = an.json.data;
  const it = q.rec.items[0];
  assert.equal(it.name, 'STM32F103C8T6 最小系统板');
  assert.ok(PRESETS.includes(it.category), '类别必须落在预设分类内');
  assert.ok(it.aliases.length >= 2, '候选名称 >= 2');
  assert.ok(it.confidence > 0.9, '置信度 > 0.9');
  assert.ok(it.suggestion && it.suggestion.reason, '必须有分区建议与理由');
  assert.ok(Array.isArray(it.webImages), '联网配图字段存在（可为空数组）');
  assert.equal(it.webImages.length, 0, 'v1.2 起不再联网搜图，实物图只用用户照片');

  // 识别原图回显地址（队列项在多设备/重启后也能看到用户拍的照片）
  assert.ok(q.previewUrl && q.previewUrl.startsWith('/api/uploads/'), '应返回识别原图地址: ' + q.previewUrl);
  const prev = await fetch(s.base + q.previewUrl);
  assert.ok(prev.ok, '原图地址应可访问');
  assert.ok((prev.headers.get('content-type') || '').startsWith('image/'), '原图应返回图片类型');

  // 队列里可见
  const queue = (await api(s.base, 'GET', '/intake/queue')).json.data;
  assert.equal(queue.length, 1, '待确认队列应有 1 条');

  // 确认入库到 1号柜 第2层
  const cf = await api(s.base, 'POST', '/intake/confirm', {
    queueId: q.id, index: 0, name: it.name, category: it.category,
    qty: 3, shelfId: ids.shelf2, boxId: null, mainImage: 'user',
  });
  assert.ok(cf.json.ok, '确认入库应成功: ' + JSON.stringify(cf.json));
  assert.equal(cf.json.data.qty, 3);
  assert.ok(cf.json.data.location.includes('1号柜'), '位置路径包含 1号柜');
  assert.ok(cf.json.data.location.includes('第2层'));

  // 队列清空、详情含流水
  const queue2 = (await api(s.base, 'GET', '/intake/queue')).json.data;
  assert.equal(queue2.length, 0, '确认后队列应清空');
  const detail = (await api(s.base, 'GET', '/items/' + cf.json.data.itemId)).json.data;
  assert.equal(detail.placements.length, 1);
  assert.equal(detail.placements[0].qty, 3);
  assert.ok(detail.logs.some((l) => l.action === 'in'), '应有入库流水');
  assert.ok(detail.images.some((i) => i.source === 'user' && i.is_main === 1), '用户照片为主图');
  const mainImg = detail.images.find((i) => i.is_main === 1);
  assert.ok(mainImg.file.startsWith('images/'), '用户照片应固化到本地 images/ 目录: ' + mainImg.file);
  const imgRes = await fetch(s.base + '/' + mainImg.file);
  assert.ok(imgRes.ok && (imgRes.headers.get('content-type') || '').startsWith('image/'), '实物照片应可访问');
});

test('M3.2 批量识别逐件入库（C4）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setup(s);

  const an = await api(s.base, 'POST', '/intake/analyze', makeForm('batch'));
  assert.ok(an.json.ok);
  const q = an.json.data;
  assert.equal(q.rec.items.length, 3, '批量应识别出 3 件');
  assert.ok(q.rec.items.every((i) => i.bbox), '批量模式每件应有 bbox');

  for (let i = 0; i < q.rec.items.length; i++) {
    const cf = await api(s.base, 'POST', '/intake/confirm', {
      queueId: q.id, index: i, name: q.rec.items[i].name, category: q.rec.items[i].category,
      qty: 1, shelfId: ids.shelf1, boxId: null, mainImage: 'user',
    });
    assert.ok(cf.json.ok, `第 ${i + 1} 件入库应成功: ` + JSON.stringify(cf.json));
  }
  const list = (await api(s.base, 'GET', '/items')).json.data;
  assert.equal(list.length, 3, '应共有 3 件物品');
});

test('M3.3 多位置独立数量（C5）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setup(s);

  // 同一物品分两次入库到不同位置
  const an1 = await api(s.base, 'POST', '/intake/analyze', makeForm('single'));
  const cf1 = await api(s.base, 'POST', '/intake/confirm', {
    queueId: an1.json.data.id, index: 0, name: 'STM32F103C8T6 最小系统板', qty: 3,
    shelfId: ids.shelf2, boxId: ids.box, mainImage: 'user',
  });
  const an2 = await api(s.base, 'POST', '/intake/analyze', makeForm('single'));
  const cf2 = await api(s.base, 'POST', '/intake/confirm', {
    queueId: an2.json.data.id, index: 0, name: 'STM32F103C8T6 最小系统板', qty: 2,
    shelfId: ids.shelf1, boxId: null, mainImage: 'user',
  });
  assert.ok(cf1.json.ok && cf2.json.ok);

  const list = (await api(s.base, 'GET', '/items')).json.data;
  assert.equal(list.length, 1, '同一物品只建一条');
  assert.equal(list[0].totalQty, 5, '总数量 = 各位置之和');
  const detail = (await api(s.base, 'GET', '/items/' + list[0].id)).json.data;
  assert.equal(detail.placements.length, 2, '两条独立存放记录');
  const qtyByLoc = detail.placements.map((p) => p.qty).sort();
  assert.deepEqual(qtyByLoc, [2, 3], '各位置数量独立');
});

test('M3.4 出库扣减与取空（D1）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  const ids = await setup(s);
  const an = await api(s.base, 'POST', '/intake/analyze', makeForm('single'));
  const cf = (await api(s.base, 'POST', '/intake/confirm', {
    queueId: an.json.data.id, index: 0, name: '万用表', qty: 3, shelfId: ids.shelf1, boxId: null, mainImage: 'user',
  })).json.data;

  // 部分取出
  const o1 = await api(s.base, 'POST', `/items/${cf.itemId}/out`, { placementId: cf.itemId ? undefined : undefined });
  // 上面占位无意义，直接取 placementId：从详情拿
  const detail = (await api(s.base, 'GET', '/items/' + cf.itemId)).json.data;
  const p = detail.placements[0];
  const out1 = await api(s.base, 'POST', `/items/${cf.itemId}/out`, { placementId: p.id, qty: 1 });
  assert.ok(out1.json.ok, '部分取出应成功: ' + JSON.stringify(out1.json));
  assert.equal(out1.json.data.remain, 2);
  assert.equal(out1.json.data.emptied, false);

  // 超量取出应拒绝
  const outBad = await api(s.base, 'POST', `/items/${cf.itemId}/out`, { placementId: p.id, qty: 99 });
  assert.equal(outBad.status, 400, '超量取出应 400');

  // 全部取出 → 已取空
  const out2 = await api(s.base, 'POST', `/items/${cf.itemId}/out`, { placementId: p.id, all: true });
  assert.ok(out2.json.ok);
  assert.equal(out2.json.data.emptied, true);
  const detail2 = (await api(s.base, 'GET', '/items/' + cf.itemId)).json.data;
  assert.equal(detail2.placements[0].qty, 0, '数量归 0 但记录保留');
  const outCount = detail2.logs.filter((l) => l.action === 'out').length;
  assert.ok(outCount >= 2, '应有出库流水');
});

test('M3.5 忽略队列项（dismiss）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await setup(s);
  const an = await api(s.base, 'POST', '/intake/analyze', makeForm('single'));
  const d = await api(s.base, 'POST', '/intake/dismiss', { id: an.json.data.id });
  assert.ok(d.json.ok);
  const queue = (await api(s.base, 'GET', '/intake/queue')).json.data;
  assert.equal(queue.length, 0, '忽略后队列清空');
});

test('M3.6 未配置 Key 时给出明确错误（C6 服务端部分）', async (t) => {
  const s = await startServer();
  t.after(() => stop(s.proc));
  await api(s.base, 'PUT', '/settings', { provider: 'glm', glm: { key: '' } });
  const an = await api(s.base, 'POST', '/intake/analyze', makeForm('single'));
  assert.equal(an.status, 400);
  assert.ok(an.json.error.includes('API Key'), '错误信息应提示 Key 未配置: ' + an.json.error);
});
