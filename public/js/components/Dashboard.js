window.Components = window.Components || {};
window.Components.Dashboard = {
  data: () => ({
    ov: null, error: '', busy: false,
    drag: null,          // 正在拖动的物品 {itemId, placementId, fromShelf, fromBoxId, name}
    dropShelf: null,     // 悬停中的「层」投放目标 id
    dropCab: null,       // 悬停中的「整个柜子」投放目标 id
    moving: false,       // 移位请求进行中
    collapsed: [],       // 用户主动收起的层 id 列表（默认全部展开，保证能看到柜内所有物品）
    // ---- 实物图片放大（v2.4）----
    zoom: null,          // { src, name, sub } 正在放大的实物照片
    zoomed: false,       // 是否已放大到 2.4 倍（再点一下还原）
    zoomOx: 50, zoomOy: 50,   // 放大时的缩放中心（按点击位置）
  }),
  computed: {
    greeting() {
      const h = new Date().getHours();
      return h < 6 ? '夜深了' : h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好';
    },
    doorLabel() { return { double: '双开', single: '单开', drawer: '抽屉' }; },
    catMax() {
      if (!this.ov || !this.ov.categoryDist.length) return 1;
      return Math.max(...this.ov.categoryDist.map((c) => c.qty || c.kinds)) || 1;
    },
    // 拖拽进行中 → 所有可投放目标高亮
    dragging() { return !!this.drag; },
    // 拖拽提示条上的目标描述
    dragHint() {
      if (!this.drag) return '';
      if (this.dropShelf) return '松手即移到这一层';
      if (this.dropCab) return '松手即移入这个柜子';
      return '拖到任意柜子的某一层（或柜子空白处）松手';
    },
  },
  watch: {
    'store.dataVersion'() { this.load(); },
  },
  async mounted() {
    this._onKey = (e) => { if (e.key === 'Escape' && this.zoom) this.closeZoom(); };
    document.addEventListener('keydown', this._onKey);
    await this.load();
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this._onKey);
    this.unlockScroll();
  },
  methods: {
    async load() {
      try { this.ov = await api('GET', '/stats/overview'); this.error = ''; }
      catch (e) { this.error = e.message; }
    },
    openItem(id) { store.detailItemId = id; },

    // ---- 实物照片放大：总览里点照片直接看大图（手机上没有 hover，只能点开）----
    // zoom.img 存原始 key，渲染时经 imgSrc 取签名地址：云端模式下签名晚到也能自动换上真图
    openZoom(it, locLabel) {
      if (!it || !it.img) return;
      this.zoom = {
        img: it.img,
        name: it.name || it.item_name || '实物照片',
        sub: [locLabel || it.category, it.box ? '箱：' + it.box : '', it.qty ? '×' + it.qty : ''].filter(Boolean).join(' · '),
      };
      this.zoomed = false; this.zoomOx = 50; this.zoomOy = 50;
      document.body.classList.add('photo-open');
    },
    closeZoom() {
      this.zoom = null; this.zoomed = false;
      this.unlockScroll();
    },
    unlockScroll() { document.body.classList.remove('photo-open'); },
    // 点一下放大 / 再点还原（按点击位置作为缩放中心，手机上也能看清细节）
    toggleZoom(e) {
      if (!this.zoom) return;
      if (this.zoomed) { this.zoomed = false; return; }
      const el = e && e.currentTarget;
      if (el && el.getBoundingClientRect && (e.clientX || e.clientY)) {
        const r = el.getBoundingClientRect();
        this.zoomOx = Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / (r.width || 1)) * 100)));
        this.zoomOy = Math.max(0, Math.min(100, Math.round(((e.clientY - r.top) / (r.height || 1)) * 100)));
      }
      this.zoomed = true;
    },
    goStudio(cabinetId) { location.hash = '#/studio?focus=cabinet-' + cabinetId; },
    goScan() { location.hash = '#/scan'; },
    percent(v, max) { return Math.max(2, Math.round((v / (max || 1)) * 100)) + '%'; },

    // ---- 拖拽移位（v1.6）：把柜内物品从一层拖到「别的柜子」或「指定层」 ----
    isSameSpot(s) { return this.drag && s.id === this.drag.fromShelf && !this.drag.fromBoxId; },
    // 默认完整显示每一层里的所有物品（早期只显示 4 个再点"+N"，很容易漏看）
    isCollapsed(sid) { return this.collapsed.includes(sid); },
    toggleCollapse(sid) {
      const i = this.collapsed.indexOf(sid);
      if (i >= 0) this.collapsed.splice(i, 1); else this.collapsed.push(sid);
    },
    shownItems(s) { return this.isCollapsed(s.id) ? s.items.slice(0, 4) : s.items; },
    shelfQty(s) { return (s.items || []).reduce((n, p) => n + p.qty, 0); },
    // 整柜投放时自动选一层：优先「最空的一层」（排除拖出前所在层）
    cabTargetShelf(c) {
      const list = (c.shelves || []).slice();
      if (!list.length) return null;
      const others = list.filter((s) => !this.drag || s.id !== this.drag.fromShelf);
      const pool = others.length ? others : list;
      return pool.sort((a, b) => this.shelfQty(a) - this.shelfQty(b))[0];
    },

    onDragStart(p, s, ev) {
      if (!p.placementId) return; // 无存放记录（理论不会出现）则不可拖
      this.drag = { itemId: p.id, placementId: p.placementId, fromShelf: s.id, fromBoxId: p.boxId || null, name: p.name };
      if (ev && ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', String(p.placementId)); } catch { /* 部分浏览器限制 */ }
      }
    },
    onDragEnd() { this.drag = null; this.dropShelf = null; this.dropCab = null; },

    // 层：精确落点
    onShelfOver(s) {
      if (!this.drag) return;
      if (this.isSameSpot(s)) { this.dropShelf = null; return; }
      this.dropShelf = s.id;
      this.dropCab = null;
    },
    onShelfLeave(s) { if (this.dropShelf === s.id) this.dropShelf = null; },
    onShelfDrop(s) {
      const d = this.drag;
      this.dropShelf = null; this.dropCab = null;
      if (!d) return;
      if (this.isSameSpot(s)) { this.$root.notify('已在当前位置'); this.drag = null; return; }
      this.doMove(s.id, null);
    },

    // 柜子：整柜投放（自动挑最空的一层）
    onCabOver(c) {
      if (!this.drag) return;
      this.dropShelf = null;
      this.dropCab = c.id;
    },
    onCabLeave(c) { if (this.dropCab === c.id) this.dropCab = null; },
    onCabDrop(c) {
      const d = this.drag;
      const target = this.cabTargetShelf(c);
      this.dropCab = null; this.dropShelf = null;
      if (!d) return;
      if (!target) { this.$root.notify('「' + c.name + '」还没有层，先去收纳空间加一层'); this.drag = null; return; }
      if (this.isSameSpot(target)) { this.$root.notify('已在当前位置'); this.drag = null; return; }
      this.doMove(target.id, null);
    },

    // 统一的移位请求 + 全站同步
    async doMove(shelfId, boxId) {
      const d = this.drag;
      if (!d) return;
      this.moving = true;
      try {
        const r = await api('POST', `/items/${d.itemId}/move`, { placementId: d.placementId, shelfId, boxId });
        this.$root.notify(`「${d.name}」已移到 ${r.location}`);
        store.dataVersion++; // 通知总览/统计/搜索等页面同步刷新
      } catch (e) {
        this.$root.notify('⚠️ ' + e.message);
      } finally { this.moving = false; this.drag = null; }
    },
  },
  template: `
  <section class="screen">
    <div class="page-title">{{ greeting }} 👋</div>
    <div class="page-sub" v-if="ov">实验室共 {{ ov.stats.itemCount }} 种物品、{{ ov.stats.inStock }} 件在库，今天入库 {{ ov.stats.todayIn }} 件</div>
    <div class="page-sub" v-else-if="!error">正在读取库存…</div>
    <div class="ai-hint" v-if="error">⚠️ {{ error }}</div>

    <!-- 数据没到之前先画出这个模块的形状：切过来立刻有反馈，不是一片空白 -->
    <page-skeleton v-if="!ov && !error" :rows="4" chart></page-skeleton>

    <div class="stats" v-if="ov">
      <div class="stat glass lift" @click="goScan()" style="cursor:pointer"><div class="ic">📦</div><div class="num">{{ ov.stats.itemCount }}</div><div class="lbl">物品种类</div></div>
      <div class="stat glass lift"><div class="ic">🗺️</div><div class="num">{{ ov.stats.zoneCount }}</div><div class="lbl">区域</div></div>
      <div class="stat glass lift"><div class="ic">🗄️</div><div class="num">{{ ov.stats.cabinetCount }}</div><div class="lbl">柜子</div></div>
      <div class="stat glass lift"><div class="ic">📥</div><div class="num">{{ ov.stats.todayIn }}</div><div class="lbl">今日入库</div></div>
    </div>

    <h3 class="sec" v-if="ov && ov.zones.length">🗺️ 空间总览
      <span style="margin-left:auto" class="muted">拖动物品到别的柜子或某一层即可移位 · 点柜子去收纳空间 · 点物品看详情</span></h3>

    <div class="zones" :class="{ 'drag-mode': dragging }" v-if="ov && ov.zones.length">
      <div class="zone glass card" v-for="z in ov.zones" :key="z.id">
        <div class="zone-head">
          <span class="zone-tag">{{ z.name }}</span>
          <span class="zone-meta">{{ z.cabinetCount }} 个柜子 · {{ z.itemQty }} 件在库 · 填充 {{ z.occupancy }}%</span>
        </div>
        <div class="occ-bar"><i :style="{width: z.occupancy + '%'}"></i></div>

        <div class="zone-cabs">
          <div class="cab-mini" v-for="c in z.cabinets" :key="c.id"
               :class="{ 'drop-hover': dropCab === c.id }"
               @click="goStudio(c.id)"
               @dragover.prevent="onCabOver(c)" @dragleave="onCabLeave(c)" @drop.prevent="onCabDrop(c)"
               :title="dragging ? ('把物品放进「' + c.name + '」') : ('前往收纳空间查看 ' + c.name)">
            <div class="cab-head">
              <b>{{ c.name }}</b>
              <span class="muted">{{ doorLabel[c.door] }}<template v-if="c.floor > 1"> · 第{{ c.floor }}层</template></span>
            </div>
            <div class="cab-doors" :class="c.door"><i></i><i v-if="c.door === 'double'"></i><i v-if="c.door === 'drawer'"></i></div>
            <div class="shelf-row" v-for="s in c.shelves" :key="s.id" :class="[s.state, { 'drop-hover': dropShelf === s.id }]"
                 @dragover.prevent.stop="onShelfOver(s)" @dragleave.stop="onShelfLeave(s)" @drop.prevent.stop="onShelfDrop(s)">
              <span class="shelf-name">{{ s.name }}</span>
              <div class="chips" v-if="s.items.length">
                <span class="item-chip" v-for="(p, pi) in shownItems(s)" :key="s.id + '-' + pi"
                      draggable="true" :class="{ dragging: drag && drag.placementId === p.placementId }"
                      @dragstart="onDragStart(p, s, $event)" @dragend="onDragEnd"
                      @click.stop="openItem(p.id)" :title="'拖到其它柜子 / 层即可移位 · 点图片放大 · ' + (p.box ? p.box + ' · ' : '') + p.name + ' ×' + p.qty">
                  <img v-if="p.img" :src="imgSrc(p.img, 96)" loading="lazy" decoding="async" fetchpriority="low"
                       class="chip-img" @click.stop="openZoom(p, c.name + ' › ' + s.name)" title="点击放大实物照片"><span v-else class="dot"></span>
                  <span class="chip-name">{{ p.name }}</span><b v-if="p.qty > 1">×{{ p.qty }}</b>
                </span>
                <span class="item-chip more" v-if="s.items.length > 4" @click.stop="toggleCollapse(s.id)"
                      :title="isCollapsed(s.id) ? '展开全部 ' + s.items.length + ' 项' : '收起'">
                  {{ isCollapsed(s.id) ? '展开全部 ' + s.items.length : '收起' }}
                </span>
              </div>
              <span class="muted" v-else style="font-size:11.5px">空</span>
            </div>
            <div class="empty" v-if="!c.shelves.length" style="padding:8px">还没建层，去收纳空间补一层</div>
          </div>
        </div>
      </div>
    </div>

    <div class="drag-hint glass" v-if="dragging">
      <span class="dh-ic">🖐️</span>
      <span class="dh-name">正在移动「{{ drag.name }}」</span>
      <span class="dh-sep">→</span>
      <span class="dh-tip">{{ dragHint }}</span>
    </div>
    <div class="glass card" v-if="ov && !ov.zones.length">
      <div class="empty">还没有收纳空间，去 <a href="#/studio" style="color:var(--a1)">收纳空间</a> 用 AI 一句话生成柜体吧</div>
    </div>

    <div class="dash-2col" v-if="ov && ov.categoryDist.length">
      <div class="glass card">
        <h3 class="sec" style="margin-top:0">🏷️ 分类分布</h3>
        <div class="bars">
          <div class="bar-row" v-for="c in ov.categoryDist.slice(0, 8)" :key="c.name">
            <span class="bar-lbl">{{ c.name }}</span>
            <span class="bar-track"><i class="bar-fill" :style="{width: percent(c.qty || c.kinds, catMax)}"></i></span>
            <span class="bar-val">{{ c.qty }} 件</span>
          </div>
        </div>
        <div class="hint-mini">完整看板见左侧「📊 统计看板」</div>
      </div>
      <div class="glass card">
        <h3 class="sec" style="margin-top:0">📅 今日计划</h3>
        <div class="today-list">
          <div class="today-row" v-for="p in ov.todayPlan.pendingQueue" :key="'q'+p.id">
            <span class="chip on">待确认</span>
            <div class="grow">{{ p.names || '识别结果' }} <span class="muted">（{{ p.mode==='batch' ? '批量识别' : '单物识别' }}）</span></div>
            <a class="btn-ghost" href="#/scan" style="text-decoration:none">去处理</a>
          </div>
          <div class="today-row" v-for="l in ov.todayPlan.todayLogs" :key="'l'+l.id">
            <span class="chip" :class="{on: l.action==='in'}">{{ {in:'入库',out:'出库',move:'移位',edit:'改名'}[l.action] || '记录' }}</span>
            <div class="grow">{{ l.item_name || '物品' }} · {{ l.location || '—' }} <span class="muted">{{ l.detail }}</span></div>
            <span class="muted">{{ (l.created_at || '').slice(11, 16) }}</span>
          </div>
          <div v-if="!ov.todayPlan.pendingQueue.length && !ov.todayPlan.todayLogs.length" class="empty">今天暂无待办与出入库记录</div>
        </div>
      </div>
    </div>

    <h3 class="sec" v-if="ov">最近入库 <span class="muted" style="margin-left:6px">点实物图片可放大看细节</span></h3>
    <div class="recent-grid" v-if="ov && ov.recent.length">
      <div class="item-card glass lift" v-for="it in ov.recent" :key="it.id" @click="openItem(it.id)">
        <div class="item-thumb zoomable" :class="{ 'no-photo': !it.img }" @click.stop="openZoom(it)"
             :title="it.img ? '点击放大实物照片' : '还没有实物照片'">
          <img v-if="it.img" :src="imgSrc(it.img, 320)" loading="lazy" decoding="async">
          <span v-else>📦</span>
          <span class="thumb-zoom" v-if="it.img">🔍</span>
        </div>
        <div class="item-name">{{ it.name }}</div>
        <div class="item-loc">{{ it.category || '未分类' }} · 共 {{ it.totalQty }} 件</div>
      </div>
    </div>
    <div class="glass card" v-if="ov && !ov.recent.length"><div class="empty">还没有物品，去 <a href="#/scan" style="color:var(--a1)">识别入库</a> 拍第一件物品吧</div></div>

    <!-- 实物照片放大：点背景 / 再点图片还原 / Esc 关闭
         Teleport 到 body：.main 是 z-index:10 的层叠上下文，不传送的话灯箱会被
         侧边栏 / 顶栏 / 电子宠物（z-index 40~55）压在下面 -->
    <teleport to="body">
      <div class="photo-viewer" v-if="zoom" @click.self="closeZoom">
      <div class="pv-bar">
        <div class="pv-title">
          <b>{{ zoom.name }}</b>
          <span class="pv-sub" v-if="zoom.sub">{{ zoom.sub }}</span>
        </div>
        <div class="pv-acts">
          <button class="pv-btn" @click.stop="toggleZoom">{{ zoomed ? '⤢ 还原' : '🔍 放大' }}</button>
          <a class="pv-btn" :href="imgSrc(zoom.img)" target="_blank" rel="noopener" @click.stop>↗ 原图</a>
          <button class="pv-btn pv-x" @click.stop="closeZoom" title="关闭（Esc）">✕</button>
        </div>
      </div>
      <div class="pv-stage" @click="toggleZoom" :title="zoomed ? '点一下还原' : '点一下放大'">
        <img :src="imgSrc(zoom.img, 1280)" :alt="zoom.name" :class="{ zoomed }"
             :style="{ transformOrigin: zoomOx + '% ' + zoomOy + '%' }">
      </div>
      <div class="pv-tip" v-if="!zoomed">点图片放大 · 点空白处或 ✕ 关闭</div>
      </div>
    </teleport>
  </section>`,
};
