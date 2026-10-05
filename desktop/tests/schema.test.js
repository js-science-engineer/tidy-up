'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../src/main/store/schema');

test('M2 · defaultData 覆盖 PRD 5.x 要求的全部字段', () => {
  const d = schema.defaultData(1700000000000);
  for (const k of ['schemaVersion', 'position', 'display', 'currentLookId', 'looks', 'stats', 'settings', 'meta']) {
    assert.ok(k in d, `缺少顶层字段 ${k}`);
  }
  assert.equal(d.schemaVersion, schema.SCHEMA_VERSION);
  for (const k of ['hunger', 'mood', 'bond', 'level', 'lastTickAt', 'todayInteractions']) {
    assert.ok(k in d.stats, `stats 缺少 ${k}`);
  }
  for (const k of ['autoStart', 'size', 'wanderEnabled']) {
    assert.ok(k in d.settings, `settings 缺少 ${k}`);
  }
  assert.equal(d.stats.todayInteractions.date, schema.todayKey(1700000000000));
});

test('M2 · todayKey 是本地时区 YYYY-MM-DD', () => {
  // 2026-10-04 00:30 本地时间
  const ts = new Date(2026, 9, 4, 0, 30, 0).getTime();
  assert.equal(schema.todayKey(ts), '2026-10-04');
});

test('M2 · normalize 补齐缺失字段（旧数据 / 半截数据不会崩）', () => {
  const out = schema.normalize({ stats: { hunger: 30 } });
  assert.equal(out.settings.size, 150);
  assert.equal(out.stats.mood, 80);
  assert.equal(out.stats.level, 1);
  assert.ok(Array.isArray(out.looks));
  assert.equal(out.position, null);
});

test('M2 · normalize 钳制越界数值', () => {
  const out = schema.normalize({
    stats: { hunger: 250, mood: -40, bond: 'abc', level: 500 },
    settings: { size: 99999 },
  });
  assert.equal(out.stats.hunger, 100);
  assert.equal(out.stats.mood, 0);
  assert.equal(out.stats.bond, 0, '非法数值回退到默认');
  assert.equal(out.stats.level, 99);
  assert.equal(out.settings.size, 260);
});

test('M2 · normalize 拒绝把 position 存成非法值', () => {
  assert.equal(schema.normalize({ position: { x: 'abc', y: 5 } }).position, null);
  const ok = schema.normalize({ position: { x: 10.7, y: -3.2 } }).position;
  assert.deepEqual(ok, { x: 11, y: -3 });
});

test('M2 · 迁移：版本比程序新 → 明确拒绝（验收 F2）', () => {
  const r = schema.migrate({ schemaVersion: 99, stats: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /更新/);
});

test('M2 · 迁移：缺少版本号 → 拒绝', () => {
  assert.equal(schema.migrate({ foo: 1 }).ok, false);
  assert.equal(schema.migrate(null).ok, false);
  assert.equal(schema.migrate('str').ok, false);
});

test('M2 · 迁移：当前版本数据 → 通过并完成规范化', () => {
  const r = schema.migrate({ schemaVersion: 1, stats: { hunger: 42 } });
  assert.equal(r.ok, true);
  assert.equal(r.data.stats.hunger, 42);
  assert.equal(r.data.settings.size, 150);
});

test('M2 · validateForRestore：缺 stats / 版本过新 / 非对象 都要拒绝（验收 F2）', () => {
  assert.equal(schema.validateForRestore({ schemaVersion: 1 }).ok, false);
  assert.equal(schema.validateForRestore({ schemaVersion: 5, stats: {} }).ok, false);
  assert.equal(schema.validateForRestore('nope').ok, false);
  assert.equal(schema.validateForRestore({ schemaVersion: 1, stats: { hunger: 1 } }).ok, true);
});
