// 根实例：hash 路由 + 布局（本地/云端双模式；云端未登录时显示登录页）
(function () {
  let petMounted = false;
  function mountPet() {
    if (petMounted || window.store.authRequired) return;
    petMounted = true;
    // 电子宠物：由独立的 PetWidget 模块接管（自管 DOM / rAF / 指针事件，不进 Vue），
    // 挂载完成后即"蹦"到右下角；Vue 后续的页面切换、重渲染都不会影响它。
    if (window.PetWidget) window.PetWidget.mount();
  }

  const app = Vue.createApp({
    data: () => ({
      route: location.hash || '#/',
      theme: localStorage.getItem('tidy-theme') || 'dark',
      toast: '',
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
    },
    methods: {
      toggleTheme() { this.theme = this.theme === 'dark' ? 'light' : 'dark'; },
      notify(msg) { this.toast = msg; setTimeout(() => (this.toast = ''), 2600); },
    },
    template: `
    <side-nav v-if="!store.authRequired" :view="view"></side-nav>
    <top-bar v-if="!store.authRequired" :theme="theme" @toggle-theme="toggleTheme"></top-bar>
    <main class="main" v-if="!store.authRequired">
      <dashboard v-if="view==='dashboard'"></dashboard>
      <studio v-else-if="view==='studio'"></studio>
      <scan-intake v-else-if="view==='scan'"></scan-intake>
      <search-page v-else-if="view==='search'"></search-page>
      <stats-page v-else-if="view==='stats'"></stats-page>
      <settings-page v-else-if="view==='settings'"></settings-page>
      <div v-else class="glass card"><div class="empty">页面不存在</div></div>
      <div class="footer-note" style="text-align:center;color:var(--text-3);font-size:12px;margin:34px 0 8px">
        TidyLab · 实验室物品收纳管理系统 · {{ isCloud ? '数据云端同步（多设备可用）' : '数据保存在本机' }}
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
  // 等启动引导完成（本地模式立即；云端模式需等待会话检查/登录）再挂载
  window.__tidyBoot.then(() => {
    app.mount('#app');
    mountPet();
  });
})();
