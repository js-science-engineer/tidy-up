// M14 电子宠物「停止 / 重新开启」总开关
// 需求：用户能主动停止宠物模拟（彻底结束运行），也能随时手动开启。
// 无需浏览器：校验实现点是否齐全、停止后是否真的不再排程 / 不再渲染。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const pet = () => read('public/js/components/PetWidget.js');

test('M14.1 宠物模块暴露停止 / 开启的公开接口', () => {
  const src = pet();
  assert.ok(/Object\.assign\(window\.PetWidget,\s*\{/.test(src), '应把开关挂到 window.PetWidget 上');
  for (const k of ['isEnabled', 'setEnabled', 'stop', 'start']) {
    assert.ok(new RegExp('\\b' + k + '\\b').test(src), `缺少接口 ${k}`);
  }
  assert.ok(/window\.PetWidget = \{ mount: mount \}/.test(src), '原有 mount 接口不能丢');
});

test('M14.2 偏好持久化：按用户存 localStorage，刷新后保持一致', () => {
  const src = pet();
  assert.ok(/tidy-pet-enabled:/.test(src), '停止状态应落到 localStorage（key 带用户后缀）');
  assert.ok(/localStorage\.setItem\(ENABLE_KEY\(\)/.test(src), '切换时应写入偏好');
  assert.ok(/localStorage\.getItem\(ENABLE_KEY\(\)\)\s*!==\s*'0'/.test(src), '读取应以「非 0 即开启」为默认，老用户不受影响');
  // 启动时必须套用上次的偏好，否则刷新一下宠物又自己复活了
  assert.ok(/document\.body\.classList\.toggle\('pet-off', !petEnabled\(\)\)/.test(src), '启动时应按偏好恢复停止态');
});

test('M14.3 停止时真的是"结束运行"：计时器与逐帧动画全清', () => {
  const src = pet();
  const fn = /function suspendPet\(p\)\{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(fn, '应有 suspendPet');
  const body = fn[1];
  assert.ok(/_schedT/.test(body), '要停自动表演排程计时器');
  assert.ok(/_actT/.test(body), '要停当前动作的收尾计时器');
  assert.ok(/_sayT/.test(body), '要停气泡计时器');
  assert.ok(/setIdle\(p\)/.test(body), '要回到待机并清掉动作类名');
  // 转身是 rAF 循环，必须靠 cancelAnimationFrame 停，否则停止后还在逐帧跑
  assert.ok(/cancelAnimationFrame/.test(src) && /function clearAct\(p\)\{[\s\S]{0,120}cancelAnimationFrame/.test(src),
    '转身 rAF 必须被取消');
  // 再兜一层：停止后不允许再排自动表演
  assert.ok(/if \(!petEnabled\(\) \|\| !autoPlayOn\(\)\)/.test(src), 'schedule 应先判断总开关');
});

test('M14.4 停止后整层不渲染（display:none，比隐藏单只更彻底）', () => {
  const css = read('public/css/pet.css');
  assert.ok(/body\.pet-off \.pet-layer[\s\S]{0,80}display:\s*none/.test(css), '停止时宠物层不应参与绘制');
  assert.ok(/body\.pet-off \.pet-menu/.test(css), '停止时右键菜单也不应残留');
  // 重新开启入口是固定层，手机上不能带毛玻璃（否则等于多了个常驻模糊层）
  assert.ok(/body\.perf-lite \.ghost-bar\{[\s\S]{0,160}backdrop-filter:\s*none/.test(css), '性能模式下胶囊不要毛玻璃');
});

test('M14.5 三个入口都能停止：右键菜单 / 设置页 / 重新开启胶囊', () => {
  const src = pet();
  assert.ok(/id="pmStop"/.test(src), '右键菜单应有「停止宠物模拟」');
  assert.ok(/getElementById\('pmStop'\)\.addEventListener\('click', \(\) => \{ setEnabled\(false\); \}\)/.test(src),
    '菜单按钮要绑定停止动作');
  // 胶囊：未开启时点击 = 重新开启；开启时仍走原来的"恢复隐藏宠物"
  assert.ok(/if \(!petEnabled\(\)\)\{ setEnabled\(true\);/.test(src), '胶囊应能一键重新开启');
  assert.ok(/unhideAll\(\);/.test(src), '开启状态下胶囊仍应恢复隐藏的宠物');

  const set = read('public/js/components/SettingsPage.js');
  assert.ok(/petOn: true/.test(set), '设置页应有表示运行状态的数据');
  for (const k of ['setPetOn', '运行中', '已停止']) {
    assert.ok(set.includes(k), `设置页缺少 ${k}`);
  }
  assert.ok(/window\.PetWidget\.setEnabled\(on\)/.test(set), '设置页应调用统一开关');
  assert.ok(/isEnabled\(\)/.test(set), '设置页应读取当前状态，不能写死"运行中"');
});

test('M14.6 停止与"按需表演"是两个独立开关，互不覆盖', () => {
  const src = pet();
  // 停止走 ENABLE_KEY，自动表演走 AUTO_KEY，若共用一个 key 会互相踩
  assert.ok(/tidy-pet-auto:/.test(src) && /tidy-pet-enabled:/.test(src), '两个开关各用各的偏好键');
  const setEnabledFn = /function setEnabled\(on\)\{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(setEnabledFn, '应有 setEnabled');
  assert.ok(!/AUTO_KEY/.test(setEnabledFn[1]), '停止宠物不应顺手改掉"自动表演"偏好');
  const setAutoFn = /function setAutoPlay\(on\)\{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(setAutoFn && !/ENABLE_KEY/.test(setAutoFn[1]), '"自动表演"也不应改掉总开关');
});
