'use strict';

/**
 * 拖拽状态机测试。
 * 回归背景：拖动宠物时窗口冻结不跟随 —— 根因是拖拽期间鼠标穿透被重新打开。
 * 对应修复：dragController.mustIgnoreMouse() 拖拽中恒返回 false。
 */

const test = require('node:test');
const assert = require('node:assert');
const { createDragController, MOVE_THRESHOLD } = require('../src/shared/dragController');

test('M4 · 初始状态：未按下、未拖拽、默认穿透', () => {
  const d = createDragController();
  assert.equal(d.dragging, false);
  assert.equal(d.mustIgnoreMouse(false), true); // 不在本体上 → 穿透
  assert.equal(d.mustIgnoreMouse(true), false);  // 在本体上 → 不穿透
});

test('M4 · 按下后小幅移动（<阈值）不进入拖拽', () => {
  const d = createDragController();
  d.onDown(100, 100);
  const r = d.onMove(102, 101); // 位移 2,1 < 4
  assert.equal(r.moved, false);
  assert.equal(d.dragging, false);
});

test('M4 · 超过阈值进入拖拽，位移为增量累计', () => {
  const d = createDragController();
  d.onDown(100, 100);
  const r1 = d.onMove(120, 105); // 20,5 ≥ 阈值
  assert.equal(r1.moved, true);
  assert.equal(r1.dx, 20);
  assert.equal(r1.dy, 5);
  const r2 = d.onMove(125, 103); // 相对上一帧 5,-2
  assert.equal(r2.moved, true);
  assert.equal(r2.dx, 25); // 累计
  assert.equal(r2.dy, 3);
});

test('M4 · takeDelta 取走累计位移后清零（IPC 发送后对账）', () => {
  const d = createDragController();
  d.onDown(0, 0);
  d.onMove(10, 0);  // 增量 (10,0)
  d.onMove(25, 4);  // 增量 (15,4) → 累计 (25,4)
  assert.deepEqual(d.takeDelta(), { dx: 25, dy: 4 });
  assert.deepEqual(d.takeDelta(), { dx: 0, dy: 0 });
});

test('M4 · 回归核心：拖拽期间绝不允许恢复穿透', () => {
  const d = createDragController();
  d.onDown(100, 100);
  d.onMove(150, 150); // 进入拖拽
  assert.equal(d.dragging, true);
  // 无论指针此刻是否悬停在本体上（拖快了必然脱出窗口），都不能穿透
  assert.equal(d.mustIgnoreMouse(false), false);
  assert.equal(d.mustIgnoreMouse(true), false);
});

test('M4 · 松开后恢复常规穿透决策', () => {
  const d = createDragController();
  d.onDown(100, 100);
  d.onMove(150, 150);
  const wasDrag = d.onUp();
  assert.equal(wasDrag, true);
  assert.equal(d.dragging, false);
  assert.equal(d.mustIgnoreMouse(false), true);
  assert.equal(d.mustIgnoreMouse(true), false);
});

test('M4 · 未发生位移的按下-抬起不算拖拽（保护单击抚摸）', () => {
  const d = createDragController();
  d.onDown(100, 100);
  const wasDrag = d.onUp();
  assert.equal(wasDrag, false);
});

test('M4 · pointercancel 同 onUp：清空状态并报告拖拽结果', () => {
  const d = createDragController();
  d.onDown(100, 100);
  d.onMove(140, 140);
  d.onUp();
  const second = d.onUp(); // 重复结束（窗口级兜底监听）不应报错
  assert.equal(second, false);
  assert.equal(d.dragging, false);
});

test('M4 · 阈值默认 4px，可覆盖', () => {
  assert.equal(MOVE_THRESHOLD, 4);
  const d = createDragController({ threshold: 10 });
  d.onDown(0, 0);
  assert.equal(d.onMove(9, 0).moved, false);
  assert.equal(d.onMove(11, 0).moved, true);
});

test('M4 · 未按下时 onMove 是无操作', () => {
  const d = createDragController();
  const r = d.onMove(999, 999);
  assert.equal(r.moved, false);
  assert.equal(r.dx, 0);
  assert.equal(r.dy, 0);
  assert.equal(d.dragging, false);
});
