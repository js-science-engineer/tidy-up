// M6 前端静态回归：模板可编译、组件已注册、index.html 脚本已挂载
// （无需浏览器：用 Vue 官方编译器在 Node 中解析每个组件模板，捕获语法错误与漏注册）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const COMPONENT_DIR = path.join(ROOT, 'public', 'js', 'components');

// 原生 HTML 标签白名单（其余按自定义组件处理）
const NATIVE_TAGS = new Set(('div span section header footer nav main a button input select option optgroup label h1 h2 h3 h4 h5 h6 b i u em strong small br hr img picture source video audio canvas svg path circle rect g line text p ul ol li dl dt dd table thead tbody tr td th form textarea pre code blockquote figure figcaption article aside template slot span').split(' '));

function loadVueGlobal() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'vue.global.prod.js'), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, navigator: { userAgent: 'node' } };
  vm.createContext(sandbox);
  // 浏览器全局构建依赖 window/self；在隔离上下文里把它们指向全局自身
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', sandbox);
  // 编译器做实体解码时会用到 document，这里给一个最小桩（只影响实体解码，不影响语法校验）
  vm.runInContext(`
    (function () {
      function makeEl() {
        let html = '';
        const el = {
          children: [], childNodes: [], textContent: '',
          get innerHTML() { return html; },
          set innerHTML(v) {
            html = String(v);
            const m = /foo="([\\s\\S]*)"/.exec(html);
            el.children = [{ getAttribute: (n) => (n === 'foo' ? (m ? m[1] : '') : null) }];
            el.textContent = html.replace(/<[^>]*>/g, '');
          },
          getAttribute: () => null, setAttribute: () => {}, appendChild: () => {},
        };
        return el;
      }
      globalThis.document = {
        createElement: makeEl,
        createTextNode: (t) => ({ textContent: t }),
        createComment: (t) => ({ textContent: t }),
      };
    })();
  `, sandbox);
  // 全局构建在浏览器里以 var Vue = ... 暴露，用 vm 执行以取得 window.Vue
  vm.runInContext(src, sandbox, { filename: 'vue.global.prod.js' });
  return sandbox;
}

function loadComponents(box) {
  vm.runInContext('window.Components = window.Components || {};', box);
  // i18n 必须先于组件加载（与 index.html 的脚本顺序一致）：组件内的 t() 依赖它
  const i18nSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8');
  vm.runInContext(i18nSrc, box, { filename: 'i18n.js' });
  for (const f of fs.readdirSync(COMPONENT_DIR).filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(COMPONENT_DIR, f), 'utf8');
    vm.runInContext(code, box, { filename: f });
  }
  return box.window.Components;
}

test('M6.1 所有组件模板可被 Vue 编译（无模板语法错误）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);
  const names = Object.keys(comps);
  assert.ok(names.length >= 8, '组件数量应 >= 8，实际 ' + names.length);
  for (const name of names) {
    const tpl = comps[name].template;
    assert.ok(typeof tpl === 'string' && tpl.trim().length, name + ' 缺少 template');
    let err = null;
    try {
      box.__tpl = tpl;
      vm.runInContext('window.__compileErr = null; try { Vue.compile(window.__tpl); } catch (e) { window.__compileErr = e.message; }', box);
      err = box.window.__compileErr;
    } catch (e) { err = e.message; }
    assert.equal(err, null, `${name} 模板编译失败：${err}`);
  }
});

