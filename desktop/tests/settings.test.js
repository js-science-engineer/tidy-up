'use strict';

/** M5 · 开机自启封装与设置合并逻辑 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyAutoStart, readAutoStart } = require('../src/main/autostart');
const { mergeSettings } = require('../src/main/store/settings');

/** fake app：记录 setLoginItemSettings 调用，可编程返回值 */
function fakeApp(initial) {
  let state = { openAtLogin: initial };
  return {
    calls: [],
    setLoginItemSettings(opts) {
      this.calls.push(opts);
      state = { openAtLogin: !!opts.openAtLogin };
    },
    getLoginItemSettings() { return state; },
    getPath() { return 'C:\\fake'; },
  };
}

/* ---------------- autostart ---------------- */

test('M5 · applyAutoStart(true) 打开登录项并返回系统实际状态', () => {
  const app = fakeApp(false);
  const r = applyAutoStart(app, true);
  assert.equal(r, true);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].openAtLogin, true);
  assert.equal(app.calls[0].openAsHidden, true, '自启隐藏窗口');
});

test('M5 · applyAutoStart(false) 关闭登录项', () => {
  const app = fakeApp(true);
  const r = applyAutoStart(app, false);
  assert.equal(r, false);
  assert.equal(app.calls[0].openAtLogin, false);
});

test('M5 · readAutoStart 以系统状态为准；异常时安全回退 false', () => {
  assert.equal(readAutoStart(fakeApp(true)), true);
  assert.equal(readAutoStart(fakeApp(false)), false);
  const broken = { getLoginItemSettings() { throw new Error('boom'); } };
  assert.equal(readAutoStart(broken), false);
});

/* ---------------- mergeSettings ---------------- */

test('M5 · mergeSettings 只接受白名单键，未知键丢弃', () => {
  const r = mergeSettings({ autoStart: false, size: 150, wanderEnabled: false }, {
    size: 200, wanderEnabled: true, evil: 'x',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.settings, { autoStart: false, size: 200, wanderEnabled: true });
});

test('M5 · mergeSettings 部分提交时保留其余项', () => {
  const r = mergeSettings({ autoStart: true, size: 180, wanderEnabled: true }, { size: 120 });
  assert.equal(r.ok, true);
  assert.equal(r.settings.autoStart, true);
  assert.equal(r.settings.wanderEnabled, true);
  assert.equal(r.settings.size, 120);
});

test('M5 · mergeSettings 钳制 size 到 [100,260] 并取整', () => {
  assert.equal(mergeSettings({}, { size: 50 }).settings.size, 100);
  assert.equal(mergeSettings({}, { size: 999 }).settings.size, 260);
  assert.equal(mergeSettings({}, { size: 175.6 }).settings.size, 176);
});

test('M5 · mergeSettings 拒绝非法类型', () => {
  assert.equal(mergeSettings({}, { autoStart: 'yes' }).ok, false);
  assert.equal(mergeSettings({}, { wanderEnabled: 1 }).ok, false);
  assert.equal(mergeSettings({}, { size: 'big' }).ok, false);
  assert.equal(mergeSettings({}, null).ok, false);
});

test('M5 · mergeSettings 当前设置为空时用默认值兜底', () => {
  const r = mergeSettings(null, {});
  assert.deepEqual(r.settings, { autoStart: false, size: 150, wanderEnabled: false });
});
