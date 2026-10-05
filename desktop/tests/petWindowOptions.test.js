'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { PET_WINDOW, buildPetWindowOptions } = require('../src/main/petWindowOptions');

test('M0 · 透明置顶窗口参数齐全（验收 A2 / A3）', () => {
  const opts = buildPetWindowOptions(null);

  // A2：背景透明
  assert.equal(opts.transparent, true, 'transparent 必须为 true');
  assert.equal(opts.backgroundColor, '#00000000', '必须显式指定全透明背景色，否则部分环境会出现黑底');

  // A3：无边框、置顶、不占任务栏
  assert.equal(opts.frame, false, 'frame 必须为 false');
  assert.equal(opts.alwaysOnTop, true, 'alwaysOnTop 必须为 true');
  assert.equal(opts.skipTaskbar, true, 'skipTaskbar 必须为 true');
  assert.equal(opts.hasShadow, false, 'hasShadow 必须为 false，否则透明窗口会带出方框阴影');
});

test('M0 · 宠物窗口不可缩放 / 不可最大化（避免用户把透明窗拉变形）', () => {
  const opts = buildPetWindowOptions(null);
  assert.equal(opts.resizable, false);
  assert.equal(opts.maximizable, false);
  assert.equal(opts.minimizable, false);
  assert.equal(opts.fullscreenable, false);
});

test('M0 · 安全基线：渲染进程拿不到 Node（验收 H2）', () => {
  const { webPreferences } = buildPetWindowOptions(null);
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.nodeIntegrationInWorker, false);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.webSecurity, true);
  assert.equal(webPreferences.allowRunningInsecureContent, false);

  const expected = path.join('src', 'preload', 'index.js');
  assert.ok(
    path.normalize(webPreferences.preload).endsWith(expected),
    `preload 必须指向 src/preload/index.js，实际为 ${webPreferences.preload}`
  );
});

test('M0 · 未提供坐标时不写 x/y（交给 Electron 自己居中）', () => {
  const opts = buildPetWindowOptions(null);
  assert.equal('x' in opts, false);
  assert.equal('y' in opts, false);
});

test('M0 · 提供坐标时取整写入', () => {
  const opts = buildPetWindowOptions({ x: 100.6, y: 200.4 });
  assert.equal(opts.x, 101);
  assert.equal(opts.y, 200);
});

test('M0 · 非法坐标（NaN）当成未提供处理', () => {
  const opts = buildPetWindowOptions({ x: NaN, y: 10 });
  assert.equal('x' in opts, false);
  assert.equal('y' in opts, false);
});

test('M0 · 窗口尺寸与 PRD 约定一致且够放下气泡与阴影', () => {
  assert.equal(PET_WINDOW.width, 320);
  assert.equal(PET_WINDOW.height, 400);
  assert.ok(PET_WINDOW.height > 250 + 100, '高度需容纳 250px 宠物 + 上方气泡 + 下方阴影');
});