test('M6.2 根模板引用的所有组件都已注册（防漏挂/拼错标签）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);
  const appTpl = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const tags = new Set([...appTpl.matchAll(/<([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  const missing = [];
  for (const tag of tags) {
    if (NATIVE_TAGS.has(tag)) continue;
    const pascal = tag.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
    if (!comps[pascal]) missing.push(`${tag} → ${pascal}`);
  }
  assert.equal(missing.length, 0, '根模板引用了未注册组件：' + missing.join('，'));
});

test('M6.3 index.html 引用的脚本/样式文件真实存在', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 10, 'index.html 应引用至少 10 个静态资源');
  const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, 'public', r.replace(/^\//, ''))));
  assert.equal(missing.length, 0, 'index.html 引用了不存在的文件：' + missing.join('，'));
  // 每个组件文件都应被挂载（防止新增组件忘加 script 标签）
  const compFiles = fs.readdirSync(COMPONENT_DIR).filter((f) => f.endsWith('.js'));
  const notLinked = compFiles.filter((f) => !refs.includes('/js/components/' + f));
  assert.equal(notLinked.length, 0, '这些组件文件未在 index.html 中挂载：' + notLinked.join('，'));
});

test('M6.4 总览/统计模板消费了后端真实字段（防字段名对不上导致空白）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);
  const dash = comps.Dashboard.template;
  // 总览必须渲染柜内物品明细与分类分布，否则会出现"总览没有画面"
  for (const token of ['ov.zones', 'z.cabinets', 'c.shelves', 's.items', 'item-chip', 'ov.categoryDist']) {
    assert.ok(dash.includes(token), '总览模板应包含 ' + token);
  }
  assert.ok(dash.includes('@click.stop="openItem(p.id)"'), '柜内物品应可点击查看详情');
  assert.ok(dash.includes('goStudio(c.id)'), '柜子应可跳转收纳空间');
  const stats = comps.StatsPage.template;
  for (const token of ['b.totals', 'b.categoryDist', 'b.zoneOccupancy', 'b.topItems', 'b.trend']) {
    assert.ok(stats.includes(token), '统计看板模板应包含 ' + token);
  }
});

test('M6.5 识别页使用用户照片为实物图且名称可编辑（v1.2 需求）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);
  const scan = comps.ScanIntake.template;
  assert.ok(scan.includes('photoUrl'), '识别卡应显示用户拍摄的原图');
  assert.ok(!scan.includes('webImg(mainPick'), '不应再出现联网配图点选');
  assert.ok(scan.includes('edits[i].name'), '识别卡名称可编辑');
  const detail = comps.ItemDetail.template;
  assert.ok(detail.includes('saveEdit'), '物品详情应支持改名保存');
  assert.ok(detail.includes('form.name'), '物品详情应有名称输入框');
});

test('M6.6 总览拖拽物品移位：可拖到「别的柜子」或「指定层」（v1.3 起，v1.6 增强整柜投放）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);
  const dash = comps.Dashboard;
  const tpl = dash.template;

  // ① 物品芯片可拖拽
  assert.ok(tpl.includes('draggable="true"'), '物品芯片应可拖拽');
  assert.ok(tpl.includes('@dragstart="onDragStart'), '拖拽开始应记录来源');
  assert.ok(tpl.includes('@dragend'), '拖拽结束应清理状态');

  // ② 层是精确投放目标：dragover 必须阻止默认（否则浏览器不派发 drop）
  assert.ok(tpl.includes('@dragover.prevent.stop="onShelfOver'), '层必须允许 dragover 并阻止冒泡到柜子');
  assert.ok(tpl.includes('@drop.prevent.stop="onShelfDrop'), '层应接收 drop 并阻止冒泡');

  // ③ 整个柜子也是投放目标（用户要的「拖放到别的柜子里面」）
  assert.ok(tpl.includes('@dragover.prevent="onCabOver'), '柜子应可接收 dragover');
  assert.ok(tpl.includes('@drop.prevent="onCabDrop'), '柜子应可接收 drop');

  // ④ 高亮钩子 + 拖拽提示条
  assert.ok(tpl.includes('drop-hover'), '投放目标应有高亮样式钩子');
  assert.ok(tpl.includes('dropCab === c.id'), '整柜投放应有独立高亮状态');
  assert.ok(tpl.includes('drag-mode'), '拖拽中应给所有目标加可视提示类');
  assert.ok(tpl.includes('drag-hint'), '拖拽中应有悬浮提示条');
  assert.ok(tpl.includes('dragHint'), '提示条应显示目标描述');

  // ⑤ 方法齐备（层 + 柜 + 统一移位）
  for (const m of ['onDragStart', 'onDragEnd', 'onShelfOver', 'onShelfLeave', 'onShelfDrop',
    'onCabOver', 'onCabLeave', 'onCabDrop', 'doMove', 'cabTargetShelf', 'shelfQty',
    'shownItems', 'isExpanded', 'toggleExpand']) {
    assert.equal(typeof dash.methods[m], 'function', '缺少拖拽方法 ' + m);
  }
  assert.equal(typeof dash.computed.dragging, 'function', '应有 dragging 计算属性');
  assert.equal(typeof dash.computed.dragHint, 'function', '应有 dragHint 计算属性');

  // ⑥ 真的调移位接口 + placementId 定位 + 全站同步
  const src = fs.readFileSync(path.join(COMPONENT_DIR, 'Dashboard.js'), 'utf8');
  assert.ok(src.includes('/move'), '拖动应调用移位接口');
  assert.ok(src.includes('placementId'), '移位应以 placementId 精确到某条存放记录');
  assert.ok(src.includes('store.dataVersion++'), '移位成功后应通知其它页面刷新');

  // ⑦ 整柜投放自动挑「最空的一层」，排除拖出前所在层
  assert.ok(src.includes('fromShelf'), '整柜投放应排除原层');
  assert.ok(src.includes('sort((a, b) => this.shelfQty(a) - this.shelfQty(b))'), '整柜投放应选最空的一层');

  // ⑧ 大于 4 项时能展开全部（否则被折叠的物品无法拖动）
  assert.ok(tpl.includes('shownItems(s)'), '物品列表应支持展开/收起');
  assert.ok(tpl.includes('toggleExpand(s.id)'), '+N 应可展开全部物品');
});

