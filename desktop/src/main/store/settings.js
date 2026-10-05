'use strict';

/**
 * 设置合并（M5-3）：面板只允许提交合法的设置项，
 * 合并结果交给 schema.normalize 做最终钳制。
 * 纯函数，可单元测试。
 */

const { defaultData } = require('./schema');

/** 设置项白名单与范围（与 schema.normalize 保持一致） */
const LIMITS = {
  size: { min: 100, max: 260, fallback: 150 },
};

/**
 * 把面板提交的部分设置合并进当前设置。
 * @param {object} current 当前完整 settings
 * @param {object} patch 面板提交的部分设置（可含未知键，会被丢弃）
 * @returns {{ok:true, settings:object}|{ok:false, reason:string}}
 */
function mergeSettings(current, patch) {
  if (!patch || typeof patch !== 'object') return { ok: false, reason: '设置项不是合法对象' };
  const base = (current && typeof current === 'object')
    ? current
    : defaultData(0).settings;
  const out = {
    autoStart: typeof base.autoStart === 'boolean' ? base.autoStart : false,
    size: Number.isFinite(base.size) ? base.size : LIMITS.size.fallback,
    wanderEnabled: typeof base.wanderEnabled === 'boolean' ? base.wanderEnabled : false,
  };

  if ('autoStart' in patch) {
    if (typeof patch.autoStart !== 'boolean') return { ok: false, reason: 'autoStart 必须是布尔值' };
    out.autoStart = patch.autoStart;
  }
  if ('wanderEnabled' in patch) {
    if (typeof patch.wanderEnabled !== 'boolean') return { ok: false, reason: 'wanderEnabled 必须是布尔值' };
    out.wanderEnabled = patch.wanderEnabled;
  }
  if ('size' in patch) {
    const n = Number(patch.size);
    if (!Number.isFinite(n)) return { ok: false, reason: 'size 必须是数字' };
    out.size = Math.round(Math.min(LIMITS.size.max, Math.max(LIMITS.size.min, n)));
  }
  return { ok: true, settings: out };
}

module.exports = { mergeSettings, LIMITS };
