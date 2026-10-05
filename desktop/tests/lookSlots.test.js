'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SLOTS = require('../src/shared/lookSlots');

test('M1 · 形象视图常量与 PRD 一致', () => {
  assert.deepEqual(SLOTS.REQUIRED_VIEW_KEYS, ['front', 'side', 'back']);
  assert.deepEqual(SLOTS.OPTIONAL_VIEW_KEYS, ['side2', 'wave', 'sleep']);
  assert.deepEqual(SLOTS.CYLINDER_ORDER, ['front', 'side', 'back', 'side2']);
});

test('M1 · resolveViews：齐全的视图原样保留', () => {
  const v = { front: 'f', side: 's', back: 'b', side2: 's2', wave: 'w', sleep: 'sl' };
  assert.deepEqual(SLOTS.resolveViews(v), v);
});

test('M1 · resolveViews：缺 side2 时回退到 side（转身用镜像补齐）', () => {
  const out = SLOTS.resolveViews({ front: 'f', side: 's', back: 'b' });
  assert.equal(out.side2, 's');
  assert.equal(out.wave, 'f');
  assert.equal(out.sleep, 'f');
});

test('M1 · resolveViews：空入参不抛异常且各键齐全', () => {
  const out = SLOTS.resolveViews(undefined);
  for (const k of SLOTS.VIEW_KEYS) assert.ok(k in out, `缺少键 ${k}`);
});

test('M1 · isValidViews：三视图齐全才算合法', () => {
  assert.equal(SLOTS.isValidViews({ front: 'f', side: 's', back: 'b' }), true);
  assert.equal(SLOTS.isValidViews({ front: 'f', side: 's' }), false, '缺背面');
  assert.equal(SLOTS.isValidViews({ front: '', side: 's', back: 'b' }), false, '空字符串不算');
  assert.equal(SLOTS.isValidViews(null), false);
  assert.equal(SLOTS.isValidViews(undefined), false);
});