// ---- M6.7：模板标识符必须真实可解析（v1.4 真实缺陷回归） ----
// 背景：Vue 模板表达式只能解析「组件自身属性」与 app.config.globalProperties，
// 不会回退到 window。此前 api/imgSrc/store 只挂在 window 上，导致所有页面在浏览器里
// 渲染崩溃（总览/搜索/统计全空白），而 node --test 只查模板字符串，未能发现。
// 做法：静态扫描每个模板里的裸标识符，凡是「既不是组件自身属性、也不是注入的全局助手、
// 也不是 v-for/箭头函数形参/JS 内建」的，一律视为会在浏览器里 undefined 的隐患。
const JS_BUILTIN = new Set(('true false null undefined NaN Infinity this typeof new in of instanceof return if else for while do switch case break continue function var let const class extends super delete void yield async await try catch finally throw debugger default with arguments Math Date JSON Number String Boolean Object Array Symbol Promise RegExp Error Map Set WeakMap WeakSet parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURIComponent alert confirm prompt setTimeout clearTimeout setInterval clearInterval location navigator window document console FormData URLSearchParams URL Blob File FileReader').split(' '));

function ownKeysOf(comp) {
  const keys = new Set();
  for (const k of ['data', 'computed', 'methods', 'props']) {
    const v = comp[k];
    if (!v) continue;
    if (Array.isArray(v)) { for (const x of v) keys.add(x); continue; }
    const obj = (k === 'data' && typeof v === 'function') ? (v() || {}) : v;
    for (const x of Object.keys(obj)) keys.add(x);
  }
  if (comp.watch) for (const k of Object.keys(comp.watch)) keys.add(k.split('.')[0]);
  return keys;
}

// 从模板中抽取 JS 表达式（插值 + 指令值）
function templateExprs(tpl) {
  const out = [];
  for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push(m[1]);
  for (const m of tpl.matchAll(/\s(?:v-[\w:-]+|:[\w:-]+|@[\w.:-]+)="([^"]*)"/g)) out.push(m[1]);
  return out;
}

