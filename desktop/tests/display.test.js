'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clampToDisplays, defaultPosition, findDisplayFor } = require('../src/main/display');

const SIZE = { width: 320, height: 400 };

const PRIMARY = { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const SECOND = { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };

test('M1-5 · 坐标在主屏内 → 原样保留', () => {
  const out = clampToDisplays({ x: 900, y: 500 }, [PRIMARY, SECOND], SIZE);
  assert.deepEqual(out, { x: 900, y: 500 });
});

test('M1-5 · 坐标完全落在主屏合法区域内（右下极限值）→ 原样保留', () => {
  const out = clampToDisplays({ x: 1600, y: 640 }, [PRIMARY, SECOND], SIZE);
  assert.deepEqual(out, { x: 1600, y: 640 });
});

test('M1-5 · 坐标在副屏内 → 不做跨屏搬家', () => {
  const out = clampToDisplays({ x: 2400, y: 300 }, [PRIMARY, SECOND], SIZE);
  assert.deepEqual(out, { x: 2400, y: 300 });
});

test('M1-5 · 部分越界 → 钳回该屏工作区内', () => {
  const out = clampToDisplays({ x: 1900, y: 1000 }, [PRIMARY], SIZE);
  assert.deepEqual(out, { x: 1600, y: 640 });
});

test('M1-5 · 坐标完全在所有显示器之外（负坐标）→ 回主屏右下角', () => {
  // 规格见 DEV_PLAN M1-5：不在任何显示器内 → 钳制到主屏右下角
  const out = clampToDisplays({ x: -500, y: -300 }, [PRIMARY], SIZE);
  assert.deepEqual(out, { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · 外接屏被拔掉（坐标落在不存在的区域）→ 回主屏右下角', () => {
  // 之前宠物在副屏 x=2400，现在副屏没了
  const out = clampToDisplays({ x: 2400, y: 300 }, [PRIMARY], SIZE);
  assert.deepEqual(out, { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · 多屏时优先回主屏而不是第一个显示器', () => {
  const notPrimaryFirst = [
    { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
    { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  ];
  const out = clampToDisplays({ x: 99999, y: 99999 }, notPrimaryFirst, SIZE);
  assert.deepEqual(out, { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · 无显示器信息时退化为原坐标，不抛异常', () => {
  assert.deepEqual(clampToDisplays({ x: 12, y: 34 }, [], SIZE), { x: 12, y: 34 });
  assert.deepEqual(clampToDisplays({ x: 12, y: 34 }, null, SIZE), { x: 12, y: 34 });
});

test('M1-5 · 显示器工作区小于窗口时不会产生负坐标', () => {
  const tiny = [{ id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 100, height: 100 } }];
  const out = clampToDisplays({ x: 500, y: 500 }, tiny, SIZE);
  assert.ok(out.x >= 0 && out.y >= 0, `不应出现负坐标，实际 ${JSON.stringify(out)}`);
});

test('M1-5 · 工作区带偏移（任务栏在左/上）时以 workArea 为基准', () => {
  const shifted = [{ id: 1, isPrimary: true, workArea: { x: 80, y: 40, width: 1840, height: 1000 } }];

  // 落在偏移后的工作区内 → 原样保留
  assert.deepEqual(clampToDisplays({ x: 100, y: 60 }, shifted, SIZE), { x: 100, y: 60 });

  // 落在工作区内但窗口会溢出 → 按 workArea 的四边钳制（证明用的是 workArea 而非屏幕 bounds）
  assert.deepEqual(clampToDisplays({ x: 1900, y: 1030 }, shifted, SIZE), { x: 1600, y: 640 });

  // 落在偏移工作区的左上之外 → 回落到该屏右下角（同样基于 workArea 计算）
  assert.deepEqual(clampToDisplays({ x: 0, y: 0 }, shifted, SIZE), { x: 1576, y: 616 });
});

test('M1-5 · defaultPosition 落在主屏右下角并留出边距', () => {
  assert.deepEqual(defaultPosition([PRIMARY, SECOND], SIZE), { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · defaultPosition 在无显示器信息时返回原点', () => {
  assert.deepEqual(defaultPosition([], SIZE), { x: 0, y: 0 });
});

test('M1-5 · findDisplayFor 命中判定为左闭右开', () => {
  assert.ok(findDisplayFor({ x: 0, y: 0 }, [PRIMARY]));
  assert.equal(findDisplayFor({ x: 1920, y: 0 }, [PRIMARY]), null, '右边界不属于该显示器');
  assert.ok(findDisplayFor({ x: 1920, y: 0 }, [SECOND]));
});
