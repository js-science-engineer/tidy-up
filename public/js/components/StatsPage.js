window.Components = window.Components || {};
window.Components.StatsPage = {
  data: () => ({ b: null, error: '', logFilter: 'all' }),
  computed: {
    catMax() {
      if (!this.b || !this.b.categoryDist.length) return 1;
      return Math.max(...this.b.categoryDist.map((c) => c.qty)) || 1;
    },
    trendMax() {
      if (!this.b || !this.b.trend.length) return 1;
      return Math.max(1, ...this.b.trend.map((t) => Math.max(t.inQty, t.outQty)));
    },
    trendTotal() {
      if (!this.b) return { inQty: 0, outQty: 0 };
      return this.b.trend.reduce((a, t) => ({ inQty: a.inQty + t.inQty, outQty: a.outQty + t.outQty }), { inQty: 0, outQty: 0 });
    },
    filteredLogs() {
      if (!this.b) return [];
      return this.logFilter === 'all' ? this.b.recentLogs : this.b.recentLogs.filter((l) => l.action === this.logFilter);
    },
    logCounts() {
      const c = { all: 0, in: 0, out: 0, move: 0, edit: 0 };
      for (const l of (this.b && this.b.recentLogs) || []) { c.all++; if (c[l.action] !== undefined) c[l.action]++; }
      return c;
    },
  },
  watch: { 'store.dataVersion'() { this.load(); } },
  async mounted() { await this.load(); },
  methods: {
    async load() {
      try { this.b = await api('GET', '/stats/board'); this.error = ''; }
      catch (e) { this.error = e.message; }
    },
    openItem(id) { if (id) store.detailItemId = id; },
    actionName(a) { return { in: '入库', out: '出库', move: '移位', edit: '修正' }[a] || '记录'; },
    h(v) { return Math.max(2, Math.round((v / this.trendMax) * 100)) + '%'; },
    pct(v, max) { return Math.max(2, Math.round((v / (max || 1)) * 100)) + '%'; },
  },
  template: `
  <section class="screen">
    <div class="page-title">统计看板</div>
    <div class="page-sub" v-if="b">库房全局数据一览 · 近 7 天入库 {{ trendTotal.inQty }} 件 / 出库 {{ trendTotal.outQty }} 件</div>
    <div class="ai-hint" v-if="error">⚠️ {{ error }}</div>

    <div class="stats stats-5" v-if="b">
      <div class="stat glass lift"><div class="ic">📦</div><div class="num">{{ b.totals.items }}</div><div class="lbl">物品种类</div></div>
      <div class="stat glass lift"><div class="ic">🧮</div><div class="num">{{ b.totals.inStock }}</div><div class="lbl">在库件数</div></div>
      <div class="stat glass lift"><div class="ic">🗄️</div><div class="num">{{ b.totals.cabinets }}</div><div class="lbl">柜子</div></div>
      <div class="stat glass lift"><div class="ic">📚</div><div class="num">{{ b.totals.shelves }}</div><div class="lbl">层 / 抽屉</div></div>
      <div class="stat glass lift"><div class="ic">🧰</div><div class="num">{{ b.totals.boxes }}</div><div class="lbl">收纳箱</div></div>
    </div>

    <div class="glass card" v-if="b">
      <h3 class="sec" style="margin-top:0">📈 近 7 天出入库</h3>
      <div class="trend">
        <div class="trend-col" v-for="t in b.trend" :key="t.date">
          <div class="trend-bars">
            <i class="tb in" :style="{height: h(t.inQty)}" :title="'入库 ' + t.inQty"></i>
            <i class="tb out" :style="{height: h(t.outQty)}" :title="'出库 ' + t.outQty"></i>
          </div>
          <span class="trend-lbl">{{ t.label }}</span>
        </div>
      </div>
      <div class="legend"><span><i class="dot-in"></i>入库</span><span><i class="dot-out"></i>出库</span></div>
    </div>

    <div class="dash-2col" v-if="b">
      <div class="glass card">
        <h3 class="sec" style="margin-top:0">🏷️ 分类分布</h3>
        <div class="bars" v-if="b.categoryDist.length">
          <div class="bar-row" v-for="c in b.categoryDist" :key="c.name">
            <span class="bar-lbl">{{ c.name }}</span>
            <span class="bar-track"><i class="bar-fill" :style="{width: pct(c.qty, catMax)}"></i></span>
            <span class="bar-val">{{ c.qty }} 件</span>
          </div>
        </div>
        <div class="empty" v-else>还没有物品数据</div>
      </div>

      <div class="glass card">
        <h3 class="sec" style="margin-top:0">🗺️ 区域占用</h3>
        <div class="bars" v-if="b.zoneOccupancy.length">
          <div class="bar-row" v-for="z in b.zoneOccupancy" :key="z.name">
            <span class="bar-lbl">{{ z.name }}</span>
            <span class="bar-track"><i class="bar-fill" :style="{width: z.occupancy + '%'}"></i></span>
            <span class="bar-val">{{ z.occupancy }}%</span>
          </div>
        </div>
        <div class="empty" v-else>还没有区域</div>
      </div>
    </div>

    <div class="glass card" v-if="b">
      <h3 class="sec" style="margin-top:0">🔝 库存 TOP 10</h3>
      <div class="today-list">
        <div class="today-row" v-for="(it, i) in b.topItems" :key="it.id" @click="openItem(it.id)" style="cursor:pointer">
          <span class="chip">{{ i + 1 }}</span>
          <div class="recog-img" style="width:38px;height:38px;font-size:16px">
            <img v-if="it.img" :src="imgSrc(it.img)"><span v-else>📦</span>
          </div>
          <div class="grow">{{ it.name }} <span class="muted">{{ it.category || '未分类' }}</span></div>
          <span class="chip">{{ it.spots }} 处存放</span>
          <b>{{ it.qty }} 件</b>
        </div>
        <div v-if="!b.topItems.length" class="empty">还没有物品</div>
      </div>
    </div>

    <div class="glass card" v-if="b">
      <h3 class="sec" style="margin-top:0">📋 出入库记录
        <span style="margin-left:auto" class="muted">点某条记录可查看物品详情</span></h3>
      <div class="form-row" style="margin-bottom:12px">
        <span class="chip" :class="{on: logFilter==='all'}" @click="logFilter='all'" style="cursor:pointer">全部 {{ logCounts.all }}</span>
        <span class="chip" :class="{on: logFilter==='in'}" @click="logFilter='in'" style="cursor:pointer">入库 {{ logCounts.in }}</span>
        <span class="chip" :class="{on: logFilter==='out'}" @click="logFilter='out'" style="cursor:pointer">出库 {{ logCounts.out }}</span>
        <span class="chip" :class="{on: logFilter==='move'}" @click="logFilter='move'" style="cursor:pointer">移位 {{ logCounts.move }}</span>
        <span class="chip" :class="{on: logFilter==='edit'}" @click="logFilter='edit'" style="cursor:pointer">修正 {{ logCounts.edit }}</span>
      </div>
      <div class="today-list">
        <div class="today-row" v-for="l in filteredLogs" :key="l.id" @click="openItem(l.item_id)" style="cursor:pointer">
          <span class="chip" :class="{on: l.action==='in'}">{{ actionName(l.action) }}</span>
          <div class="recog-img" style="width:34px;height:34px;font-size:15px">
            <img v-if="l.img" :src="imgSrc(l.img)"><span v-else>📦</span>
          </div>
          <div class="grow">
            <b>{{ l.item_name || '（物品已删除）' }}</b>
            <span class="muted" v-if="l.qty"> · {{ l.qty }} 件</span>
            <div class="muted">{{ l.location || '—' }} <template v-if="l.detail">· {{ l.detail }}</template></div>
          </div>
          <span class="muted">{{ (l.created_at || '').slice(5, 16) }}</span>
        </div>
        <div v-if="!filteredLogs.length" class="empty">暂无{{ logFilter==='all' ? '' : actionName(logFilter) }}记录</div>
      </div>
    </div>
  </section>`,
};
