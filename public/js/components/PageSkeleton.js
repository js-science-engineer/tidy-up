// 页面骨架屏（PageSkeleton）
// 用途：切模块时数据还在路上，先把这个模块"长什么样"画出来，用户就知道点击生效了。
// 各页原来在数据到齐前只有一行标题、正文全空，慢网络下看着像"点了没反应 / 刷新不出来"。
window.Components = window.Components || {};
window.Components.PageSkeleton = {
  props: {
    // 骨架块数（大致对应内容块数量）
    rows: { type: Number, default: 3 },
    // 是否画一个大图区（相册 / 图表类页面）
    chart: { type: Boolean, default: false },
  },
  data: () => ({ slow: false }),
  computed: {
    list() { return Array.from({ length: Math.max(1, this.rows) }, (_, i) => i); },
  },
  mounted() {
    // 兜底：正常情况下骨架只闪一下。超过 8 秒还在转，说明网络卡住了或请求挂了，
    // 给一个明确的出口，别让用户对着骨架干等（"点了一直刷不出来"最气人的就是这种）。
    this._t = setTimeout(() => { this.slow = true; }, 8000);
  },
  beforeUnmount() { clearTimeout(this._t); },
  methods: {
    retry() { location.reload(); },
  },
  template: `
  <div class="page-skeleton" aria-busy="true" aria-live="polite">
    <div class="sk-chart" v-if="chart"><div class="sk-bars"><i v-for="i in 7" :key="i" :style="{height: (26 + (i * 37) % 62) + '%'}"></i></div></div>
    <div class="sk-grid">
      <div class="sk-card" v-for="i in list" :key="i">
        <div class="sk-line w40"></div>
        <div class="sk-line"></div>
        <div class="sk-line w60"></div>
      </div>
    </div>
    <div class="sk-hint" v-if="!slow">正在加载…</div>
    <div class="sk-hint sk-slow" v-else>
      网络有点慢，还在等数据…
      <button class="btn-ghost" style="margin-left:8px;padding:5px 12px;font-size:12px" @click="retry">重新加载</button>
    </div>
  </div>`,
};
