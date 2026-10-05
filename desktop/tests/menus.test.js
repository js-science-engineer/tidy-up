'use strict';

/** M6 · 菜单模板与互动统一入口 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMenuTemplate, interact } = require('../src/main/menus');
const stats = require('../src/shared/stats');

const ACTIONS = [
  'showPet', 'hidePet', 'feed', 'pet', 'play', 'sleep',
  'openLooks', 'openSettings', 'toggleWander', 'toggleAutoStart', 'showAbout', 'quit',
];

function captureActions() {
  const calls = [];
  const actions = {};
  for (const name of ACTIONS) actions[name] = () => calls.push(name);
  return { actions, calls };
}

/** 按标签找菜单项 */
function findItem(template, label) {
  return template.find((it) => it.label === label);
}

test('M6 · 菜单包含 PRD 2.3 要求的全部条目', () => {
  const { actions } = captureActions();
  const t = buildMenuTemplate({
    state: { petVisible: true, wanderEnabled: false, autoStart: false },
    actions,
  });
  for (const label of ['隐藏宠物', '喂食', '抚摸', '玩耍', '睡觉', '形象管理…', '设置…', '桌面散步', '开机自启', '关于 js-pet', '退出']) {
    assert.ok(findItem(t, label), '缺少菜单项: ' + label);
  }
});

test('M6 · 显示/隐藏标签随宠物可见性切换，点击调用对应动作', () => {
  const { actions, calls } = captureActions();
  const visible = buildMenuTemplate({
    state: { petVisible: true, wanderEnabled: false, autoStart: false },
    actions,
  });
  const hidden = buildMenuTemplate({
    state: { petVisible: false, wanderEnabled: false, autoStart: false },
    actions,
  });
  assert.equal(findItem(visible, '隐藏宠物').label, '隐藏宠物');
  findItem(visible, '隐藏宠物').click();
  assert.deepEqual(calls, ['hidePet']);

  findItem(hidden, '显示宠物').click();
  assert.deepEqual(calls, ['hidePet', 'showPet']);
});

test('M6 · 漫游与自启是复选框且勾选态来自状态', () => {
  const t = buildMenuTemplate({
    state: { petVisible: true, wanderEnabled: true, autoStart: false },
    actions: captureActions().actions,
  });
  const wander = findItem(t, '桌面散步');
  const auto = findItem(t, '开机自启');
  assert.equal(wander.type, 'checkbox');
  assert.equal(auto.type, 'checkbox');
  assert.equal(wander.checked, true);
  assert.equal(auto.checked, false);

  const calls = [];
  wander.click({ checked: false });
  assert.ok(!calls.length, '模板不含副作用');
});

test('M6 · 副作用经 actions 注入：喂食/退出等点击可追踪', () => {
  const { actions, calls } = captureActions();
  const t = buildMenuTemplate({
    state: { petVisible: true, wanderEnabled: false, autoStart: false },
    actions,
  });
  findItem(t, '喂食').click();
  findItem(t, '设置…').click();
  findItem(t, '退出').click();
  assert.deepEqual(calls, ['feed', 'openSettings', 'quit']);
});

test('M6 · interact：成功互动写入 repo 并报告升级', () => {
  const now = Date.now();
  const repo = {
    data: {
      stats: {
        hunger: 50, mood: 50, bond: 0, level: 1,
        lastTickAt: now, todayInteractions: { date: stats.todayKey(now), count: 0 },
        cooldowns: { feed: 0, pet: 0, play: 0 },
      },
    },
    patch(p) { Object.assign(this.data.stats, p.stats); },
  };
  const r = interact(repo, stats, 'feed');
  assert.equal(r.ok, true);
  assert.ok(repo.data.stats.hunger > 50, '喂食要涨饱食度');
  assert.equal(r.leveledUp, false);
});

test('M6 · interact：冷却中返回 not ok 且仍推进时间结算', async () => {
  const now = Date.now();
  const repo = {
    data: {
      stats: {
        hunger: 50, mood: 50, bond: 0, level: 1,
        lastTickAt: now, todayInteractions: { date: stats.todayKey(now), count: 0 },
        cooldowns: { feed: now + 60000, pet: 0, play: 0 }, // 喂食还在冷却
      },
    },
    patch(p) { Object.assign(this.data.stats, p.stats); },
  };
  // 等几毫秒，确保与 applyInteraction 内部的 Date.now() 不落在同一毫秒
  await new Promise((r) => setTimeout(r, 8));
  const r = interact(repo, stats, 'feed');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cooldown');
  assert.ok(repo.data.stats.lastTickAt > now, '即使失败也要结算时间');
});

test('M6 · interact：未知类型拒绝', () => {
  const now = Date.now();
  const repo = { data: { stats: { cooldowns: {} } }, patch() {} };
  const r = interact(repo, stats, 'hack');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown');
});
