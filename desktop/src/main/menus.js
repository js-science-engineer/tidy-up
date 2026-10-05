'use strict';

/**
 * M6 菜单：托盘右键菜单与宠物身上右键菜单共用同一套模板（PRD 2.3）。
 * 模板构建是纯逻辑，可单测；副作用由 ctx.actions 注入。
 */

/**
 * @param {object} ctx
 *   state: { petVisible, wanderEnabled, autoStart }
 *   actions: { showPet, hidePet, feed, pet, play, sleep, openLooks, openSettings,
 *              toggleWander, toggleAutoStart, showAbout, quit }
 * @returns {Array} Electron Menu 模板
 */
function buildMenuTemplate(ctx) {
  const s = ctx.state || {};
  const a = ctx.actions || {};
  return [
    {
      label: s.petVisible ? '隐藏宠物' : '显示宠物',
      click: () => (s.petVisible ? a.hidePet && a.hidePet() : a.showPet && a.showPet()),
    },
    { type: 'separator' },
    { label: '喂食', click: () => a.feed && a.feed() },
    { label: '抚摸', click: () => a.pet && a.pet() },
    { label: '玩耍', click: () => a.play && a.play() },
    { label: '睡觉', click: () => a.sleep && a.sleep() },
    { type: 'separator' },
    { label: '形象管理…', click: () => a.openLooks && a.openLooks() },
    { label: '设置…', click: () => a.openSettings && a.openSettings() },
    { type: 'separator' },
    {
      label: '桌面散步',
      type: 'checkbox',
      checked: !!s.wanderEnabled,
      click: (item) => a.toggleWander && a.toggleWander(item.checked),
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!s.autoStart,
      click: (item) => a.toggleAutoStart && a.toggleAutoStart(item.checked),
    },
    { type: 'separator' },
    { label: '关于 js-pet', click: () => a.showAbout && a.showAbout() },
    { label: '退出', click: () => a.quit && a.quit() },
  ];
}

/**
 * 养成互动统一入口（IPC stats:interact 与菜单共用）。
 * 主进程是唯一写入者。@returns 互动结果（与 stats:interact 一致）
 */
function interact(repo, statsMod, kind) {
  const d = repo.data;
  if (!d) return { ok: false, reason: 'not-ready' };
  if (statsMod.INTERACTIONS.indexOf(kind) < 0) return { ok: false, reason: 'unknown' };

  const prevLevel = d.stats.level;
  const r = statsMod.applyInteraction(d.stats, kind, Date.now());
  repo.patch({ stats: r.stats });
  if (!r.ok) return { ok: false, reason: r.reason, stats: r.stats };
  const leveledUp = r.stats.level > prevLevel;
  return {
    ok: true,
    bondGained: !!r.bondGained,
    leveledUp,
    reason: leveledUp ? 'levelup' : undefined,
    stats: r.stats,
  };
}

module.exports = { buildMenuTemplate, interact };
