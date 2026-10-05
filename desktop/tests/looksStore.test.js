'use strict';

/**
 * 形象仓储测试（M4b）。
 * 内置形象恒在 / 上传归一化落盘 / 删除同步删文件 / 切换校验 / 目录穿越防护。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PNG } = require('pngjs');
const { LooksStore, BUILTIN_ID } = require('../src/main/store/looksStore');
const K = require('../src/shared/keying');

/** 造一个假 repo（只实现 LooksStore 依赖的接口） */
function fakeRepo(dir) {
  return {
    dataDir: dir,
    data: { looks: [], currentLookId: null },
    patch(p) { Object.assign(this.data, p); },
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jspet-looks-'));
}

/** 造一张 200x260 的绿幕图，中间画一个蓝色方块角色 */
function makeGreenScreenPng() {
  const w = 200, h = 260;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBox = x >= 50 && x < 150 && y >= 40 && y < 220;
      png.data[i] = inBox ? 90 : 14;
      png.data[i + 1] = inBox ? 150 : 148;
      png.data[i + 2] = inBox ? 200 : 21;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test('M4b · 内置形象恒在、不可删除', () => {
  const dir = tmpDir();
  const store = new LooksStore(fakeRepo(dir));
  store.init();
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, BUILTIN_ID);
  assert.equal(list[0].builtin, true);
  assert.throws(() => store.remove(BUILTIN_ID), /内置形象不能删除/);
  assert.ok(store.has(BUILTIN_ID));
  assert.ok(!store.has('no-such'));
});

test('M4b · 内置形象视图使用应用内相对路径', () => {
  const store = new LooksStore(fakeRepo(tmpDir()));
  store.init();
  const v = store.viewsFor(BUILTIN_ID);
  assert.equal(v.front, 'looks/front.png');
  assert.equal(v.side, 'looks/side.png');
  assert.equal(v.side2, null, 'side2 恒用侧面镜像');
});

test('M4b · 上传导入：归一化落盘、登记元数据、设为当前', () => {
  const dir = tmpDir();
  const repo = fakeRepo(dir);
  const store = new LooksStore(repo);
  store.init();

  const r = store.importPng({ name: '测试形象', buffer: makeGreenScreenPng() });
  assert.ok(r.id.startsWith('custom-'));
  assert.equal(r.name, '测试形象');

  // 元数据进 repo（随主数据持久化）
  assert.equal(repo.data.looks.length, 1);
  assert.equal(repo.data.currentLookId, r.id);

  // 磁盘上有 720x900 的成品
  const file = path.join(store.dirOf(r.id), 'front.png');
  assert.ok(fs.existsSync(file), 'front.png 必须落盘');
  const png = PNG.sync.read(fs.readFileSync(file));
  assert.equal(png.width, 720);
  assert.equal(png.height, 900);

  // 列表与视图 URL
  assert.equal(store.list().length, 2);
  const v = store.viewsFor(r.id);
  assert.equal(v.front, `look://${r.id}/front.png`);
  assert.equal(v.side, v.front, '单图导入的其余视图回退正面');
});

test('M4b · 导入非法图片要明确报错', () => {
  const store = new LooksStore(fakeRepo(tmpDir()));
  store.init();
  assert.throws(() => store.importPng({ name: 'x', buffer: Buffer.from('not a png') }));
  assert.throws(() => store.importPng({ name: 'x', buffer: Buffer.alloc(0) }), /没有收到图片数据/);
  assert.throws(() => store.importPng({ name: 'x' }), /没有收到图片数据/);
});

test('M4b · 删除自定义形象：元数据与磁盘文件同步消失，当前形象回退内置', () => {
  const dir = tmpDir();
  const repo = fakeRepo(dir);
  const store = new LooksStore(repo);
  store.init();
  const a = store.importPng({ name: 'A', buffer: makeGreenScreenPng() });
  const b = store.importPng({ name: 'B', buffer: makeGreenScreenPng() });
  assert.equal(repo.data.looks.length, 2);

  const dirA = store.dirOf(a.id);
  assert.ok(fs.existsSync(dirA));

  store.setCurrent(a.id);
  assert.equal(repo.data.currentLookId, a.id);

  store.remove(a.id);
  assert.equal(repo.data.looks.length, 1);
  assert.equal(repo.data.currentLookId, null, '删除当前形象后回退内置');
  assert.ok(!fs.existsSync(dirA), '磁盘目录必须同步删除');
  assert.ok(!store.has(a.id));

  // 删除不存在的形象要报错
  assert.throws(() => store.remove(a.id), /形象不存在/);
  assert.throws(() => store.remove('ghost'), /形象不存在/);
});

test('M4b · setCurrent 校验存在性；非法 id 防目录穿越', () => {
  const store = new LooksStore(fakeRepo(tmpDir()));
  store.init();
  assert.throws(() => store.setCurrent('ghost'), /形象不存在/);
  assert.throws(() => store.viewsFor('../evil'), /非法的形象 id/);
  assert.throws(() => store.viewsFor('a/b'), /非法的形象 id/);
  store.setCurrent(BUILTIN_ID); // 内置合法
});

test('M4b · 缺失视图文件回退正面（磁盘文件被手动删掉时兜底）', () => {
  const dir = tmpDir();
  const repo = fakeRepo(dir);
  const store = new LooksStore(repo);
  store.init();
  const r = store.importPng({ name: 'X', buffer: makeGreenScreenPng() });
  fs.rmSync(path.join(store.dirOf(r.id), 'front.png'));
  // front 缺失 → 形象损坏，明确报错
  assert.throws(() => store.viewsFor(r.id), /缺少正面图/);
});

test('M4b · 归一化把绿幕背景抠干净（导出的成品透明占比合理）', () => {
  const dir = tmpDir();
  const store = new LooksStore(fakeRepo(dir));
  store.init();
  const r = store.importPng({ name: 'K', buffer: makeGreenScreenPng() });
  const png = PNG.sync.read(fs.readFileSync(path.join(store.dirOf(r.id), 'front.png')));
  const ratio = K.transparentRatio(png.data, png.width, png.height);
  assert.ok(ratio > 0.2 && ratio < 0.9, `透明占比应在合理区间，实际 ${ratio}`);
});
