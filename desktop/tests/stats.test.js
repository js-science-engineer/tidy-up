'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../src/shared/stats');

const T0 = new Date(2026, 9, 4, 12, 0, 0).getTime();   // 2026-10-04 12:00
const H = 3600 * 1000;

function base(over) {
  return Object.assign(
    {
      hunger: 80, mood: 80, bond: 0, level: 1, lastTickAt: T0,
      todayInteractions: { date: '2026-10-04', count: 0 },
      cooldowns: { feed: 0, pet: 0, play: 0 },
    },
    over || {}
  );
}

/* ---------------- 衰减与离线结算 ---------------- */

test('M3 · 6 小时后饱食 -18、心情 -12（验收 C1）', () => {
  const s = S.tick(base(), T0 + 6 * H);
  assert.equal(s.hunger, 62, '80 - 6*3');
  assert.equal(s.mood, 68, '80 - 6*2');
  assert.equal(s.lastTickAt, T0 + 6 * H);
});

test('M3 · 离线结算封顶 72 小时（DEV_PLAN 5.3）', () => {
  // 封顶机制本身：200h 只按 72h 结算
  assert.equal(S.effectiveHours(200 * H), 72);
  assert.equal(S.effectiveHours(6 * H), 6);
  assert.equal(S.effectiveHours(-10 * H), 0, '时间回拨不衰减');
  // 结果层面：无论离线多久，数值都被钳在合法区间内
  const s = S.tick(base({ hunger: 80, mood: 80 }), T0 + 200 * H);
  assert.ok(s.hunger >= 0 && s.hunger <= 100, `hunger=${s.hunger} 必须在区间内`);
  assert.ok(s.mood >= 0 && s.mood <= 100, `mood=${s.mood} 必须在区间内`);
  const s2 = S.tick(base({ hunger: 20, mood: 40 }), T0 + 500 * H);
  assert.equal(s2.hunger, 0, '长期不开机 → 饱食归零');
  assert.equal(s2.mood, 0, '长期不开机 → 心情归零');
});

test('M3 · 系统时间被回拨时不产生负衰减', () => {
  const s = S.tick(base({ hunger: 50, mood: 50 }), T0 - 10 * H);
  assert.equal(s.hunger, 50);
  assert.equal(s.mood, 50);
});

test('M3 · 数值永不超过 0..100', () => {
  const s = S.tick(base({ hunger: 100, mood: 100 }), T0 + 0.1 * H);
  assert.ok(s.hunger <= 100 && s.hunger >= 0);
  assert.ok(s.mood <= 100 && s.mood >= 0);
});

/* ---------------- 每日机制 ---------------- */

test('M3 · 跨天重置：次日首次互动计数归零（验收 C3）', () => {
  const nextDay = new Date(2026, 9, 5, 8, 0, 0).getTime();
  const s = S.tick(base({ todayInteractions: { date: '2026-10-04', count: 20 } }), nextDay);
  assert.equal(s.todayInteractions.date, '2026-10-05');
  assert.equal(s.todayInteractions.count, 0);
});

test('M3 · 同一天内计数累加', () => {
  const s = S.tick(base({ todayInteractions: { date: '2026-10-04', count: 3 } }), T0 + 1000);
  assert.equal(s.todayInteractions.count, 3, '同一天不清零');
});

/* ---------------- 互动：喂食 / 抚摸 / 玩耍 ---------------- */

test('M3 · 喂食：饱食 +25、心情 +5，且计入每日互动', () => {
  const r = S.applyInteraction(base(), 'feed', T0 + 1000);
  assert.equal(r.ok, true);
  assert.equal(r.stats.hunger, 100, '80+25 封顶 100');
  assert.equal(r.stats.mood, 85);
  assert.equal(r.stats.todayInteractions.count, 1);
});

test('M3 · 喂食有冷却，冷却期内失败且数值不变', () => {
  const t1 = T0 + 1000;
  const first = S.applyInteraction(base({ hunger: 50 }), 'feed', t1);
  const again = S.applyInteraction(first.stats, 'feed', t1 + 1000);   // 才过 1 秒
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'cooldown');
  assert.equal(again.stats.hunger, 50 + 25 - 0, '失败时不叠加');
});

test('M3 · 饱食已满时喂食被拒绝（reason=full）', () => {
  const r = S.applyInteraction(base({ hunger: 100 }), 'feed', T0 + 1000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'full');
});

