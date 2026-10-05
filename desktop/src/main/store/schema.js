'use strict';

/**
 * 数据 schema：默认值 / 补全 / 版本迁移 / 恢复校验
 * ---------------------------------------------------------------
 * 对应 PRD 第 7 章与验收 B4 / F2。
 * 纯函数、不依赖 electron，可单元测试。
 */

const SCHEMA_VERSION = 1;
const stats = require('../../shared/stats');

/** 当天日期键（本地时区），用于"每日互动计数"的跨天重置 */
const todayKey = stats.todayKey;

function defaultData(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    position: null,                       // {x,y}，由主进程钳制后写入
    display: { monitorId: null },
    currentLookId: null,                  // null = 内置默认形象
    looks: [],                            // [{id,name,source,file,createdAt}]
    stats: {
      hunger: 80,
      mood: 80,
      bond: 0,
      level: 1,
      lastTickAt: t,
      todayInteractions: { date: todayKey(t), count: 0 },
      cooldowns: { feed: 0, pet: 0, play: 0 },
    },
    settings: {
      autoStart: false,
      size: 150,
      wanderEnabled: false,
    },
    meta: { createdAt: t, updatedAt: t },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 以 defaults 的键为准补齐缺失字段；不覆盖已有值；返回新对象 */
function fillMissing(target, defaults) {
  const out = Array.isArray(defaults) ? [] : {};
  for (const key of Object.keys(defaults)) {
    const d = defaults[key];
    const t = target ? target[key] : undefined;
    if (isPlainObject(d)) {
      out[key] = fillMissing(isPlainObject(t) ? t : {}, d);
    } else if (Array.isArray(d)) {
      out[key] = Array.isArray(t) ? t.slice() : d.slice();
    } else {
      out[key] = t === undefined || t === null ? d : t;
    }
  }
  return out;
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 补齐缺失字段 + 类型/范围修正，保证返回的数据永远合法可写 */
function normalize(input) {
  const base = fillMissing(isPlainObject(input) ? input : {}, defaultData(0));
  const now = Date.now();

  base.schemaVersion = clampNum(base.schemaVersion, 1, SCHEMA_VERSION, SCHEMA_VERSION);
  base.position = isPlainObject(base.position)
    && Number.isFinite(base.position.x) && Number.isFinite(base.position.y)
    ? { x: Math.round(base.position.x), y: Math.round(base.position.y) }
    : null;

  base.display = isPlainObject(base.display) ? base.display : {};
  base.display.monitorId = Number.isFinite(base.display.monitorId) ? base.display.monitorId : null;

  if (!Array.isArray(base.looks)) base.looks = [];
  base.looks = base.looks.filter((l) => isPlainObject(l) && l.id);

  const s = isPlainObject(base.stats) ? base.stats : {};
  const today = todayKey(now);
  const ti = isPlainObject(s.todayInteractions) ? s.todayInteractions : {};
  base.stats = {
    hunger: clampNum(s.hunger, 0, 100, 80),
    mood: clampNum(s.mood, 0, 100, 80),
    bond: clampNum(s.bond, 0, Number.MAX_SAFE_INTEGER, 0),
    level: clampNum(s.level, 1, 99, 1),
    lastTickAt: clampNum(s.lastTickAt, 0, now, now),
    todayInteractions: {
      date: typeof ti.date === 'string' ? ti.date : today,
      count: clampNum(ti.count, 0, 9999, 0),
    },
    cooldowns: (() => {
      const c = isPlainObject(s.cooldowns) ? s.cooldowns : {};
      const out = {};
      for (const k of stats.INTERACTIONS) {
        out[k] = clampNum(c[k], 0, Number.MAX_SAFE_INTEGER, 0);
      }
      return out;
    })(),
  };

  const st = isPlainObject(base.settings) ? base.settings : {};
  base.settings = {
    autoStart: !!st.autoStart,
    size: clampNum(st.size, 100, 260, 150),
    wanderEnabled: !!st.wanderEnabled,
  };

  base.meta = isPlainObject(base.meta) ? base.meta : {};
  base.meta.createdAt = clampNum(base.meta.createdAt, 0, now, now);
  base.meta.updatedAt = now;
  return base;
}

/**
 * 读取后的迁移入口。
 * @returns {{ok:true, data:object}|{ok:false, reason:string}}
 */
function migrate(raw) {
  if (!isPlainObject(raw)) return { ok: false, reason: '数据不是合法对象' };
  const v = Number(raw.schemaVersion);
  if (!Number.isFinite(v)) return { ok: false, reason: '缺少 schemaVersion' };
  if (v > SCHEMA_VERSION) {
    return { ok: false, reason: `数据版本 v${v} 比当前程序支持的 v${SCHEMA_VERSION} 更新，拒绝载入` };
  }
  // v1 即当前版本；未来新增字段时在此逐级 upgrade
  let data = raw;
  if (v < 1) data = Object.assign({}, data, { schemaVersion: 1 });
  return { ok: true, data: normalize(data) };
}

/** 手动恢复前的校验（对应验收 F2：版本不兼容必须明确拒绝） */
function validateForRestore(raw) {
  if (!isPlainObject(raw)) return { ok: false, reason: '备份文件内容不是合法 JSON 对象' };
  const v = Number(raw.schemaVersion);
  if (!Number.isFinite(v)) return { ok: false, reason: '备份缺少 schemaVersion 字段' };
  if (v > SCHEMA_VERSION) {
    return { ok: false, reason: `该备份由更新版本的 js-pet 生成（v${v} > v${SCHEMA_VERSION}），无法恢复` };
  }
  if (!isPlainObject(raw.stats)) return { ok: false, reason: '备份缺少养成数据 (stats)' };
  return { ok: true };
}

module.exports = {
  SCHEMA_VERSION,
  defaultData,
  fillMissing,
  normalize,
  migrate,
  validateForRestore,
  todayKey,
};
