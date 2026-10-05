window.Components = window.Components || {};

// 六个主要模块的清单。顺序由用户自己决定（存在 localStorage），
// 排在第一位的模块同时也是"打开网站时的首页"。
window.NAV_MODULES = [
  { key: 'dashboard', icon: '🏠', label: '总览', hash: '#/dashboard' },
  { key: 'studio', icon: '🗄️', label: '收纳空间', hash: '#/studio' },
  { key: 'scan', icon: '📸', label: '识别入库', hash: '#/scan' },
  { key: 'search', icon: '🔍', label: '搜索', hash: '#/search' },
  { key: 'stats', icon: '📊', label: '统计看板', hash: '#/stats' },
  { key: 'settings', icon: '⚙️', label: '设置', hash: '#/settings' },
];
const NAV_ORDER_KEY = 'tidy-nav-order';

// 读取用户自定义顺序：过滤非法项，缺失的按默认补回（将来新增模块不会因旧数据而消失）
window.loadNavOrder = function () {
  let saved = [];
  try {
    if (typeof localStorage !== 'undefined') saved = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || '[]');
  } catch { saved = []; }
  const all = window.NAV_MODULES.map((m) => m.key);
  const out = Array.isArray(saved) ? saved.filter((k) => all.includes(k)) : [];
  for (const k of all) if (!out.includes(k)) out.push(k);
  return out;
};
window.saveNavOrder = function (order) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order));
  } catch { /* 隐私模式等写入失败时忽略 */ }
};
// 打开网站时的默认页 = 用户排在第一位的那项
window.navHome = function () {
  const o = window.loadNavOrder();
  return o[0] || 'dashboard';
};

window.Components.SideNav = {
  props: ['view'],
  data: () => ({ order: window.loadNavOrder(), sorting: false, dragKey: null, dropKey: null }),
  computed: {
    modules() {
      const byKey = new Map(window.NAV_MODULES.map((m) => [m.key, m]));
      return this.order.map((k) => byKey.get(k)).filter(Boolean);
    },
  },
  methods: {
    openSort() { this.sorting = true; },
    closeSort() { this.sorting = false; this.dragKey = null; this.dropKey = null; },
    // 统一出口：改顺序后立即持久化
    apply(arr) { this.order = arr; window.saveNavOrder(arr); },
    move(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= this.order.length) return;
      const arr = this.order.slice();
      [arr[i], arr[j]] = [arr[j], arr[i]];
      this.apply(arr);
    },
    resetOrder() { this.apply(window.NAV_MODULES.map((m) => m.key)); },
    onDragStart(m, e) {
      this.dragKey = m.key;
      if (e && e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.key); }
    },
    onDragOver(m) { if (this.dragKey && this.dragKey !== m.key) this.dropKey = m.key; },
    onDragLeave(m) { if (this.dropKey === m.key) this.dropKey = null; },
    onDrop(m) {
      const from = this.order.indexOf(this.dragKey);
      const to = this.order.indexOf(m.key);
      this.dragKey = null; this.dropKey = null;
      if (from < 0 || to < 0 || from === to) return;
      const arr = this.order.slice();
      arr.splice(to, 0, arr.splice(from, 1)[0]);
      this.apply(arr);
    },
    onDragEnd() { this.dragKey = null; this.dropKey = null; },
  },
  template: `
  <nav class="sidebar liquid glass">
    <a class="nav-btn" v-for="m in modules" :key="m.key" :class="{active: view===m.key}" :href="m.hash">
      <span class="ic">{{ m.icon }}</span><span class="tip">{{ t('nav.' + m.key) }}</span>
    </a>
    <a class="nav-btn sort-toggle" href="#" :class="{active: sorting}" @click.prevent="openSort" :title="t('nav.sort')">
      <span class="ic">⇅</span><span class="tip">{{ t('nav.sort') }}</span>
    </a>
  </nav>

  <!-- 调整模块顺序：拖拽或用 ▲▼ 微调，第一位即首页 -->
  <div class="modal-mask" v-if="sorting" @click.self="closeSort">
    <div class="modal glass" style="max-width:470px">
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:14px">
        <div class="recog-img" style="width:46px;height:46px;font-size:20px">⇅</div>
        <div style="flex:1">
          <div style="font-weight:650;font-size:16px">{{ t('nav.sort') }}</div>
          <div class="muted" style="font-size:12.5px">{{ t('nav.sortTip') }}</div>
        </div>
        <button class="btn-ghost" @click="closeSort">{{ t('nav.sortDone') }}</button>
      </div>
      <div class="sort-list">
        <div class="sort-row" v-for="(m, i) in modules" :key="m.key"
             :class="{dragging: dragKey===m.key, 'drop-hover': dropKey===m.key}"
             :draggable="true" @dragstart="onDragStart(m, $event)" @dragover.prevent="onDragOver(m)"
             @dragleave="onDragLeave(m)" @drop.prevent="onDrop(m)" @dragend="onDragEnd">
          <span class="drag-handle">⠿</span>
          <span class="sort-ic">{{ m.icon }}</span>
          <span class="sort-name">{{ t('nav.' + m.key) }}</span>
          <span class="sbtn" :class="{off: i===0}" @click="move(i, -1)" :title="t('nav.moveUp')">▲</span>
          <span class="sbtn" :class="{off: i===modules.length-1}" @click="move(i, 1)" :title="t('nav.moveDown')">▼</span>
        </div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <button class="btn-ghost" @click="resetOrder">{{ t('nav.sortReset') }}</button>
      </div>
    </div>
  </div>`,
};
window.Components.StatsPage = window.Components.StatsPage || { template: '<section class="screen"><div class="page-title">统计看板</div></section>' };
