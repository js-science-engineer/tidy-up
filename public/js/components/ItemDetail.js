window.Components = window.Components || {};
window.Components.ItemDetail = {
  data: () => ({
    item: null, outQty: {}, moveTarget: {}, busy: false,
    editing: false, saving: false,
    form: { name: '', category: '', size: 'S', aliases: '', note: '' },
    categories: [],
  }),
  computed: {
    totalQty() { return this.item ? this.item.placements.reduce((n, p) => n + p.qty, 0) : 0; },
    mainImg() {
      if (!this.item || !this.item.images.length) return '';
      return imgSrc(this.item.images[0].file);
    },
  },
  watch: {
    'store.detailItemId': {
      immediate: true,
      async handler(id) {
        this.item = null; this.editing = false;
        if (!id) return;
        try {
          this.item = await api('GET', '/items/' + id);
          this.fillForm();
          if (!this.categories.length) {
            const m = await api('GET', '/stats/meta');
            this.categories = m.categories || [];
          }
        } catch (e) { alert(e.message); store.detailItemId = null; }
      },
    },
  },
  methods: {
    close() { store.detailItemId = null; },
    fillForm() {
      this.form = {
        name: this.item.name,
        category: this.item.category || '其他',
        size: this.item.size_class || 'S',
        aliases: (this.item.aliases || []).join(' / '),
        note: this.item.note || '',
      };
    },
    cancelEdit() { this.fillForm(); this.editing = false; },
    async saveEdit() {
      const name = String(this.form.name || '').trim();
      if (!name) { alert('物品名称不能为空'); return; }
      this.saving = true;
      try {
        await api('PATCH', '/items/' + this.item.id, {
          name,
          category: this.form.category,
          size: this.form.size,
          aliases: this.form.aliases ? this.form.aliases.split('/').map((s) => s.trim()).filter(Boolean) : [],
          note: this.form.note,
        });
        this.item = await api('GET', '/items/' + this.item.id);
        this.fillForm();
        this.editing = false;
        this.$root.notify('已保存修改');
        store.dataVersion++; // 通知其他页面刷新名称
      } catch (e) { alert(e.message); } finally { this.saving = false; }
    },
    async doOut(p, all) {
      const qty = all ? null : Number(this.outQty[p.id]);
      if (!all && (!qty || qty <= 0)) { alert('请输入取出数量'); return; }
      if (!confirm(all ? '取出该位置全部物品？' : `取出 ${qty} 件？`)) return;
      this.busy = true;
      try {
        const r = await api('POST', `/items/${this.item.id}/out`, { placementId: p.id, qty: all ? undefined : qty, all: !!all });
        alert(r.emptied ? '已取空该位置' : `取出成功，剩余 ${r.remain}`);
        this.item = await api('GET', '/items/' + this.item.id);
        store.dataVersion++;
      } catch (e) { alert(e.message); } finally { this.busy = false; }
    },
    async doMove(p) {
      const t = this.moveTarget[p.id] || {};
      if (!t.shelfId && !t.boxId) { alert('请选择目标位置'); return; }
      this.busy = true;
      try {
        const r = await api('POST', `/items/${this.item.id}/move`, { placementId: p.id, shelfId: t.shelfId, boxId: t.boxId });
        alert('已移动到：' + r.location);
        this.item = await api('GET', '/items/' + this.item.id);
        store.dataVersion++;
      } catch (e) { alert(e.message); } finally { this.busy = false; }
    },
  },
  template: `
  <div v-if="store.detailItemId && item" class="modal-mask" @click.self="close">
    <div class="modal glass">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
        <div class="recog-img" style="width:84px;height:84px;font-size:32px">
          <img v-if="mainImg" :src="mainImg">
          <span v-else>📦</span>
        </div>
        <div style="flex:1">
          <div class="row" style="align-items:center">
            <div class="recog-name" style="flex:1">{{ item.name }}</div>
            <button class="btn-ghost" @click="editing ? cancelEdit() : (editing = true)">{{ editing ? '取消' : '✏️ 修改名称/信息' }}</button>
          </div>
          <div class="row" v-if="!editing"><span class="chip">{{ item.category || '未分类' }}</span>
            <span class="chip">共 {{ totalQty }} 件</span>
            <span class="chip">尺寸 {{ item.size_class || 'S' }}</span></div>
          <div class="muted" v-if="!editing && item.aliases.length">别名：{{ item.aliases.join(' / ') }}</div>
          <div class="muted" v-if="!editing && item.note">备注：{{ item.note }}</div>

          <div v-if="editing" class="edit-panel">
            <div class="form-row"><label class="muted">名称</label>
              <input v-model="form.name" style="flex:1" placeholder="物品名称"></div>
            <div class="form-row"><label class="muted">类别</label>
              <select v-model="form.category" style="flex:1">
                <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
              </select>
              <label class="muted">尺寸</label>
              <select v-model="form.size" style="width:80px"><option>S</option><option>M</option><option>L</option></select></div>
            <div class="form-row"><label class="muted">别名</label>
              <input v-model="form.aliases" style="flex:1" placeholder="多个别名用 / 分隔，便于搜索"></div>
            <div class="form-row"><label class="muted">备注</label>
              <input v-model="form.note" style="flex:1" placeholder="（可选）"></div>
            <div class="form-row">
              <button class="btn-main" :disabled="saving" @click="saveEdit">{{ saving ? '保存中…' : '保存修改' }}</button>
              <span class="hint-mini">改名不影响存放位置和数量，历史记录会留下修正痕迹</span>
            </div>
          </div>
        </div>
        <button class="btn-ghost" @click="close">关闭</button>
      </div>
      <h3 class="sec">📍 存放位置</h3>
      <div v-if="!item.placements.length" class="empty">尚未入库</div>
      <div v-for="p in item.placements" :key="p.id" class="today-row" style="margin-bottom:9px">
        <div class="grow"><b>{{ p.path }}</b><div class="muted">数量 {{ p.qty }}{{ p.qty===0 ? '（已取空）' : '' }}</div></div>
        <input v-if="p.qty>0" v-model.number="outQty[p.id]" type="number" min="1" :max="p.qty" placeholder="数量" style="width:76px">
        <button v-if="p.qty>0" class="btn-ghost" :disabled="busy" @click="doOut(p,false)">取出</button>
        <button v-if="p.qty>0" class="btn-ghost" :disabled="busy" @click="doOut(p,true)">全部取出</button>
      </div>
      <h3 class="sec" style="margin-top:16px">🕘 出入库记录</h3>
      <div class="today-list">
        <div v-if="!item.logs.length" class="empty">暂无记录</div>
        <div v-for="l in item.logs" :key="l.id" class="today-row">
          <span class="chip" :class="{on: l.action==='in'}">{{ l.action==='in' ? '入库' : l.action==='out' ? '出库' : l.action==='move' ? '移位' : '编辑' }}</span>
          <div class="grow">{{ l.location || '—' }} <span class="muted">{{ l.detail }}</span></div>
          <span class="muted">{{ l.created_at }}</span>
        </div>
      </div>
    </div>
  </div>`,
};
