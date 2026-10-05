window.Components = window.Components || {};
window.Components.SearchPage = {
  data: () => ({
    q: '', mode: 'exact', results: [], usedMode: '', searched: false, busy: false, error: '',
    meta: { categories: [], zones: [] }, categoryId: '', zoneId: '',
  }),
  watch: {
    // 别处（总览拖拽移位 / 出入库 / 改名）改了数据 → 搜索结果里的位置与数量同步刷新
    'store.dataVersion'() { if (this.q.trim()) this.doSearch(); },
  },
  async mounted() {
    this.meta = await api('GET', '/stats/meta');
    const m = (location.hash.split('?')[1] || '').match(/q=([^&]+)/);
    if (m) { this.q = decodeURIComponent(m[1]); await this.doSearch(); }
  },
  methods: {
    setMode(m) { this.mode = m; if (this.q) this.doSearch(); },
    async doSearch() {
      if (!this.q.trim()) return;
      this.busy = true; this.error = '';
      try {
        const params = new URLSearchParams({ q: this.q, mode: this.mode });
        if (this.categoryId) params.set('categoryId', this.categoryId);
        if (this.zoneId) params.set('zoneId', this.zoneId);
        const r = await api('GET', '/search?' + params.toString());
        this.results = r.results; this.usedMode = r.mode; this.searched = true;
      } catch (e) { this.error = e.message; this.results = []; }
      finally { this.busy = false; }
    },
    openItem(id) { store.detailItemId = id; },
  },
  template: `
  <section class="screen">
    <div class="page-title">搜索</div>
    <div class="page-sub">精确匹配 + AI 语义推测 · 支持按类别 / 区域筛选</div>

    <div class="big-search liquid glass">
      🔎<input v-model="q" @keyup.enter="doSearch" placeholder="物品名，或模糊描述如「那个蓝色的测电压的东西」">
      <button class="btn-main" :disabled="busy" @click="doSearch">搜索</button>
    </div>

    <div class="form-row" style="margin-bottom:16px">
      <span class="chip" :class="{on: mode==='exact'}" @click="setMode('exact')" style="cursor:pointer">精确匹配</span>
      <span class="chip" :class="{on: mode==='semantic'}" @click="setMode('semantic')" style="cursor:pointer">AI 语义推测</span>
      <select v-model="categoryId" @change="doSearch" style="width:150px">
        <option value="">全部类别</option>
        <option v-for="c in meta.categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="zoneId" @change="doSearch" style="width:150px">
        <option value="">全部区域</option>
        <option v-for="z in meta.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
      </select>
    </div>

    <div class="ai-hint" v-if="error">⚠️ {{ error }}</div>
    <div class="ai-hint" v-if="searched && !error && usedMode==='semantic'">✨ 已使用 AI 语义理解，按匹配度排序。</div>
    <div class="ai-hint" v-if="searched && !error && usedMode==='exact-fallback'">⚠️ AI 语义服务暂不可用，已降级为关键词匹配。</div>

    <div v-if="searched && !results.length && !error" class="glass card"><div class="empty">没有找到匹配的物品</div></div>
    <div class="result glass lift" v-for="r in results" :key="r.id" @click="openItem(r.id)">
      <div class="thumb"><img v-if="r.img" :src="imgSrc(r.img)"><span v-else>📦</span></div>
      <div><div class="r-name">{{ r.name }}</div>
        <div class="r-loc" v-for="p in r.placements" :key="p.id">{{ p.path }} · 数量 {{ p.qty }}</div>
        <div class="r-loc" v-if="!r.placements.length">无在库位置</div>
      </div>
      <div class="r-right">
        <div class="r-qty">共 {{ r.totalQty }} 件</div>
        <div class="r-score" v-if="r.matchScore != null">匹配 {{ r.matchScore }}%</div>
        <div class="r-score">{{ r.category }}</div>
      </div>
    </div>
  </section>`,
};