test('M3 · 抚摸：心情 +6、亲密度 +1', () => {
  const r = S.applyInteraction(base(), 'pet', T0 + 1000);
  assert.equal(r.ok, true);
  assert.equal(r.stats.mood, 86);
  assert.equal(r.stats.bond, 1);
  assert.equal(r.bondGained, true);
});

test('M3 · 玩耍：心情 +15、饱食 -8', () => {
  const r = S.applyInteraction(base({ hunger: 50, mood: 50 }), 'play', T0 + 1000);
  assert.equal(r.stats.mood, 65);
  assert.equal(r.stats.hunger, 42);
  assert.equal(r.stats.bond, 1);
});

/* ---------------- 每日亲密度上限（验收 C2） ---------------- */

test('M3 · 达到每日上限后亲密度不再增长，但心情照常提升（验收 C2）', () => {
  let s = base({ bond: 10, todayInteractions: { date: '2026-10-04', count: S.RULES.dailyBondLimit } });
  const r = S.applyInteraction(s, 'pet', T0 + 1000);
  assert.equal(r.ok, true, '互动本身仍成功');
  assert.equal(r.bondGained, false, '但不再加亲密度');
  assert.equal(r.stats.bond, 10);
  assert.equal(r.stats.mood, 86, '心情照常 +6');
});

test('M3 · 未达上限时亲密度正常增长', () => {
  let s = base();
  const r = S.applyInteraction(s, 'pet', T0 + 1000);
  assert.equal(r.bondGained, true);
  assert.equal(r.stats.todayInteractions.count, 1);
});

/* ---------------- 等级 ---------------- */

test('M3 · 等级由亲密度换算，每 30 点升 1 级（验收 C4）', () => {
  assert.equal(S.levelFor(0), 1);
  assert.equal(S.levelFor(29), 1);
  assert.equal(S.levelFor(30), 2);
  assert.equal(S.levelFor(299), 10);
  assert.equal(S.levelFor(99999), 99, '封顶 99');
});

test('M3 · 跨过阈值时 stats.level 立即更新（验收 C4）', () => {
  const r = S.applyInteraction(base({ bond: 29, todayInteractions: { date: '2026-10-04', count: 0 } }), 'pet', T0 + 1000);
  assert.equal(r.stats.bond, 30);
  assert.equal(r.stats.level, 2, '升级');
});

test('M3 · 升级进度', () => {
  const p = S.progressFor(45);
  assert.deepEqual({ level: p.level, into: p.into, need: p.need }, { level: 2, into: 15, need: 30 });
  assert.ok(p.ratio > 0 && p.ratio < 1);
});

/* ---------------- 状态驱动外观（验收 C5） ---------------- */

test('M3 · 饱食度 <=20 时呈现"饿"的外观（验收 C5）', () => {
  assert.equal(S.moodClass(base({ hunger: 20, mood: 80 })), 'mood-low');
  assert.equal(S.linesFor(base({ hunger: 15, mood: 80 })).length > 0, true, '饿的时候有专属台词');
  assert.notDeepEqual(
    S.linesFor(base({ hunger: 15, mood: 80 })),
    S.linesFor(base({ hunger: 90, mood: 90 })),
    '饿的台词必须和开心时不同'
  );
});

test('M3 · 心情外观优先级：难过 > 饿 > 蔫 > 开心 > 无', () => {
  assert.equal(S.moodClass(base({ mood: 10, hunger: 10 })), 'mood-critical');
  assert.equal(S.moodClass(base({ mood: 80, hunger: 10 })), 'mood-low');
  assert.equal(S.moodClass(base({ mood: 30, hunger: 80 })), 'mood-low');
  assert.equal(S.moodClass(base({ mood: 85, hunger: 80 })), 'mood-happy');
  assert.equal(S.moodClass(base({ mood: 55, hunger: 80 })), null);
});

/* ---------------- 健壮性 ---------------- */

test('M3 · ensureShape 兼容缺失 cooldowns 的旧数据', () => {
  const s = S.ensureShape({ hunger: 50, mood: 50, bond: 5, lastTickAt: T0 }, T0);
  assert.deepEqual(s.cooldowns, { feed: 0, pet: 0, play: 0 });
  assert.equal(s.level, 1);
});

test('M3 · tick 不修改传入对象（纯函数）', () => {
  const original = base();
  const snapshot = JSON.stringify(original);
  S.tick(original, T0 + 5 * H);
  assert.equal(JSON.stringify(original), snapshot, '入参不得被修改');
});
