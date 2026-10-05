window.Components = window.Components || {};
window.Components.TopBar = {
  props: ['theme'],
  emits: ['toggle-theme', 'toast'],
  data: () => ({ q: '', now: new Date(), timer: null }),
  computed: {
    // 右上角当地时间：日期 + 星期（星期文案随语言切换）
    clockDate() {
      const d = this.now;
      const week = t('topbar.weekdays')[d.getDay()];
      const suffix = t('topbar.weekPrefix') ? t('topbar.weekPrefix') + week : week;
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${suffix}`;
    },
    // 时:分:秒（每秒跳动）
    clockTime() {
      const d = this.now;
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    },
  },
  mounted() {
    this.timer = setInterval(() => { this.now = new Date(); }, 1000);
  },
  beforeUnmount() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },
  methods: {
    go() { if (this.q.trim()) location.hash = '#/search?q=' + encodeURIComponent(this.q.trim()); },
  },
  template: `
  <header class="topbar liquid glass">
    <div class="brand"><div class="logo">🧊</div><span>{{ t('topbar.brand') }}</span></div>
    <div class="search glass">🔎<input v-model="q" :placeholder="t('topbar.searchPh')" @keyup.enter="go"></div>
    <div style="flex:1"></div>
    <div class="clock glass" :title="t('topbar.localTime') + ' ' + clockDate + ' ' + clockTime">
      <span class="clock-date">{{ clockDate }}</span>
      <b class="clock-time">{{ clockTime }}</b>
    </div>
    <div class="icon-pill glass" @click="$emit('toggle-theme')" :title="theme==='dark' ? t('topbar.toLight') : t('topbar.toDark')">{{ theme==='dark' ? '🌙' : '☀️' }}</div>
  </header>`,
};

// 模板外也可用的补零工具（定义在组件之外，模板里由 computed 调用）
function pad2(n) { return String(n).padStart(2, '0'); }
