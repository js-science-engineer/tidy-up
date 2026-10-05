// M9 i18n 回归：中/英切换（设置页入口）
// 覆盖：词典 key 对齐、t() 取值/插值/回落、非法语言拒绝、
//       前端源码 t('...') 字面量 key 全部存在、动态导航 key、index.html 挂载顺序
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const I18N = require('../public/js/i18n.js');

// 收集词典全部叶子 key（数组视为叶子，不展开）
function flatKeys(dict, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of flatKeys(v, key)) out.add(sub);
    } else {
      out.add(key);
    }
  }
  return out;
}

test('M9.1 中英词典 key 完全一致（防漏翻）', () => {
  const zh = flatKeys(I18N.DICT.zh);
  const en = flatKeys(I18N.DICT.en);
  const missEn = [...zh].filter((k) => !en.has(k));
  const missZh = [...en].filter((k) => !zh.has(k));
  assert.deepEqual(missEn, [], 'en 缺少词条: ' + missEn.join(', '));
  assert.deepEqual(missZh, [], 'zh 多出词条: ' + missZh.join(', '));
  assert.ok(zh.size >= 60, '词条数量应 >= 60，实际 ' + zh.size);
});

test('M9.2 t() 取值 / 插值 / 缺失回落', () => {
  I18N.setLang('zh');
  assert.equal(I18N.t('nav.settings'), '设置');
  assert.equal(I18N.t('set.title'), '设置');

  I18N.setLang('en');
  assert.equal(I18N.t('nav.settings'), 'Settings');
  assert.equal(I18N.t('set.title'), 'Settings');

  // {vars} 插值
  const msg = I18N.t('set.restoreConfirm', { file: 'backup-1.zip' });
  assert.ok(msg.includes('backup-1.zip'), '插值应替换 {file}');

  // en 缺失 → 回落中文
  const saved = I18N.DICT.en.nav.settings;
  delete I18N.DICT.en.nav.settings;
  assert.equal(I18N.t('nav.settings'), '设置', 'en 缺失 key 应回落中文');
  I18N.DICT.en.nav.settings = saved;

  // 双语都缺失 → 显示 key 本身（便于发现漏项）
  assert.equal(I18N.t('set.__nope__'), 'set.__nope__');
});

test('M9.3 非法语言被忽略；星期表为 7 元素数组', () => {
  const before = I18N.getLang();
  assert.equal(I18N.setLang('fr'), before, '非法语言应被忽略且不改变当前语言');
  assert.equal(I18N.t('topbar.weekdays').length, 7, '星期表应 7 项');
  assert.ok(Array.isArray(I18N.t('topbar.weekdays')), '星期表应为数组');
});

test('M9.4 setLang 持久化（浏览器 localStorage 语义）', () => {
  // Node 无 localStorage：用桩验证读写路径
  const store = {};
  const sandbox = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8');
  const vm = require('node:vm');
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis;', ctx);
  vm.runInContext(src, ctx, { filename: 'i18n.js' });
  assert.equal(sandbox.t('nav.settings'), '设置', '无保存偏好时默认中文');
  sandbox.setLang('en');
  assert.equal(store['tidy-lang'], 'en', '偏好应写入 localStorage');
  // 重新加载模块：应从 localStorage 恢复英文
  const ctx2 = vm.createContext({ localStorage: { getItem: (k) => store[k] ?? null, setItem: () => {} } });
  vm.runInContext('globalThis.window = globalThis;', ctx2);
  vm.runInContext(src, ctx2, { filename: 'i18n.js' });
  assert.equal(ctx2.getLang(), 'en', '重启后应恢复上次选择的语言');
});

test('M9.5 前端源码里的 t("...") 字面量 key 全部存在', () => {
  const dirs = ['public/js', 'public/js/components', 'public/js/cloud'];
  const keys = new Set();
  for (const dir of dirs) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(full, f), 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) keys.add(m[1]);
    }
  }
  assert.ok(keys.size >= 40, '应扫到大量 t() 调用，实际 ' + keys.size);
  const bad = [];
  for (const key of keys) {
    if (key.endsWith('.')) continue; // 动态前缀（如 'nav.' + m.key）单独测
    for (const lang of ['zh', 'en']) {
      const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), I18N.DICT[lang]);
      if (v === undefined) bad.push(`${lang}:${key}`);
    }
  }
  assert.deepEqual(bad, [], '源码使用了词典中不存在的 key: ' + bad.join(', '));
});

test('M9.6 动态导航 key：每个模块都有 nav.<key> 词条', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'components', 'SideNav.js'), 'utf8');
  const keys = [...src.matchAll(/\{\s*key:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6, '应识别到 6 个导航模块');
  I18N.setLang('zh');
  const zhMissing = keys.filter((k) => I18N.t('nav.' + k).startsWith('nav.'));
  I18N.setLang('en');
  const enMissing = keys.filter((k) => I18N.t('nav.' + k).startsWith('nav.'));
  I18N.setLang('zh');
  assert.deepEqual(zhMissing, [], 'zh 缺少导航词条: ' + zhMissing.join(', '));
  assert.deepEqual(enMissing, [], 'en 缺少导航词条: ' + enMissing.join(', '));
});

test('M9.7 index.html 挂载顺序：i18n 在 Vue 之后、组件与 app.js 之前', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const order = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  const idx = (p) => order.indexOf(p);
  const vue = idx('/assets/vue.global.prod.js');
  const i18n = idx('/js/i18n.js');
  const firstComp = idx('/js/components/SideNav.js');
  const appJs = idx('/js/app.js');
  assert.ok(i18n > vue, 'i18n.js 应在 Vue 之后加载（需要 Vue.reactive）');
  assert.ok(i18n < firstComp, 'i18n.js 应在所有组件之前加载（组件模板引用 t()）');
  assert.ok(i18n < appJs, 'i18n.js 应在 app.js 之前加载（globalProperties 注入依赖它）');
});

test('M9.8 app.js 已注入 t/getLang/setLang（模板可用）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  for (const fn of ['t', 'getLang', 'setLang']) {
    assert.ok(src.includes(`globalProperties.${fn} = window.${fn}`), 'app.js 应注入 ' + fn);
  }
  // 设置页应有语言切换卡片与两个选项
  const settings = fs.readFileSync(path.join(ROOT, 'public', 'js', 'components', 'SettingsPage.js'), 'utf8');
  assert.ok(settings.includes("pickLang('zh')") && settings.includes("pickLang('en')"), '设置页应提供 中/English 两个切换项');
  assert.ok(settings.includes('getLang()'), '当前语言高亮应来自 getLang()');
});
