window.Components = window.Components || {};
window.Components.Studio = {
  data: () => ({
    tree: [],
    aiText: '', aiBusy: false, aiMsg: '', preview: null,
    sel: null,            // {type:'zone'|'cabinet'|'shelf'|'box', id}
    editName: '',
    addChild: { name: '', door: 'single', kind: 'shelf', color: '' },
    focusId: null,
    popup: null,          // 点击区域/柜子后的选项框 {type, id}
    album: null,          // 物品相册 {title, photo, items:[{id,name,qty,img,path}]}
    photoTarget: null,    // 正在上传实拍照片的柜子 id
  }),
  computed: {
    selNode() {
      if (!this.sel) return null;
      const find = (list, type) => {
        for (const z of this.tree) {
          if (type === 'zone' && z.id === this.sel.id) return { type: 'zone', node: z, label: '区域' };
          for (const f of z.floors) for (const c of f.cabinets) {
            if (type === 'cabinet' && c.id === this.sel.id) return { type: 'cabinet', node: c, label: '柜子' };
            for (const s of c.shelves) {
              if (type === 'shelf' && s.id === this.sel.id) return { type: 'shelf', node: s, label: '层/抽屉' };
              for (const b of s.boxes) {
                if (type === 'box' && b.id === this.sel.id) return { type: 'box', node: b, label: '箱子' };
              }
            }
          }
        }
        return null;
      };
      return find(this.tree, this.sel.type);
    },
    doorLabel() { return { double: '双开门', single: '单开门', drawer: '抽屉' }; },
    popupNode() { return this.popup ? this.findNode(this.popup.type, this.popup.id) : null; },
    popupTitle() { return this.popupNode ? this.popupNode.name : ''; },
    popupCount() {
      if (!this.popup) return 0;
      return this.collectItems(this.popup.type, this.popup.id).reduce((n, i) => n + i.qty, 0);
    },
  },
  async mounted() {
    await this.load();
    const m = (location.hash.split('?')[1] || '').match(/focus=cabinet-(\d+)/);
    if (m) {
      this.focusId = Number(m[1]);
      this.sel = { type: 'cabinet', id: this.focusId };
      setTimeout(() => {
        const el = document.querySelector('.cab.focused');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  },
  methods: {
    async load() { this.tree = await api('GET', '/structure'); },
    select(type, id) { this.sel = { type, id }; const n = this.selNode; this.editName = n ? n.node.name : ''; },
    async generate() {
      if (!this.aiText.trim()) return;
      this.aiBusy = true; this.aiMsg = '';
      try {
        this.preview = await api('POST', '/structure/generate', { text: this.aiText });
        this.aiMsg = '✅ 已生成预览，确认无误后点击「应用结构」';
      } catch (e) { this.aiMsg = '⚠️ ' + e.message; }
      finally { this.aiBusy = false; }
    },
    async applyPreview() {
      this.aiBusy = true;
      try {
        const r = await api('POST', '/structure/apply', this.preview);
        this.tree = r.tree; this.preview = null; this.aiText = '';
        this.aiMsg = '✅ 结构已保存';
      } catch (e) { this.aiMsg = '⚠️ ' + e.message; }
      finally { this.aiBusy = false; }
    },
    async addZone() {
      const name = prompt('区域名称：', '区域' + ['一','二','三','四','五','六'][this.tree.length] || '');
      if (!name) return;
      const r = await api('POST', '/zones', { name });
      this.tree = r.tree; this.select('zone', r.id);
    },
    async addChildEntity() {
      const a = this.addChild;
      if (!this.sel) return;
      if (!a.name.trim()) { alert('请输入名称'); return; }
      try {
        let r;
        if (this.sel.type === 'zone') r = await api('POST', '/cabinets', { parentId: this.sel.id, name: a.name, door: a.door, floor: 1 });
        else if (this.sel.type === 'cabinet') r = await api('POST', '/shelves', { parentId: this.sel.id, name: a.name, kind: a.kind });
        else if (this.sel.type === 'shelf') r = await api('POST', '/boxes', { parentId: this.sel.id, name: a.name, color: a.color });
        else { alert('箱子下不能再放容器'); return; }
        this.tree = r.tree; this.addChild = { name: '', door: 'single', kind: 'shelf', color: '' };
      } catch (e) { alert(e.message); }
    },
    async rename() {
      if (!this.selNode || !this.editName.trim()) return;
      try {
        const r = await api('PATCH', `/${this.sel.type}s/${this.sel.id}`, { name: this.editName });
        this.tree = r.tree;
      } catch (e) { alert(e.message); }
    },
    async changeDoor(door) {
      try { const r = await api('PATCH', `/cabinets/${this.sel.id}`, { door }); this.tree = r.tree; } catch (e) { alert(e.message); }
    },
    async changeKind(kind) {
      try { const r = await api('PATCH', `/shelves/${this.sel.id}`, { kind }); this.tree = r.tree; } catch (e) { alert(e.message); }
    },
    async del() {
      if (!this.selNode) return;
      if (!confirm(`确定删除「${this.selNode.node.name}」？（其下空的子容器会一并删除，有库存会被拒绝）`)) return;
      try {
        const r = await api('DELETE', `/${this.sel.type}s/${this.sel.id}`);
        this.tree = r.tree; this.sel = null;
      } catch (e) { alert(e.message); }
    },
    boxItemsCount(b) { return b.items.reduce((n, p) => n + p.qty, 0); },

    // ---- v1.4 物品相册：把区域/柜子当作"相册"，浏览里面的实物照片 ----
    findNode(type, id) {
      for (const z of this.tree) {
        if (type === 'zone' && z.id === id) return z;
        for (const f of z.floors) for (const c of f.cabinets) {
          if (type === 'cabinet' && c.id === id) return c;
          for (const s of c.shelves) {
            if (type === 'shelf' && s.id === id) return s;
            for (const b of s.boxes) if (type === 'box' && b.id === id) return b;
          }
        }
      }
      return null;
    },
    zoneOfCabinet(cabId) {
      for (const z of this.tree) for (const f of z.floors) for (const c of f.cabinets) if (c.id === cabId) return z;
      return null;
    },
    collectItems(type, id) {
      const out = [];
      const pushShelf = (s, prefix) => {
        for (const p of s.items) if (p.qty > 0) out.push({ id: p.item_id, name: p.item_name, qty: p.qty, img: p.img, path: prefix + s.name });
        for (const b of s.boxes || []) for (const p of b.items) if (p.qty > 0) out.push({ id: p.item_id, name: p.item_name, qty: p.qty, img: p.img, path: prefix + s.name + ' · ' + b.name });
      };
      const pushCab = (c, prefix) => { for (const s of c.shelves) pushShelf(s, prefix + c.name + ' › '); };
      if (type === 'zone') {
        const z = this.findNode('zone', id);
        if (z) for (const f of z.floors) for (const c of f.cabinets) pushCab(c, z.name + ' › ');
      } else if (type === 'cabinet') {
        const c = this.findNode('cabinet', id);
        if (c) { const z = this.zoneOfCabinet(c.id); pushCab(c, (z ? z.name + ' › ' : '')); }
      } else if (type === 'shelf') {
        const s = this.findNode('shelf', id);
        if (s) pushShelf(s, '');
      } else if (type === 'box') {
        const b = this.findNode('box', id);
        if (b) for (const p of b.items) if (p.qty > 0) out.push({ id: p.item_id, name: p.item_name, qty: p.qty, img: p.img, path: b.name });
      }
      return out;
    },
    openPopup(type, id) { this.album = null; this.popup = { type, id }; },
    showAlbum() {
      const p = this.popup;
      const node = this.findNode(p.type, p.id);
      this.album = {
        title: this.popupTitle,
        photo: (node && node.photo) || '',
        items: this.collectItems(p.type, p.id),
      };
      this.popup = null;
    },
    // ---- 柜子实拍照片：让柜子有"真实长相"，入库选位置时能对照实物，减少放错柜子 ----
    pickCabPhoto(cabId) {
      if (!cabId) return;
      this.photoTarget = cabId;
      const el = this.$refs.cabPhotoInput;
      if (el) el.click();
    },
    async onCabPhotoChange(e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      const cabId = this.photoTarget;
      if (!f || !cabId) return;
      const fd = new FormData();
      fd.append('image', f);
      try {
        const r = await api('POST', `/cabinets/${cabId}/photo`, fd);
        this.tree = r.tree;
        this.$root.notify('已保存柜子实拍照片');
      } catch (err) { alert('照片上传失败：' + err.message); }
    },
    async removeCabPhoto(cabId) {
      if (!cabId) return;
      if (!confirm('确定删除这个柜子的实拍照片？')) return;
      try {
        const r = await api('DELETE', `/cabinets/${cabId}/photo`);
        this.tree = r.tree;
        this.$root.notify('已删除柜子照片');
      } catch (err) { alert(err.message); }
    },
    popupCreate() {
      const p = this.popup; this.popup = null;
      this.select(p.type, p.id);
      setTimeout(() => { const el = document.querySelector('.edit-panel input'); if (el) el.focus(); }, 150);
    },
    popupEdit() { const p = this.popup; this.popup = null; this.select(p.type, p.id); },
    popupDelete() { const p = this.popup; this.popup = null; this.select(p.type, p.id); this.del(); },
    openItem(id) { if (id) store.detailItemId = id; },
  },
  template: `
  <section class="screen">
    <div class="page-title">收纳空间</div>
    <div class="page-sub">左侧 AI 对话生成，右侧 2D 可视化编辑 · 点柜子可加实拍照片、看物品相册</div>

    <div class="studio">
      <div class="ai-panel glass card">
        <h3 class="sec">✨ AI 对话生成</h3>
        <div v-if="aiMsg" class="msg ai">{{ aiMsg }}</div>
        <div v-if="preview">
          <div class="msg ai">预览：{{ preview.zoneName }} · {{ preview.floors.length }} 层 · 共 {{ preview.floors.reduce((n,f)=>n+f.cabinets.length,0) }} 个柜子
            <div v-for="f in preview.floors" :key="f.floor" class="muted" style="margin-top:6px">
              第 {{ f.floor }} 层：{{ f.cabinets.map(c=>c.name+'('+({double:'双开',single:'单开',drawer:'抽屉'})[c.door]+')').join('、') }}
            </div>
          </div>
          <div class="form-row" style="margin-top:10px">
            <button class="btn-main" :disabled="aiBusy" @click="applyPreview">✔ 应用结构</button>
            <button class="btn-ghost" @click="preview=null">放弃</button>
          </div>
        </div>
        <div v-else>
          <div class="ai-input"><textarea v-model="aiText" placeholder="描述你想要的收纳结构…&#10;例：两层。第一层 5 个柜子：1 个双开门 + 4 个单开门。第二层 3 个柜子，都是双开门。"></textarea></div>
          <div class="quick">
            <span class="chip" @click="aiText='两层。第一层 5 个柜子：1 个双开门 + 4 个单开门。第二层 3 个柜子，都是双开门。'">两层 5+3 柜</span>
            <span class="chip" @click="aiText='一层 4 个柜子，都是抽屉'">一层 4 抽屉</span>
          </div>
          <div class="form-row" style="margin-top:12px">
            <button class="btn-main" :disabled="aiBusy" @click="generate">{{ aiBusy ? '生成中…' : '生成' }}</button>
          </div>
        </div>
        <div class="form-row" style="margin-top:18px">
          <button class="btn-ghost" @click="addZone">＋ 新建区域</button>
        </div>
      </div>

      <div class="canvas glass card">
        <div v-if="!tree.length" class="empty">还没有区域 · 在左侧用 AI 生成或点击「新建区域」</div>
        <div v-for="z in tree" :key="z.id" style="margin-bottom:22px">
          <div class="zone-head"><span class="zone-tag" @click="openPopup('zone', z.id)" style="cursor:pointer" title="点击查看选项与物品相册">{{ z.name }}</span>
            <span class="zone-meta">点击区域 / 柜子 → 查看物品相册或继续创建</span></div>
          <div class="floor" v-for="f in z.floors" :key="f.floor">
            <div class="floor-name">第 {{ ['一','二','三','四','五','六'][f.floor-1] || f.floor }} 层</div>
            <div class="cabs">
              <div class="cab" :class="[c.door, {focused: focusId===c.id}]" v-for="c in f.cabinets" :key="c.id" @click="openPopup('cabinet', c.id)" :title="'点击查看 ' + c.name + ' 的物品相册'">
                <div class="cab-photo" v-if="c.photo"><img :src="imgSrc(c.photo)" :alt="c.name"></div>
                <div class="cab-name"><span>{{ c.name }} {{ doorLabel[c.door] }}<template v-if="c.photo"> · 📷</template></span><span class="muted">{{ c.occupancy }}%</span></div>
                <div class="boxes">
                  <template v-for="s in c.shelves" :key="s.id">
                    <span class="box" v-for="b in s.boxes" :key="b.id" @click.stop="select('box', b.id)">
                      📦 {{ b.name }}<template v-if="boxItemsCount(b)"> · {{ boxItemsCount(b) }}件</template>
                    </span>
                    <span class="box" :class="{empty: s.state==='empty'}" @click.stop="select('shelf', s.id)">
                      {{ s.name }}{{ s.state==='empty' ? ' · 空' : '' }}
                    </span>
                  </template>
                </div>
                <div class="cab-bar"><i :style="{width: c.occupancy + '%'}"></i></div>
              </div>
            </div>
          </div>
        </div>

        <div class="edit-panel" v-if="selNode">
          <h3 class="sec">✏️ 编辑：{{ selNode.label }}「{{ selNode.node.name }}」</h3>
          <div class="form-row">
            <label>名称</label><input v-model="editName" style="flex:1">
            <button class="btn-ghost" @click="rename">保存名称</button>
            <button class="btn-ghost btn-danger" @click="del">删除</button>
          </div>
          <div class="form-row" v-if="sel.type==='cabinet'">
            <label>门型</label>
            <select :value="selNode.node.door" @change="changeDoor($event.target.value)" style="flex:1">
              <option value="double">双开门</option><option value="single">单开门</option><option value="drawer">抽屉</option>
            </select>
          </div>
          <div class="form-row" v-if="sel.type==='cabinet'">
            <label>实拍照片</label>
            <button class="btn-ghost" @click="pickCabPhoto(sel.id)">📷 {{ selNode.node.photo ? '更换照片' : '上传柜子照片' }}</button>
            <button class="btn-ghost btn-danger" v-if="selNode.node.photo" @click="removeCabPhoto(sel.id)">删除</button>
            <span class="muted" v-if="!selNode.node.photo">拍一张柜子的真实照片，入库选位置时可对照，避免放错</span>
          </div>
          <div class="form-row" v-if="sel.type==='shelf'">
            <label>类型</label>
            <select :value="selNode.node.kind" @change="changeKind($event.target.value)" style="flex:1">
              <option value="shelf">层板格位</option><option value="drawer">抽屉</option>
            </select>
          </div>
          <div class="form-row" v-if="sel.type!=='box'">
            <label>添加子级</label>
            <input v-model="addChild.name" :placeholder="sel.type==='zone' ? '柜子名称，如 1号柜' : sel.type==='cabinet' ? '格位/抽屉名称' : '箱子名称'" style="flex:1">
            <select v-if="sel.type==='zone'" v-model="addChild.door" style="width:110px">
              <option value="double">双开门</option><option value="single">单开门</option><option value="drawer">抽屉</option>
            </select>
            <select v-if="sel.type==='cabinet'" v-model="addChild.kind" style="width:110px">
              <option value="shelf">层板格位</option><option value="drawer">抽屉</option>
            </select>
            <button class="btn-ghost" @click="addChildEntity">添加</button>
          </div>
          <div class="muted" v-if="sel.type==='box'">箱子用于细分格位，入库时可直接选到箱。</div>
        </div>
      </div>
    </div>

    <!-- 点击区域 / 柜子后的选项框 -->
    <div class="modal-mask" v-if="popup" @click.self="popup=null">
      <div class="modal glass" style="max-width:520px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <div class="recog-img" style="width:52px;height:52px;font-size:24px">{{ popup.type==='zone' ? '🗺️' : '🗄️' }}</div>
          <div style="flex:1">
            <div style="font-weight:650;font-size:16px">{{ popupTitle }}</div>
            <div class="muted" style="font-size:12.5px">{{ popup.type==='zone' ? '区域' : '柜子' }} · 里面共有 {{ popupCount }} 件物品</div>
          </div>
          <button class="btn-ghost" @click="popup=null">关闭</button>
        </div>
        <div class="form-row">
          <button class="btn-main" style="flex:1" @click="showAlbum">📷 查看物品相册</button>
          <button class="btn-ghost" style="flex:1" @click="popupCreate">➕ 继续创建</button>
        </div>
        <div class="form-row" v-if="popup.type==='cabinet'">
          <button class="btn-ghost" style="flex:1" @click="pickCabPhoto(popup.id)">📷 {{ popupNode && popupNode.photo ? '更换柜子实拍照片' : '添加柜子实拍照片' }}</button>
          <button class="btn-ghost btn-danger" style="flex:1" v-if="popupNode && popupNode.photo" @click="removeCabPhoto(popup.id)">🗑 删除照片</button>
        </div>
        <div class="form-row">
          <button class="btn-ghost" style="flex:1" @click="popupEdit">✏️ 编辑名称/属性</button>
          <button class="btn-ghost btn-danger" style="flex:1" @click="popupDelete">🗑 删除</button>
        </div>
      </div>
    </div>

    <!-- 物品相册：像手机相册一样浏览这个区域/柜子里的实物照片 -->
    <div class="modal-mask" v-if="album" @click.self="album=null">
      <div class="modal glass" style="max-width:780px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div class="recog-img" style="width:46px;height:46px;font-size:22px">📷</div>
          <div style="flex:1">
            <div style="font-weight:650;font-size:16px">{{ album.title }}</div>
            <div class="muted" style="font-size:12.5px">{{ album.items.length }} 种物品 · 点图片可看详情与出入库</div>
          </div>
          <button class="btn-ghost" @click="album=null">关闭</button>
        </div>
        <div class="album-cab" v-if="album.photo">
          <img :src="imgSrc(album.photo)" :alt="album.title">
          <div class="album-cab-cap muted">📷 该柜子的实拍照片</div>
        </div>
        <div class="album-grid" v-if="album.items.length">
          <div class="album-card" v-for="(it, i) in album.items" :key="i" @click="openItem(it.id)">
            <div class="album-photo"><img v-if="it.img" :src="imgSrc(it.img)"><span v-else>📦</span></div>
            <div class="album-name">{{ it.name }}</div>
            <div class="album-meta"><b v-if="it.qty>1">×{{ it.qty }}</b> {{ it.path }}</div>
          </div>
        </div>
        <div v-else class="empty">这里还没有放东西 · 去「识别入库」添加，或在总览把物品拖进来</div>
      </div>
    </div>

    <!-- 柜子实拍照片上传（隐藏输入框，由 pickCabPhoto 触发） -->
    <input ref="cabPhotoInput" type="file" accept="image/*" style="display:none" @change="onCabPhotoChange">
  </section>`,
};