// 扫描一个表达式里"来源不明的裸标识符"
function unknownIds(expr, known, aliases) {
  // 去掉字符串字面量（避免把字符串内容当标识符）
  const code = expr.replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""').replace(/`[^`]*`/g, '``');
  const local = new Set(aliases);
  // 形参 / const 声明（模板里会有箭头函数与局部声明）
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) local.add(m[1]);
  for (const m of code.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*(?:,|\)|=>)/g)) local.add(m[1]);
  for (const m of code.matchAll(/[(,]\s*([A-Za-z_$][\w$]*)\s*(?:=[^=]|[,)])/g)) local.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);

  const bad = [];
  for (const m of code.matchAll(/(?<![\w$.'`])\b([A-Za-z_$][\w$]*)\b/g)) {
    const id = m[1];
    const before = code.slice(Math.max(0, m.index - 1), m.index);
    if (before === '.') continue;                                  // 属性访问 obj.prop
    if (id.startsWith('$')) continue;                              // $event/$root 等实例成员
    // 对象字面量的键（前面是 { 或 , 且后面紧跟冒号）
    const rest = code.slice(m.index);
    if (/^[\w$]+\s*:/.test(rest) && /[{\,]\s*$/.test(code.slice(0, m.index))) continue;
    if (known.has(id) || local.has(id) || JS_BUILTIN.has(id)) continue;
    bad.push(id);
  }
  return bad;
}

test('M6.7 模板里用到的每个标识符都必须真实可解析（防整页渲染崩溃）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);

  // app.js 必须把全局助手注入 globalProperties（Vue 模板不回退到 window）
  const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const injected = new Set([...appSrc.matchAll(/globalProperties\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));
  for (const need of ['api', 'imgSrc', 'store']) {
    assert.ok(injected.has(need), 'app.js 应把 ' + need + ' 注入 app.config.globalProperties');
  }

  const problems = [];
  for (const [name, comp] of Object.entries(comps)) {
    const known = ownKeysOf(comp);
    for (const k of injected) known.add(k);
    // v-for 别名（近似：作用域按整个模板共享，宁可漏报不可误报）
    const aliases = new Set();
    for (const m of comp.template.matchAll(/v-for="\(?\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s*(?:,\s*([A-Za-z_$][\w$]*))?\s*\)?\s+(?:in|of)\s/g)) {
      [m[1], m[2], m[3]].forEach((a) => a && aliases.add(a));
    }
    for (const expr of templateExprs(comp.template)) {
      for (const id of unknownIds(expr, known, aliases)) {
        problems.push(`${name}: ${id}   （表达式：${expr.trim().slice(0, 60)}）`);
      }
    }
  }
  assert.equal(problems.length, 0,
    '以下标识符在模板中使用，但既不是组件属性也未注入 globalProperties（浏览器渲染时会取到 undefined）：\n' + problems.join('\n'));
});

// ---- v1.5：六个主要模块的顺序由用户决定 ----
test('M6.8 六个主要模块顺序可自定义（拖拽 + ▲▼ + 持久化）', () => {
  const box = loadVueGlobal();
  loadComponents(box);

  const mods = box.window.NAV_MODULES;
  assert.ok(Array.isArray(mods), '应导出 NAV_MODULES 模块清单');
  assert.equal(mods.length, 6, '应有 6 个主要模块，实际 ' + mods.length);
  const keys = mods.map((m) => m.key);
  for (const k of ['dashboard', 'studio', 'scan', 'search', 'stats', 'settings']) {
    assert.ok(keys.includes(k), '模块清单缺少 ' + k);
  }
  for (const m of mods) {
    assert.ok(m.icon && m.label, m.key + ' 应有图标与名称');
    assert.ok(/^#\//.test(m.hash), m.key + ' 应有独立 hash（避免互相抢首页）');
  }
  // 顺序相关能力必须导出
  assert.equal(typeof box.window.loadNavOrder, 'function', '应能读取用户顺序');
  assert.equal(typeof box.window.saveNavOrder, 'function', '应能保存用户顺序');
  assert.equal(typeof box.window.navHome, 'function', '应能判定首页');
  assert.equal(box.window.navHome(), 'dashboard', '未自定义时首页应是默认第一项');

  const nav = box.window.Components.SideNav;
  const tpl = nav.template;
  assert.ok(tpl.includes('v-for="m in modules"'), '侧边栏应由顺序数据渲染，不能硬编码 6 个链接');
  assert.ok(tpl.includes('sort-row'), '应提供排序面板');
  assert.ok(tpl.includes('@dragover.prevent') && tpl.includes('@drop.prevent'), '排序面板应支持拖拽换位');
  assert.ok(tpl.includes('move(i, -1)') && tpl.includes('move(i, 1)'), '应提供 ▲▼ 微调（手机无拖拽也能排序）');
  for (const m of ['move', 'resetOrder', 'onDragStart', 'onDragOver', 'onDrop', 'onDragEnd', 'apply']) {
    assert.equal(typeof nav.methods[m], 'function', '缺少方法 ' + m);
  }

  const src = fs.readFileSync(path.join(COMPONENT_DIR, 'SideNav.js'), 'utf8');
  assert.ok(src.includes('localStorage.setItem'), '顺序应持久化到 localStorage（刷新/重启不丢）');
  const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  assert.ok(appSrc.includes('navHome'), '空 hash 打开时应落到用户排在第一位的模块');
});

// ---- v1.5：柜子可以绑定"实体柜子实拍照片" ----
test('M6.9 收纳空间支持给柜子添加实拍照片（v1.5）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);
  const studio = comps.Studio;
  const tpl = studio.template;

  assert.ok(tpl.includes('cab-photo'), '柜子卡片应展示实拍照片');
  assert.ok(tpl.includes('pickCabPhoto'), '柜子选项框应能添加/更换实拍照片');
  assert.ok(tpl.includes('removeCabPhoto'), '应能删除实拍照片');
  assert.ok(tpl.includes('album-cab'), '物品相册弹窗应展示柜子实拍照片');
  assert.ok(tpl.includes('ref="cabPhotoInput"'), '应有隐藏的图片选择输入框');
  for (const m of ['pickCabPhoto', 'onCabPhotoChange', 'removeCabPhoto']) {
    assert.equal(typeof studio.methods[m], 'function', '缺少方法 ' + m);
  }
  const src = fs.readFileSync(path.join(COMPONENT_DIR, 'Studio.js'), 'utf8');
  assert.ok(src.includes('/photo'), '应调用柜子照片接口');

  // 识别入库：选定柜子后显示该柜子的实拍照片，对照实物确认位置
  const scan = comps.ScanIntake;
  assert.ok(scan.template.includes('cabPhotoOf'), '识别页应展示所选柜子的实拍照片');
  assert.equal(typeof scan.methods.cabPhotoOf, 'function', '缺少方法 cabPhotoOf');
});

test('M6.10 右上角展示当地时间（日期 + 星期 + 每秒跳动）', () => {
  const box = loadVueGlobal();
  const comps = loadComponents(box);
  const bar = comps.TopBar;
  const tpl = bar.template;

  // 模板里必须有时间展示位，且用的是可解析的 computed（非 window 全局）
  assert.ok(tpl.includes('clock'), '右上角应有时间显示区');
  assert.ok(tpl.includes('clock-time'), '应显示时间');
  assert.ok(tpl.includes('clockDate'), '应显示日期与星期（模板标识符必须可解析）');
  assert.ok(tpl.includes('clockTime'), '应显示时分秒（模板标识符必须可解析）');
  assert.equal(typeof bar.computed.clockDate, 'function', '缺少 clockDate 计算属性');
  assert.equal(typeof bar.computed.clockTime, 'function', '缺少 clockTime 计算属性');

  // 生命周期：挂载后开启每秒定时更新，卸载时清理
  assert.equal(typeof bar.mounted, 'function', '应在 mounted 启动定时器');
  assert.equal(typeof bar.beforeUnmount, 'function', '应在 beforeUnmount 清理定时器');
  const src = fs.readFileSync(path.join(COMPONENT_DIR, 'TopBar.js'), 'utf8');
  assert.ok(src.includes('setInterval'), '应每秒刷新时间');
  assert.ok(src.includes('clearInterval'), '组件卸载应清理定时器（防内存泄漏）');
  assert.ok(src.includes('getSeconds'), '时间应精确到秒');

  // 时间格式：日期 + 星期中文
  const d = new Date(2026, 9, 4, 17, 5, 3); // 2026-10-04 周日
  const dateStr = bar.computed.clockDate.call({ now: d });
  const timeStr = bar.computed.clockTime.call({ now: d });
  assert.equal(dateStr, '2026-10-04 周日', '日期应形如 2026-10-04 周日，实际 ' + dateStr);
  assert.equal(timeStr, '17:05:03', '时间应补零为 HH:mm:ss，实际 ' + timeStr);
});

// ---- M6.11：电子宠物接入契约（v1.7 起，由 pet-demo-v3 移植） ----
test('M6.11 电子宠物已接入主站：打开网站自动蹦出、功能完整、样式隔离', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const petCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'pet.css'), 'utf8');
  const petJs = fs.readFileSync(path.join(COMPONENT_DIR, 'PetWidget.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');

  // 1) index.html 三件套齐全：样式 + 形象图像库 + 挂载器（顺序：库先于挂载器）
  assert.ok(html.includes('/css/pet.css'), 'index.html 应引入 pet.css');
  assert.ok(html.includes('/pet-assets/look-lib.js'), 'index.html 应引入形象图像库 look-lib.js');
  assert.ok(html.includes('/js/components/PetWidget.js'), 'index.html 应引入 PetWidget.js');
  assert.ok(html.indexOf('/pet-assets/look-lib.js') < html.indexOf('/js/components/PetWidget.js'),
    'look-lib.js 必须先于 PetWidget.js 加载');

  // 2) 默认素材与图像库真实存在（6 张姿势图 + 库）
  for (const f of ['pet_front.png', 'pet_sideA.png', 'pet_back.png', 'pet_sideB.png', 'pet_wave.png', 'pet_sleep.png', 'look-lib.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', 'pet-assets', f)), '缺少 public/pet-assets/' + f);
  }

  // 3) 挂载链路：app.js 在 Vue 挂载后调用 PetWidget.mount()（打开网站即蹦出）
  //    v0.7 起 Vue 挂载包在启动引导回调内（云端模式需等待登录检查），宠物经 mountPet() 在 mount 之后启动
  assert.ok(/app\.mount\('#app'\)/.test(appJs), 'app.js 应先挂载 Vue');
  assert.ok(/window\.PetWidget\.mount\(\)/.test(appJs), 'app.js 应调用 PetWidget.mount()');
  assert.ok(/app\.mount\('#app'\);\s*mountPet\(\);/.test(appJs), 'Vue 挂载后立即启动宠物');
  assert.ok(/function mountPet\(\)[\s\S]*?window\.PetWidget\.mount\(\)/.test(appJs), '宠物启动应经由 mountPet 守卫（未登录不蹦出）');
  assert.ok(/window\.PetWidget\s*=\s*\{\s*mount/.test(petJs), 'PetWidget 应暴露 mount()');

  // 4) 功能完整性（全部保留自 demo）：12 种状态 / 拖拽 / 追踪 / 右键菜单 / 形象系统
  for (const token of ["'wave'", "'excited'", "'dance'", "'jump'", "'walk'", "'look'", "'turn'", "'wiggle'", "'surprise'", "'nod'", "'sleep'", "'idle'"]) {
    assert.ok(petJs.includes(token), '宠物应包含状态 ' + token);
  }
  for (const fn of ['function startTurn', 'function trackStep', 'function onDown', 'function openMenu',
    'function openLook', 'function removePet', 'function hidePet', 'function unhideAll', 'function schedule']) {
    assert.ok(petJs.includes(fn), 'PetWidget 缺少核心函数 ' + fn);
  }
  assert.ok(petJs.includes("length <= 1"), '删除应有"至少保留一只"保护');
  assert.ok(petJs.includes("'tidy-pet-look:'"), '自定义形象应持久化到 localStorage（键按用户隔离）');
  assert.ok(petJs.includes('TIDY_UID'), '形象键应携带用户标识（多账号隔离）');
  assert.ok(petJs.includes('PetLook.analyze'), '形象面板应支持一张图智能分析切分');
  assert.ok(petJs.includes('lookResetArmed'), '恢复默认图像应有二次确认');

  // 5) 不残留 demo 壳（正式站没有标题/动作按钮面板/统一大小滑块）
  for (const bad of ['btnTheme', 'btnAdd', 'btnResetAll', "querySelectorAll('.acts", "getElementById('sizeR')"]) {
    assert.ok(!petJs.includes(bad), '不应残留 demo 控制区引用：' + bad);
  }

  // 6) 样式隔离与层级：宠物层不拦截页面点击，z-index 处于主内容(10)与弹层(90)之间
  const layerRule = petCss.match(/\.pet-layer\{[^}]*\}/);
  assert.ok(layerRule, 'pet.css 应定义 .pet-layer');
  assert.ok(/pointer-events:\s*none/.test(layerRule[0]), '宠物层必须 pointer-events:none（点击穿透）');
  const z = +(/z-index:(\d+)/.exec(layerRule[0]) || [0, 0])[1];
  assert.ok(z > 10 && z < 90, '宠物层 z-index 应在主内容与弹层之间，实际 ' + z);
  // 不覆盖主站全局（pet.css 不得定义 :root 的主站同名变量或 body 背景）
  assert.ok(!/--glass:|--text:|--a1:/.test(petCss.split('/* 宠物专属语义色')[1] || '--ok:1'),
    'pet.css 不得重定义主站设计 token（只能新增 --pet-* 变量）');
  const petVars = petCss.match(/--pet-[a-z-]+/g) || [];
  assert.ok(petVars.length >= 4, '宠物应使用 --pet-* 专属变量而非主站 token');
});
