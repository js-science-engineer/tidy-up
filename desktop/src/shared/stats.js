/* ============================================================================
 * JsPetStats — 养成数值模型（纯函数，主进程 / 渲染进程 / 单元测试共用）
 * ----------------------------------------------------------------------------
 * 采用 UMD 包装：Node 里 require，浏览器里挂到 window.JsPetStats。
 * 本模块绝不碰 DOM / fs / electron，全部规则可单元测试。
 *
 * 规则来源：PRD 第 4 章养成数值表 + DEV_PLAN 5.3（离线结算必须封顶）。
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JsPetStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- 数值规则（PRD 第 4 章） ---------------- */
  const RULES = Object.freeze({
    hungerDecayPerHour: 3,        // 饱食度 -3/小时
    moodDecayPerHour: 2,          // 心情   -2/小时
    maxOfflineHours: 72,          // 离线结算封顶：最多按 72 小时结算

    feed: { hunger: +25, mood: +5, cooldownMs: 60 * 1000 },        // 喂食
    pet:  { hunger: 0,   mood: +6, bond: +1, cooldownMs: 30 * 1000 }, // 抚摸
    play: { hunger: -8,  mood: +15, bond: +1, cooldownMs: 5 * 60 * 1000 }, // 玩耍

    dailyBondLimit: 20,           // 每日最多 +20 亲密度
    bondPerLevel: 30,             // 每 30 点亲密度升 1 级
    maxLevel: 99,

    thresholds: {
      moodCritical: 10,           // 心情 <= 10 → 难过
      moodLow: 30,                // 心情 <= 30 → 变蔫
      hungerLow: 20,              // 饱食度 <= 20 → 喊饿
    },
  });

  const INTERACTIONS = Object.freeze(['feed', 'pet', 'play']);

  function clamp100(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.min(100, Math.max(0, v));
  }

  /** 当天日期键（本地时区），用于每日重置 */
  function todayKey(ts) {
    const d = new Date(Number.isFinite(ts) ? ts : Date.now());
    return (
      d.getFullYear() +
      '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  /** 深拷贝 stats（对象很浅，手写即可） */
  function copyStats(s) {
    return {
      hunger: s.hunger,
      mood: s.mood,
      bond: s.bond,
      level: s.level,
      lastTickAt: s.lastTickAt,
      todayInteractions: { date: s.todayInteractions.date, count: s.todayInteractions.count },
      cooldowns: Object.assign({}, s.cooldowns),
    };
  }

  /**
   * 实际参与衰减的小时数：负数回正、封顶 maxOfflineHours。
   * 单独暴露出来便于单元测试"封顶"这个机制本身。
   */
  function effectiveHours(elapsedMs) {
    let h = (Number(elapsedMs) || 0) / 3600000;
    if (!Number.isFinite(h) || h < 0) h = 0;
    return Math.min(RULES.maxOfflineHours, h);
  }

  const round2 = (v) => Math.round(v * 100) / 100;

  /**
   * 时间推进：跨天重置 + 数值衰减。
   * @param {object} stats
   * @param {number} now 当前毫秒时间戳
   */
  function tick(stats, now) {
    const s = copyStats(stats);
    const t = Number.isFinite(now) ? now : Date.now();

    // 跨天 → 每日互动计数归零（PRD 6.3 每日机制）
    if (s.todayInteractions.date !== todayKey(t)) {
      s.todayInteractions = { date: todayKey(t), count: 0 };
    }

    // 衰减（含离线），封顶 maxOfflineHours，避免用户长期不开机导致直接归零。
    // round2 量化到 2 位小数：既保留小步衰减，又消除浮点噪声。
    const hours = effectiveHours(t - s.lastTickAt);
    s.hunger = clamp100(round2(s.hunger - hours * RULES.hungerDecayPerHour));
    s.mood = clamp100(round2(s.mood - hours * RULES.moodDecayPerHour));
    s.lastTickAt = t;
    return s;
  }

  /** 由亲密度换算等级（PRD 5.2：level 由 bond 换算） */
  function levelFor(bond) {
    const b = Math.max(0, Number(bond) || 0);
    return Math.min(RULES.maxLevel, 1 + Math.floor(b / RULES.bondPerLevel));
  }

  /** 升级进度 */
  function progressFor(bond) {
    const b = Math.max(0, Number(bond) || 0);
    const level = levelFor(b);
    const need = RULES.bondPerLevel;
    const into = level >= RULES.maxLevel ? need : b - (level - 1) * need;
    return { level, into, need, ratio: Math.min(1, into / need) };
  }

  /**
   * 应用一次互动。
   * @param {'feed'|'pet'|'play'} kind
   * @returns {{ok:boolean, reason?:string, bondGained?:boolean, stats:object}}
   */
  function applyInteraction(stats, kind, now) {
    const t = Number.isFinite(now) ? now : Date.now();
    const rule = RULES[kind];
    if (!rule) return { ok: false, reason: 'unknown', stats: copyStats(stats) };

    const s = tick(stats, t);

    const last = (s.cooldowns && s.cooldowns[kind]) || 0;
    if (t - last < rule.cooldownMs) return { ok: false, reason: 'cooldown', stats: s };
    if (kind === 'feed' && s.hunger >= 99) return { ok: false, reason: 'full', stats: s };

    const canBond = s.todayInteractions.count < RULES.dailyBondLimit;
    let bondGained = false;
    if (kind === 'feed') {
      s.hunger = clamp100(s.hunger + rule.hunger);
      s.mood = clamp100(s.mood + rule.mood);
    } else {
      s.mood = clamp100(s.mood + rule.mood);
      s.hunger = clamp100(s.hunger + (rule.hunger || 0));
      if (canBond) { s.bond += rule.bond || 0; bondGained = true; }
    }

    s.todayInteractions.count += 1;
    s.cooldowns = Object.assign({}, s.cooldowns, { [kind]: t });
    s.level = levelFor(s.bond);
    s.lastTickAt = t;
    return { ok: true, bondGained, stats: s };
  }

  /**
   * 状态 → 外观 class（PRD 3.1：用状态驱动表情与动作，不常驻数字）
   * 优先级：难过 > 饿 > 蔫 > 开心 > 无
   */
  function moodClass(stats) {
    const th = RULES.thresholds;
    if (!stats) return null;
    if (stats.mood <= th.moodCritical) return 'mood-critical';
    if (stats.hunger <= th.hungerLow) return 'mood-low';
    if (stats.mood <= th.moodLow) return 'mood-low';
    if (stats.mood >= 80) return 'mood-happy';
    return null;
  }

  /** 台词池：不同状态说不同的话（PRD C5：饿了的表现要和常态不同） */
  function linesFor(stats) {
    const cls = moodClass(stats);
    if (stats && stats.hunger <= RULES.thresholds.hungerLow) {
      return ['肚子咕咕叫了…', '好饿呀…', '有吃的吗？'];
    }
    if (cls === 'mood-critical') return ['不想动…', '心情好差…', '抱抱…'];
    if (cls === 'mood-low') return ['有点蔫…', '陪我玩会儿嘛', '提不起劲…'];
    if (cls === 'mood-happy') return ['今天超开心！', '嘿嘿～', '最喜欢你啦'];
    return null;
  }

  /** 兼容旧数据：缺 cooldowns 时补齐 */
  function ensureShape(stats, now) {
    const t = Number.isFinite(now) ? now : Date.now();
    const s = Object.assign({}, stats || {});
    s.hunger = clamp100(Number(s.hunger));
    s.mood = clamp100(Number(s.mood));
    s.bond = Math.max(0, Number(s.bond) || 0);
    s.level = levelFor(s.bond);
    s.lastTickAt = Number.isFinite(s.lastTickAt) ? s.lastTickAt : t;
    const ti = s.todayInteractions && typeof s.todayInteractions === 'object' ? s.todayInteractions : {};
    s.todayInteractions = {
      date: typeof ti.date === 'string' ? ti.date : todayKey(t),
      count: Math.max(0, Number(ti.count) || 0),
    };
    s.cooldowns = s.cooldowns && typeof s.cooldowns === 'object' ? s.cooldowns : {};
    for (const k of INTERACTIONS) if (!Number.isFinite(s.cooldowns[k])) s.cooldowns[k] = 0;
    return s;
  }

  return {
    RULES, INTERACTIONS,
    tick, applyInteraction, levelFor, progressFor, moodClass, linesFor,
    todayKey, ensureShape, clamp100, effectiveHours,
  };
});
