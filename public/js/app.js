// 根实例：hash 路由 + 布局（本地/云端双模式；云端未登录时显示登录页）
(function () {
  // ------------------------------------------------------------------
  // 性能模式（perf-lite）：手机卡顿 / 发烫的总开关
  // 默认策略：触屏、窄屏、或低端设备（≤4 核 / ≤4GB 内存 / 省流量模式）→ 自动开启；
  // 桌面默认关闭。用户可在「设置 → 界面性能」里手动开关（localStorage 记住选择）。
  // 开启后由 app.css 关掉 backdrop-filter 玻璃模糊与背景光斑漂移，改用实心玻璃。
  // ------------------------------------------------------------------
  const PERF_KEY = 'tidy-perf-lite';
  function detectPerfLite() {
    try {
      const saved = localStorage.getItem(PERF_KEY);
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch { /* 隐私模式取不到 localStorage 时按设备判断 */ }
    const nav = navigator || {};
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer:coarse)').matches;
    const narrow = (window.innerWidth || 0) <= 860;
    const lowEnd = (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4)
      || (nav.deviceMemory && nav.deviceMemory <= 4)
      || (nav.connection && nav.connection.saveData === true);
    return !!(coarse || narrow || lowEnd);
  }
  window.__applyPerfLite = function (on) {
    if (document.body) document.body.classList.toggle('perf-lite', !!on);
    return !!on;
  };
  window.__perfLiteOn = function () { return !!(document.body && document.body.classList.contains('perf-lite')); };
  // 手动切换：写入偏好并立即生效（设置页用）
  window.__setPerfLite = function (on) {
    try { localStorage.setItem(PERF_KEY, on ? '1' : '0'); } catch { /* 忽略 */ }
    const r = window.__applyPerfLite(on);
    // 性能模式变了 → 宠物按新节奏重排（手机上会转为"按需表演"，待机时不再跑动画）
    if (window.__petAutoPlay) window.__petAutoPlay.reschedule();
    return r;
  };
  window.__applyPerfLite(detectPerfLite());

  let petMounted = false;
  function mountPet() {
    if (petMounted || window.store.authRequired) return;
    petMounted = true;
    // 电子宠物：由独立的 PetWidget 模块接管（自管 DOM / rAF / 指针事件，不进 Vue），
    // 挂载完成后即"蹦"到右下角；Vue 后续的页面切换、重渲染都不会影响它。
    if (window.PetWidget) window.PetWidget.mount();
  }

  // 顶部进度条：请求超过 160ms 还没回来才显示（本地极快时不闪一下）
  let busyTimer = 0;

  const app = Vue.createApp({
    data: () => ({
      route: location.hash || '#/',
      theme: localStorage.getItem('tidy-theme') || 'dark',
      toast: '',
      loading: false,      // 有请求在飞（顶栏细进度条）
    }),
    computed: {
      view() {
        const v = (this.route.split('?')[0] || '').replace(/^#\/?/, '');
        // 空 hash（首次打开）→ 落到用户在侧边栏排在第一位的模块
        if (!v) return typeof window.navHome === 'function' ? window.navHome() : 'dashboard';
        return v;
      },
      isCloud() { return window.store.mode === 'cloud'; },
    },
    watch: {
      // 任何在飞的请求都会让 store.pending 变化 → 顶栏显示"正在加载"，
      // 手机慢网时至少能看出是在跑，而不是点了没反应。
      'store.pending'(n) {
        clearTimeout(busyTimer);
        if (n > 0) busyTimer = setTimeout(() => { this.loading = true; }, 160);
        else this.loading = false;
      },
      theme(v) {
        localStorage.setItem('tidy-theme', v);
        document.body.classList.toggle('light', v === 'light');
      },
      // 登录成功 → 挂载宠物；登出保持隐藏
      'store.authRequired'(v) { if (!v) mountPet(); },
    },
    mounted() {
      document.body.classList.toggle('light', this.theme === 'light');
      window.addEventListener('hashchange', () => { this.route = location.hash || '#/'; window.scrollTo({ top: 0 }); });
      // 切到后台就暂停所有 CSS 动画（锁屏/切 App 时别继续耗电）
      const syncHidden = () => document.body.classList.toggle('page-hidden', document.hidden);
      document.addEventListener('visibilitychange', syncHidden);
      syncHidden();
      // 启动阶段的一次性提示（如"已加入实验室" / 邀请码无效）
      if (window.store.joinError) { this.notify('⚠️ ' + window.store.joinError); window.store.joinError = ''; }
      else if (window.store.notice) { this.notify(window.store.notice); window.store.notice = ''; }
    },
    methods: {
      toggleTheme() { this.theme = this.theme === 'dark' ? 'light' : 'dark'; },
      notify(msg) { this.toast = msg; setTimeout(() => (this.toast = ''), 2600); },
    },
    template: `
    <div class="route-progress" v-if="loading" role="status" aria-label="加载中"><i></i></div>
    <side-nav v-if="!store.authRequired" :view="view"></side-nav>
    <top-bar v-if="!store.authRequired" :theme="theme" @toggle-theme="toggleTheme" @toast="notify"></top-bar>
    <main class="main" v-if="!store.authRequired">
      <dashboard v-if="view==='dashboard'"></dashboard>
      <studio v-else-if="view==='studio'"></studio>
      <scan-intake v-else-if="view==='scan'"></scan-intake>
      <search-page v-else-if="view==='search'"></search-page>
      <stats-page v-else-if="view==='stats'"></stats-page>
      <lab-page v-else-if="view==='lab'"></lab-page>
      <settings-page v-else-if="view==='settings'"></settings-page>
      <div v-else class="glass card"><div class="empty">{{ t('app.notFound') }}</div></div>
      <div class="footer-note" style="text-align:center;color:var(--text-3);font-size:12px;margin:34px 0 8px">
        TidyLab · {{ t('footer.product') }} · {{ isCloud ? t('footer.cloud') : t('footer.local') }}
      </div>
    </main>
    <auth-page v-if="store.authRequired"></auth-page>
    <item-detail v-if="!store.authRequired"></item-detail>
    <div class="toast" v-if="toast">{{ toast }}</div>`,
  });
  for (const [name, comp] of Object.entries(window.Components)) app.component(name, comp);
  // ⚠️ 关键：Vue 模板表达式只能解析「组件实例自身」与「app.config.globalProperties」，
  // 不会回退到 window。api / imgSrc / store 只挂在 window 上时，模板里会全部取到 undefined，
  // 导致总览/统计/搜索/详情等页面渲染直接抛错、整页空白。必须在此显式注入。
  app.config.globalProperties.api = window.api;
  app.config.globalProperties.imgSrc = window.imgSrc;
  app.config.globalProperties.store = window.store;
  // i18n：t() 在模板里调用会追踪 reactive 语言状态 → 切换语言全界面即时刷新
  app.config.globalProperties.t = window.t;
  app.config.globalProperties.getLang = window.getLang;
  app.config.globalProperties.setLang = window.setLang;
  // 等启动引导完成（本地模式立即；云端模式需等待会话检查/登录）再挂载
  window.__tidyBoot.then(() => {
    app.mount('#app');
    mountPet();
  });
})();
