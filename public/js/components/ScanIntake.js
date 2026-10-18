window.Components = window.Components || {};
window.Components.ScanIntake = {
  data: () => ({
    mode: 'single',            // single | batch | manual（manual = 不上 AI，自己填名字）
    file: null, fileUrl: '', analyzing: false, aiMsg: '', dragOver: false,
    elapsed: 0, elapsedTimer: null,   // 识别计时反馈
    result: null,          // { id, rec:{items:[...]}, file, manual? }
    edits: [],             // 每件物品的编辑态
    editingQty: null,      // 正在双击输入数量的行号
    queue: [],
    meta: { categories: [], zones: [] },
    picks: [],             // 每件物品的目标位置选择
    mainPick: [],          // 每件物品选择的主图 ('user' 或 URL)
    busy: false,
    doneMsg: '',
    // ---- 名称查重（v2.4）----
    dupChecks: {},         // 每行的「库里已有相近物品」提示：{ [i]: { name, matches } }
    dup: null,             // 查重弹窗：{ index, name, matches, itemId, placementId }
    dupTimer: null,        // 输入防抖
  }),
  computed: {
    // 实物照片地址：优先本次上传的本地预览，其次队列项回显的服务器副本
    photoUrl() {
      if (this.fileUrl) return this.fileUrl;
      if (this.result && this.result.previewUrl) return this.result.previewUrl;
      return '';
    },
    doorLabel() { return { double: '双开门', single: '单开门', drawer: '抽屉' }; },
    items() { return (this.result && this.result.rec && this.result.rec.items) || []; },
    isManual() { return !!(this.result && this.result.manual); },
    hasStructure() { return (this.meta.zones || []).some((z) => this.cabinetsOf(z).some((c) => c.shelves.length)); },
    emptyCats() { return this.meta.categories || []; },
  },
  async mounted() {
    await this.refreshQueue();
    this.meta = await api('GET', '/stats/meta');
  },
  beforeUnmount() { this.stopTimer(); if (this.dupTimer) clearTimeout(this.dupTimer); },
  methods: {
    async refreshQueue() { this.queue = await api('GET', '/intake/queue'); },
    pickFile() { this.$refs.fileInput.click(); },
    onDragOver(e) { this.dragOver = true; },
    onDragLeave() { this.dragOver = false; },
    onDrop(e) {
      this.dragOver = false;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && this.isLikelyImage(f)) this.setFile(f);
    },
    isLikelyImage(f) {
      return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i.test(f.name || '');
    },
    onFile(e) {
      const f = e.target.files[0];
      if (f) this.setFile(f);
      e.target.value = '';
    },
    // AI 视觉模型只稳定支持 jpg/png/webp：其余可解码格式（gif/bmp/avif 等）统一转成 JPEG；
    // 浏览器解不动的格式（iPhone 的 HEIC 等）直接给出可操作的提示。
    // 另外所有图片都会先等比压到长边 1600（见 api.js 的 shrinkImage）：手机上原图 4~5MB，
    // 直接上传/列表加载会非常卡，压缩后体积通常只剩 1/5。
    normalizeImage(f) {
      const OK = ['image/jpeg', 'image/png', 'image/webp'];
      const shrink = (x) => (window.shrinkImage ? window.shrinkImage(x) : Promise.resolve(x));
      if (OK.includes(f.type)) return shrink(f);
      if (/heic|heif|tiff?/i.test(f.type + ' ' + (f.name || ''))) {
        return Promise.reject(new Error('该格式（HEIC/HEIF/TIFF）浏览器无法解码，请先用系统「照片」应用把它另存为 JPG 再上传'));
      }
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)); // 长边限 1600，控制流量
            c.width = Math.max(1, Math.round(img.naturalWidth * scale));
            c.height = Math.max(1, Math.round(img.naturalHeight * scale));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            c.toBlob((b) => {
              URL.revokeObjectURL(url);
              if (!b) return reject(new Error('图片转换失败，请换一张照片试试'));
              const name = (f.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
              resolve(new File([b], name, { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.85);
          } catch (err) { URL.revokeObjectURL(url); reject(new Error('图片转换失败，请换一张照片试试')); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('浏览器无法解码该图片格式，请先把它另存为 JPG/PNG 再上传')); };
        img.src = url;
      });
    },
    async setFile(f) {
      try {
        this.file = await this.normalizeImage(f);
        this.fileUrl = URL.createObjectURL(this.file);
        this.result = null; this.aiMsg = ''; this.doneMsg = '';
      } catch (e) { this.$root.notify('⚠️ ' + e.message); }
    },
    setMode(m) { this.mode = m; },
    startTimer() {
      this.elapsed = 0;
      this.elapsedTimer = setInterval(() => { this.elapsed++; }, 1000);
      document.body.classList.add('busy'); // 暂停背景动画，防闪屏
    },
    stopTimer() {
      if (this.elapsedTimer) clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
      document.body.classList.remove('busy');
    },
    async analyze() {
      if (!this.file) { this.$root.notify('请先选择图片'); return; }
      if (this.mode === 'manual') { this.startManual(); return; }
      this.analyzing = true; this.aiMsg = ''; this.doneMsg = ''; this.result = null;
      this.startTimer();
      try {
        const fd = new FormData();
        fd.append('image', this.file);
        fd.append('mode', this.mode);
        const r = await api('POST', '/intake/analyze', fd);
        this.loadResult(r);
        this.$root.notify(`识别完成（用时 ${this.elapsed} 秒），请核对后入库`);
      } catch (e) { this.aiMsg = '⚠️ ' + e.message; }
      finally { this.analyzing = false; this.stopTimer(); }
    },

    // ---- 手动录入（不上 AI）：照片自己拍，名称/类别/数量自己填 ----
    blankRow() {
      return {
        edit: { name: '', category: (this.meta.categories && this.meta.categories[0]) || '其他', size: 'S', qty: 1, aliases: '' },
        item: { name: '', category: '', size: 'S', confidence: 1, suggestion: null, manual: true },
        pick: { zoneId: null, cabinetId: null, shelfId: null, boxId: null },
      };
    },
    startManual() {
      const r = this.blankRow();
      this.result = { id: null, manual: true, rec: { items: [r.item] } };
      this.edits = [r.edit];
      this.picks = [r.pick];
      this.mainPick = ['user'];
      this.aiMsg = ''; this.doneMsg = '';
      this.$nextTick(() => {
        const el = this.$el.querySelector('.recog input');
        if (el) el.focus();
      });
    },
    addManualRow() {
      if (!this.result || !this.result.manual) return;
      const r = this.blankRow();
      this.result.rec.items.push(r.item);
      this.edits.push(r.edit);
      this.picks.push(r.pick);
      this.mainPick.push('user');
      this.$nextTick(() => {
        const inputs = this.$el.querySelectorAll('.recog input');
        const last = inputs[inputs.length - 1];
        if (last) last.focus();
      });
    },
    // 由 analyze 结果或队列项装载编辑面板
    loadResult(r) {
      if (!r || !r.rec || !Array.isArray(r.rec.items) || !r.rec.items.length) { this.aiMsg = '⚠️ 未识别出物品'; return; }
      this.result = r;
      this.edits = r.rec.items.map((it) => ({
        name: it.name, category: it.category, size: it.size || 'S', qty: 1, aliases: (it.aliases || []).join(' / '),
      }));
      this.picks = r.rec.items.map((it) => ({
        zoneId: this.zoneIdOfShelf(it.suggestion && it.suggestion.shelfId),
        cabinetId: this.cabinetIdOfShelf(it.suggestion && it.suggestion.shelfId),
        shelfId: (it.suggestion && it.suggestion.shelfId) || null,
        boxId: (it.suggestion && it.suggestion.boxId) || null,
      }));
      this.mainPick = r.rec.items.map(() => 'user');
    },
    // 点击待确认队列项 → 重新载入到右侧编辑面板
    loadFromQueue(q) {
      this.loadResult(JSON.parse(JSON.stringify(q)));
      this.$root.notify('已载入该识别结果');
    },
    // 一键回到建议位置
    useSuggestion(i) {
      const sg = this.items[i] && this.items[i].suggestion;
      if (!sg || !sg.shelfId) return;
      this.picks[i].zoneId = this.zoneIdOfShelf(sg.shelfId);
      this.picks[i].cabinetId = this.cabinetIdOfShelf(sg.shelfId);
      this.picks[i].shelfId = sg.shelfId;
      this.picks[i].boxId = sg.boxId || null;
    },
    // 位置选择联动
    zoneIdOfShelf(shelfId) {
      if (!shelfId) return null;
      for (const z of this.meta.zones) for (const c of this.cabinetsOf(z)) for (const s of c.shelves) if (s.id === shelfId) return z.id;
      return null;
    },
    cabinetIdOfShelf(shelfId) {
      if (!shelfId) return null;
      for (const z of this.meta.zones) for (const c of this.cabinetsOf(z)) for (const s of c.shelves) if (s.id === shelfId) return c.id;
      return null;
    },
    cabinetsOf(z) { return (z && z.floors) ? z.floors.flatMap((f) => f.cabinets) : []; },
    shelvesOf(cabinetId) {
      if (!cabinetId) return [];
      for (const z of this.meta.zones) for (const c of this.cabinetsOf(z)) if (c.id === cabinetId) return c.shelves;
      return [];
    },
    boxesOf(shelfId) {
      if (!shelfId) return [];
      for (const z of this.meta.zones) for (const c of this.cabinetsOf(z)) for (const sh of c.shelves) if (sh.id === shelfId) return sh.boxes;
      return [];
    },
    // 所选柜子的实拍照片：对着实物确认位置，避免放错柜子（收纳空间里给柜子上传过才有）
    cabPhotoOf(cabinetId) {
      if (!cabinetId) return '';
      for (const z of this.meta.zones) for (const c of this.cabinetsOf(z)) if (c.id === cabinetId) return c.photo || '';
      return '';
    },
    onPickZone(i) { this.picks[i].cabinetId = null; this.picks[i].shelfId = null; this.picks[i].boxId = null; },
    onPickCabinet(i) {
      const sh = this.shelvesOf(this.picks[i].cabinetId);
      this.picks[i].shelfId = sh.length ? sh[0].id : null;
      this.picks[i].boxId = null;
    },
    onPickShelf(i) { this.picks[i].boxId = null; },
    // 数量：双击数字直接键入（一直点 ＋ 太慢）
    startEditQty(i) {
      this.editingQty = i;
      this.$nextTick(() => {
        const el = this.$el.querySelector('.qty-input');
        if (el) { el.focus(); el.select(); }
      });
    },
    commitQty(i) {
      const v = Math.max(1, Math.round(Number(this.edits[i].qty) || 1));
      this.edits[i].qty = v;
      this.editingQty = null;
    },

    // 手动录入第一次入库时才把照片传上去（避免用户最后没用也占一份存储）
    async ensureManualQueue() {
      if (this.result.id) return this.result.id;
      if (!this.file) throw new Error('请先选择照片');
      const fd = new FormData();
      fd.append('image', this.file);
      const r = await api('POST', '/intake/manual', fd);
      this.result.id = r.id;
      if (r.previewUrl) this.result.previewUrl = r.previewUrl;
      return r.id;
    },
    async confirm(index) {
      const ed = this.edits[index];
      const pk = this.picks[index];
      const manual = this.isManual;
      if (manual && !String(ed.name || '').trim()) { this.$root.notify('请填写物品名称'); return; }
      if (!pk.shelfId && !pk.boxId) { this.$root.notify('请选择存放位置'); return; }
      // 入库前先查重：库里已有同名 / 写法相近的物品 → 先问用户「合并还是新建」
      if (!this.busy) {
        this.busy = true;
        try {
          const hits = await this.lookupName(ed.name);
          if (hits.length) { this.openDup(index, hits); return; }
        } catch { /* 查重失败不拦入库，按原流程继续 */ }
        finally { this.busy = false; }
      }
      await this.doConfirm(index, {});
    },

    // ---- 名称查重：与库里已有物品比对（本地 / 云端同一套打分）----
    async lookupName(name) {
      const n = String(name || '').trim();
      if (!n) return [];
      const r = await api('GET', '/items/name-check?name=' + encodeURIComponent(n));
      return (r && r.matches) || [];
    },
    // 输入名称时防抖查重 → 行内即时提示（不打断输入，只提示）
    onNameInput(i) {
      if (this.dupTimer) clearTimeout(this.dupTimer);
      this.dupTimer = setTimeout(() => this.silentCheck(i), 480);
    },
    async silentCheck(i) {
      const ed = this.edits[i];
      if (!ed) return;
      const name = String(ed.name || '').trim();
      if (name.length < 2) { this.dupChecks[i] = null; return; }
      try {
        const matches = await this.lookupName(name);
        // 名称在等待期间又变了 → 丢弃这次结果，避免提示错位
        if (!this.edits[i] || String(this.edits[i].name || '').trim() !== name) return;
        this.dupChecks[i] = matches.length ? { name, matches } : null;
      } catch { /* 提示失败保持安静 */ }
    },
    dupOf(i) {
      const d = this.dupChecks[i];
      if (!d || !d.matches || !d.matches.length) return null;
      if (!this.edits[i] || String(this.edits[i].name || '').trim() !== d.name) return null;
      return d;
    },
    openDup(index, matches) {
      this.dup = {
        index, name: String(this.edits[index].name || '').trim(),
        matches, itemId: matches[0].id, placementId: null,
      };
    },
    openDupInline(i) { const d = this.dupOf(i); if (d) this.openDup(i, d.matches); },
    dupMatch() {
      const d = this.dup;
      if (!d) return null;
      return d.matches.find((m) => m.id === d.itemId) || d.matches[0];
    },
    // 合并：数量并到已有物品（可指定并到某个已入库位置，或放到这次选的位置）
    async dupMerge() {
      const d = this.dup;
      if (!d) return;
      const m = this.dupMatch();
      this.dup = null;
      await this.doConfirm(d.index, { mergeItemId: m.id, mergePlacementId: d.placementId || undefined });
    },
    // 不是同一件东西 → 回去改个名字（避免库里再多个近似名）
    dupRename() {
      const d = this.dup;
      this.dup = null;
      this.$nextTick(() => {
        const inputs = this.$el.querySelectorAll('.recog input');
        if (inputs[d.index]) { inputs[d.index].focus(); inputs[d.index].select(); }
      });
      this.$root.notify('改个更好区分的名字，或点「仍作为新物品」');
    },
    // 确认名称确实不同 → 照常新建
    async dupCreateNew() {
      const d = this.dup;
      if (!d) return;
      this.dup = null;
      await this.doConfirm(d.index, {});
    },

    async doConfirm(index, extra) {
      const ed = this.edits[index];
      const pk = this.picks[index];
      const manual = this.isManual;
      this.busy = true;
      try {
        if (manual && !this.result.id) await this.ensureManualQueue();
        const body = {
          queueId: this.result.id, index,
          name: ed.name, category: ed.category, aliases: ed.aliases ? ed.aliases.split('/').map((s) => s.trim()).filter(Boolean) : [],
          size: ed.size, qty: Math.max(1, Math.round(Number(ed.qty) || 1)),
          shelfId: pk.shelfId, boxId: pk.boxId, mainImage: this.mainPick[index],
        };
        Object.assign(body, extra || {});
        const r = await api('POST', '/intake/confirm', body);
        this.doneMsg = `✔ ${r.location} × ${r.qty}`;
        if (r.merged && r.aliasAdded) {
          this.$root.notify(`已合并到「${r.mergedName}」：${r.location} × ${r.qty}（「${r.aliasAdded}」已记为别名）`);
        } else if (r.merged) {
          this.$root.notify(`已合并到「${r.mergedName}」：${r.location} × ${r.qty}`);
        } else {
          this.$root.notify(`已入库：${r.location} × ${r.qty}`);
        }
        this.result.rec.items.splice(index, 1);
        this.edits.splice(index, 1); this.picks.splice(index, 1); this.mainPick.splice(index, 1);
        this.dupChecks = {}; // 行号整体前移，旧的提示作废
        if (!this.result.rec.items.length) { this.result = null; this.file = null; this.fileUrl = ''; }
        await this.refreshQueue();
      } catch (e) { this.$root.notify(e.message); }
      finally { this.busy = false; }
    },
    removeItem(index) {
      this.result.rec.items.splice(index, 1);
      this.edits.splice(index, 1); this.picks.splice(index, 1); this.mainPick.splice(index, 1);
      this.dupChecks = {};
    },
    async dismiss(q) {
      if (!confirm('忽略这条识别结果？')) return;
      await api('POST', '/intake/dismiss', { id: q.id });
      await this.refreshQueue();
    },
  },
  template: `
  <section class="screen">
    <div class="page-title">识别入库</div>
    <div class="page-sub">拍照 → 云端 AI 识别 → 你的照片即实物图 → 智能分区建议 → 确认入库（名称随时可改）</div>

    <div class="scan">
      <div>
        <div class="drop liquid glass" :class="{over: dragOver}" @click="pickFile"
             @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
          <div class="cam">📷</div>
          <span v-if="fileUrl"><img :src="fileUrl" style="max-width:100%;max-height:80px;border-radius:8px"></span>
          <span v-else>点击拍照 / 选择图片 / 拖拽图片到此处</span>
          <span class="muted">手机与电脑连同一 WiFi，浏览器打开设置页显示的地址即可上传</span>
        </div>
        <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="onFile">
        <div class="seg">
          <button :class="{on: mode==='single'}" @click="setMode('single')">一图一物</button>
          <button :class="{on: mode==='batch'}" @click="setMode('batch')">整层批量识别</button>
          <button :class="{on: mode==='manual'}" @click="setMode('manual')">✍️ 手动录入</button>
        </div>
        <div class="hint-mini" v-if="mode==='manual'" style="margin-top:8px">
          不调用 AI：照片还是你拍的这张，物品名称 / 类别 / 数量 / 位置全部由你自己填，适合 AI 认不准或不想等的时候。
        </div>
        <div class="form-row" style="margin-top:14px">
          <button class="btn-main" :disabled="analyzing || !file" @click="analyze">{{ analyzing ? '识别中…' : (mode==='manual' ? '开始手动录入' : '开始识别') }}</button>
        </div>
        <div class="ai-hint" v-if="analyzing" style="display:flex;align-items:center;gap:10px">
          <span class="spinner"></span>
          <span>AI 正在识别<span v-if="elapsed"> · 已等待 {{ elapsed }} 秒</span>，通常 5~20 秒，请稍候…</span>
        </div>
        <div class="ai-hint" v-else-if="aiMsg">{{ aiMsg }}</div>
        <div class="ai-hint" v-else-if="doneMsg" style="color:#7ee2a8">{{ doneMsg }}</div>

        <div class="glass card" style="margin-top:16px">
          <h3 class="sec">🕘 待确认队列（{{ queue.length }}）</h3>
          <div class="today-list">
            <div class="today-row" v-for="q in queue" :key="q.id">
              <span class="chip on">待确认</span>
              <div class="grow">{{ (q.rec.items || []).map(i => i.name).join('、') }}</div>
              <button class="btn-ghost" @click="loadFromQueue(q)">载入</button>
              <button class="btn-ghost btn-danger" @click="dismiss(q)">忽略</button>
            </div>
            <div v-if="!queue.length" class="empty">暂无待确认的识别结果</div>
          </div>
        </div>
      </div>

      <div v-show="items.length" style="display:flex;flex-direction:column;gap:16px">
        <div class="recog glass" v-for="(it, i) in items" :key="result.id + '-' + i">
          <div class="recog-top">
            <div class="recog-img">
              <img v-if="photoUrl" :src="photoUrl" :key="photoUrl">
              <span v-else>📦</span>
            </div>
            <div class="recog-info" style="flex:1">
              <div class="row">
                <span class="conf" v-if="!isManual">置信度 {{ Math.round((it.confidence || 0) * 100) }}%</span>
                <span class="conf" v-else>✍️ 手动录入 · 不用 AI</span>
                <span class="chip" v-if="it.bbox">批量 · 框选识别</span>
                <span class="chip">📷 实物照片：你拍的这张</span></div>
              <div class="form-row"><input v-model="edits[i].name" style="flex:1" placeholder="物品名称（手动录入时必填）"
                     @input="onNameInput(i)" @blur="silentCheck(i)"></div>
              <div class="hint-mini">✏️ 名称可直接改（识别不准就改这里）；入库后在物品详情里也能随时再改</div>
              <!-- 名称查重：输入时就提示库里已有的同名/近名物品，避免同一件实物被写成好几个名字 -->
              <div class="dup-hint" v-if="dupOf(i)">
                <span class="dup-ic">🔎</span>
                <span class="dup-txt">库里已有 <b>{{ dupOf(i).matches[0].name }}</b>
                  <span class="muted" v-if="dupOf(i).matches[0].category">· {{ dupOf(i).matches[0].category }}</span>
                  · {{ dupOf(i).matches[0].placements.length }} 个位置 · 共 {{ dupOf(i).matches[0].totalQty }} 件
                  <template v-if="dupOf(i).matches[0].reason==='similar' || dupOf(i).matches[0].reason==='contain'">
                    （名字相似 {{ Math.round(dupOf(i).matches[0].score * 100) }}%）
                  </template>
                </span>
                <button class="btn-ghost dup-btn" @click="openDupInline(i)">合并 / 改名</button>
              </div>
              <div class="row" v-if="it.aliases && it.aliases.length">候选/别名：<span class="chip" v-for="a in it.aliases" :key="a" @click="edits[i].name=a" style="cursor:pointer">{{ a }}</span></div>
              <div class="form-row">
                <label class="muted">类别</label>
                <select v-model="edits[i].category" style="flex:1">
                  <option v-for="c in meta.categories" :key="c" :value="c">{{ c }}</option>
                </select>
                <label class="muted">数量</label>
                <span class="qty">
                  <button @click="edits[i].qty=Math.max(1,edits[i].qty-1)">−</button>
                  <input v-if="editingQty===i" class="qty-input" v-model.number="edits[i].qty" type="number" min="1" step="1"
                         @blur="commitQty(i)" @keyup.enter="commitQty(i)" @keyup.esc="commitQty(i)">
                  <span v-else class="qty-num" title="双击直接输入数量" @dblclick="startEditQty(i)">{{ edits[i].qty }}</span>
                  <button @click="edits[i].qty++">＋</button>
                </span>
              </div>
              <div class="hint-mini">💡 数量可以双击数字直接键入，不用一直点 ＋</div>
            </div>
          </div>

          <div class="suggest">
            <template v-if="!isManual">
              <div class="crumb" v-if="it.suggestion && it.suggestion.path && it.suggestion.path.length">💡 建议放入
                <template v-for="(seg, si) in it.suggestion.path" :key="si"><i v-if="si">›</i><span class="seg2">{{ seg }}</span></template>
              </div>
              <div class="crumb" v-else>💡 {{ (it.suggestion && it.suggestion.reason) || '暂无建议' }}</div>
              <div class="why" v-if="it.suggestion && it.suggestion.path && it.suggestion.path.length">{{ it.suggestion.reason }}</div>
            </template>
            <div class="form-row" style="margin-top:10px">
              <label class="muted">实际放入</label>
              <select v-model="picks[i].zoneId" @change="onPickZone(i)">
                <option :value="null">选择区域</option>
                <option v-for="z in meta.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
              <select v-model="picks[i].cabinetId" @change="onPickCabinet(i)" :disabled="!picks[i].zoneId">
                <option :value="null">选择柜子</option>
                <option v-for="c in cabinetsOf((meta.zones.find(z=>z.id===picks[i].zoneId)) || {})" :key="c.id" :value="c.id">{{ c.name }}（{{ doorLabel[c.door] }}）</option>
              </select>
              <select v-model="picks[i].shelfId" @change="onPickShelf(i)" :disabled="!picks[i].cabinetId">
                <option :value="null">选择层/抽屉</option>
                <option v-for="s in shelvesOf(picks[i].cabinetId)" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <select v-model="picks[i].boxId" :disabled="!picks[i].shelfId">
                <option :value="null">（可选）放入箱</option>
                <option v-for="b in boxesOf(picks[i].shelfId)" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
              <button class="btn-ghost" v-if="it.suggestion && it.suggestion.shelfId" @click="useSuggestion(i)">↩ 用建议位置</button>
            </div>
            <div class="cab-ref" v-if="cabPhotoOf(picks[i].cabinetId)">
              <img :src="imgSrc(cabPhotoOf(picks[i].cabinetId), 640)" alt="所选柜子实拍照片" loading="lazy" decoding="async">
              <span class="muted">📷 这是你拍的这个柜子的实照 · 对照实物确认放对了柜子</span>
            </div>
            <div class="why" v-if="!hasStructure">还没有任何柜体 —— 先到「收纳空间」用一句话生成柜子，就能一键入库了。</div>
          </div>

          <div class="actions">
            <button class="btn-main" :disabled="busy" @click="confirm(i)"
                    v-if="!isManual && it.suggestion && it.suggestion.path && it.suggestion.path.length">⚡ 一键入库到建议位置</button>
            <button class="btn-ghost" :disabled="busy" @click="confirm(i)"
                    v-if="!isManual && it.suggestion && it.suggestion.path && it.suggestion.path.length">✔ 入库到我选的位置</button>
            <button class="btn-main" :disabled="busy" @click="confirm(i)" v-else>✔ 确认入库</button>
            <button class="btn-ghost" v-if="isManual" :disabled="busy" @click="addManualRow">＋ 再加一件</button>
            <button class="btn-ghost btn-danger" @click="removeItem(i)">删除此项</button>
          </div>
        </div>
      </div>
      <div v-show="!items.length" class="glass card" style="display:flex;align-items:center;justify-content:center;min-height:300px">
        <div class="empty" v-if="!analyzing">识别结果会显示在这里<br>支持一图一物 / 整层批量 / 手动录入三种方式</div>
        <div class="empty" v-else><span class="spinner"></span><br><br>AI 识别中，请稍候…</div>
      </div>
    </div>

    <!-- 名称重复 → 问用户：合并到已有物品（并可指定并到哪个已入库位置）还是改名/新建
         Teleport 到 body：避免被 .main 的层叠上下文压在侧边栏/宠物下面 -->
    <teleport to="body">
    <div class="modal-mask" v-if="dup" @click.self="dup=null">
      <div class="modal glass" style="max-width:560px">
        <h3 class="sec">🔎 库里已有相近物品</h3>
        <div class="dup-lead">
          这次要入库的是 <b>「{{ dup.name }}」</b>，和库里已有的物品撞名了。合并后数量会累加到已有物品上，
          不会再多出一条「同物不同名」的记录。
        </div>

        <div class="form-row" v-if="dup.matches.length > 1">
          <label class="muted">合并到</label>
          <select v-model="dup.itemId" style="flex:1" @change="dup.placementId=null">
            <option v-for="m in dup.matches" :key="m.id" :value="m.id">{{ m.name }}（{{ m.category || '未分类' }} · 共 {{ m.totalQty }} 件）</option>
          </select>
        </div>
        <div class="dup-card" v-else-if="dupMatch()">
          <div class="dup-card-name">{{ dupMatch().name }}
            <span class="chip">{{ dupMatch().category || '未分类' }}</span>
            <span class="chip">共 {{ dupMatch().totalQty }} 件</span>
            <span class="chip" v-if="dupMatch().reason==='exact'">完全同名</span>
            <span class="chip" v-else>名字相似 {{ Math.round(dupMatch().score * 100) }}%</span>
          </div>
        </div>

        <div class="dup-locs" v-if="dupMatch()">
          <div class="dup-locs-title">合并到哪个位置？</div>
          <label class="dup-loc">
            <input type="radio" :value="null" v-model="dup.placementId">
            <span class="grow"><b>放到我这次选的位置</b>
              <span class="muted">（新增一个存放点，数量 {{ edits[dup.index] ? edits[dup.index].qty : 1 }} 件）</span></span>
          </label>
          <label class="dup-loc" v-for="p in dupMatch().placements" :key="p.id">
            <input type="radio" :value="p.id" v-model="dup.placementId">
            <span class="grow"><b>{{ p.path || '（位置已删除）' }}</b><span class="muted">现存 {{ p.qty }} 件</span></span>
          </label>
          <div class="empty" v-if="!dupMatch().placements.length" style="padding:10px 0">这件物品还没有存放记录</div>
        </div>

        <div class="actions" style="margin-top:16px">
          <button class="btn-main" :disabled="busy" @click="dupMerge">✔ 合并并入库</button>
          <button class="btn-ghost" :disabled="busy" @click="dupRename">✏️ 改个名字</button>
          <button class="btn-ghost" v-if="dupMatch() && dupMatch().reason!=='exact'" :disabled="busy" @click="dupCreateNew">＋ 仍作为新物品</button>
          <button class="btn-ghost" @click="dup=null">取消</button>
        </div>
      </div>
    </div>
    </teleport>
  </section>`,
};
