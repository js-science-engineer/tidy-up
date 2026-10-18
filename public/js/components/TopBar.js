window.Components = window.Components || {};
window.Components.TopBar = {
  props: ['theme'],
  emits: ['toggle-theme', 'toast'],
  data: () => ({
    q: '', now: new Date(), timer: null, narrow: false,
    spaceOpen: false, newName: '', joinCode: '', busy: false, err: '',
  }),
  computed: {
    // 右上角当地时间：日期 + 星期（星期文案随语言切换）
    clockDate() {
      const d = this.now;
      const week = t('topbar.weekdays')[d.getDay()];
      const suffix = t('topbar.weekPrefix') ? t('topbar.weekPrefix') + week : week;
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${suffix}`;
    },
    // 时:分:秒（窄屏只显示到分钟，省掉每秒重绘 —— 手机上有明显的耗电差别）
    clockTime() {
      const d = this.now;
      const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      return this.narrow ? hm : `${hm}:${pad2(d.getSeconds())}`;
    },
    isCloud() { return window.store.mode === 'cloud'; },
    labs() { return window.store.labs || []; },
    space() { return window.store.space || { type: 'personal', labId: null }; },
    spaceName() { return window.spaceLabel(); },
    spaceIcon() { return this.space.type === 'lab' ? '🧪' : '👤'; },
    defaultSpace() { return window.store.defaultSpace || null; },
    defaultLabel() {
      const d = this.defaultSpace;
      if (!d) return t('lab.defaultNone');
      if (d.type === 'lab') {
        const lab = this.labs.find((l) => Number(l.id) === Number(d.labId));
        return lab ? lab.name : t('lab.unknown');
      }
      return t('lab.personal');
    },
    isDefaultCurrent() { return sameSpace(this.defaultSpace, this.space); },
  },
  mounted() {
    this.narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches;
    this.startTimer();
    document.addEventListener('visibilitychange', this.startTimer);
  },
  beforeUnmount() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    document.removeEventListener('visibilitychange', this.startTimer);
  },
  methods: {
    // 页面切到后台就停表：手机上一个每秒跳的定时器会持续唤醒渲染管线
    startTimer() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (document.hidden) return;
      this.now = new Date();
      this.timer = setInterval(() => { this.now = new Date(); }, this.narrow ? 15000 : 1000);
    },
    setDefault() {
      window.__tidySetDefaultSpace(this.space);
      this.$emit('toast', t('lab.defaultSet', { name: this.spaceName }));
    },
    clearDefault() {
      window.__tidySetDefaultSpace(null);
      this.$emit('toast', t('lab.defaultCleared'));
    },
    go() { if (this.q.trim()) location.hash = '#/search?q=' + encodeURIComponent(this.q.trim()); },

    openSpace() { this.err = ''; this.newName = ''; this.joinCode = ''; this.spaceOpen = true; },

    isActive(s) {
      const labId = s.type === 'lab' ? Number(s.labId) : null;
      const cur = this.space.type === 'lab' ? Number(this.space.labId) : null;
      return labId === cur;
    },
    // 切换空间：整站数据的"来源"换了，触发全局重新拉取
    pick(s) {
      window.__tidySetSpace(s);
      this.spaceOpen = false;
      this.$emit('toast', t('lab.switched', { name: window.spaceLabel() }));
    },

    async createLab() {
      this.err = '';
      const name = this.newName.trim();
      if (!name) { this.err = t('lab.needName'); return; }
      this.busy = true;
      try {
        const lab = await window.__cloudApi.api('POST', '/labs', { name, displayName: window.store.myName });
        await window.__tidyRefreshLabs();
        this.pick({ type: 'lab', labId: lab.id });
        this.$emit('toast', t('lab.created', { name: lab.name }));
      } catch (e) { this.err = e && e.message ? e.message : t('lab.createFail'); }
      finally { this.busy = false; }
    },

    async joinLab() {
      this.err = '';
      const code = this.joinCode.trim();
      if (!code) { this.err = t('lab.needCode'); return; }
      this.busy = true;
      try {
        const lab = await window.__cloudApi.api('POST', '/labs/join', { code, displayName: window.store.myName });
        await window.__tidyRefreshLabs();
        this.pick({ type: 'lab', labId: lab.id });
        this.$emit('toast', t('lab.joined', { name: lab.name }));
      } catch (e) { this.err = e && e.message ? e.message : t('lab.joinFail'); }
      finally { this.busy = false; }
    },

    goLab() { this.spaceOpen = false; location.hash = '#/lab'; },
  },
  template: `
  <header class="topbar liquid glass">
    <div class="brand"><div class="logo">🧊</div><span>{{ t('topbar.brand') }}</span></div>
    <div class="search glass">🔎<input v-model="q" :placeholder="t('topbar.searchPh')" @keyup.enter="go"></div>
    <div style="flex:1"></div>

    <!-- 空间切换（仅云端模式）：一眼看出当前在看"自己的"还是"实验室的" -->
    <div v-if="isCloud" class="glass" :title="t('lab.switchTitle')"
         style="display:flex;align-items:center;gap:7px;padding:9px 14px;border-radius:999px;cursor:pointer;font-size:12.5px;color:var(--text-2)"
         @click="openSpace">
      <span>{{ spaceIcon }}</span>
      <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ spaceName }}</span>
      <span style="opacity:.5">▾</span>
    </div>

    <div class="clock glass" :title="t('topbar.localTime') + ' ' + clockDate + ' ' + clockTime">
      <span class="clock-date">{{ clockDate }}</span>
      <b class="clock-time">{{ clockTime }}</b>
    </div>
    <div class="icon-pill glass" @click="$emit('toggle-theme')" :title="theme==='dark' ? t('topbar.toLight') : t('topbar.toDark')">{{ theme==='dark' ? '🌙' : '☀️' }}</div>
  </header>

  <!-- 空间切换面板 -->
  <div class="modal-mask" v-if="spaceOpen" @click.self="spaceOpen=false">
    <div class="modal glass" style="max-width:540px">
      <h3 class="sec">🧪 {{ t('lab.title') }}</h3>
      <div class="muted" style="font-size:12.5px;margin:-6px 0 14px;color:var(--text-3)">{{ t('lab.switchTip') }}</div>

      <div style="margin-bottom:16px">
        <button class="btn-ghost" style="width:100%;display:flex;align-items:center;gap:9px;text-align:left;margin-bottom:8px"
                :style="isActive({type:'personal'}) ? 'border-color:var(--rim-hi);color:var(--text)' : ''"
                @click="pick({type:'personal',labId:null})">
          <span>👤</span><span style="flex:1">{{ t('lab.personal') }}</span>
          <span v-if="isActive({type:'personal'})">✓</span>
        </button>
        <button class="btn-ghost" v-for="l in labs" :key="'sp'+l.id"
                style="width:100%;display:flex;align-items:center;gap:9px;text-align:left;margin-bottom:8px"
                :style="isActive({type:'lab',labId:l.id}) ? 'border-color:var(--rim-hi);color:var(--text)' : ''"
                @click="pick({type:'lab',labId:l.id})">
          <span>🧪</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            {{ l.name }}<span style="color:var(--text-3);font-size:11.5px"> · {{ t('lab.memberCount', { n: (l.members||[]).length }) }}</span>
          </span>
          <span v-if="l.isOwner" class="chip" style="cursor:default">{{ t('lab.admin') }}</span>
          <span v-if="isActive({type:'lab',labId:l.id})">✓</span>
        </button>
        <div v-if="!labs.length" class="empty" style="padding:12px 0">{{ t('lab.none') }}</div>
      </div>

      <h3 class="sec">🔗 {{ t('lab.joinTitle') }}</h3>
      <div class="form-row">
        <input v-model="joinCode" :placeholder="t('lab.codePh')" style="flex:1;text-transform:uppercase" @keyup.enter="joinLab">
        <button class="btn-ghost" :disabled="busy" @click="joinLab">{{ t('lab.joinBtn') }}</button>
      </div>

      <h3 class="sec" style="margin-top:16px">✨ {{ t('lab.createTitle') }}</h3>
      <div class="form-row">
        <input v-model="newName" :placeholder="t('lab.namePh')" style="flex:1" @keyup.enter="createLab">
        <button class="btn-main" :disabled="busy" @click="createLab">{{ t('lab.createBtn') }}</button>
      </div>

      <div v-if="err" style="color:#fca5a5;font-size:12.5px;margin-top:10px">{{ err }}</div>

      <div class="glass card" style="margin-top:16px;padding:13px 15px">
        <div style="font-size:13px;font-weight:500">{{ t('lab.defaultTitle') }}</div>
        <div class="muted" style="font-size:12px;margin:5px 0 10px">{{ t('lab.defaultTip') }}</div>
        <div class="form-row">
          <span class="chip" :class="{on: !!defaultSpace}">{{ defaultLabel }}</span>
          <div style="flex:1"></div>
          <button v-if="!isDefaultCurrent" class="btn-ghost" :disabled="busy" @click="setDefault">{{ t('lab.setDefault') }}</button>
          <button v-else class="btn-ghost btn-danger" :disabled="busy" @click="clearDefault">{{ t('lab.clearDefault') }}</button>
        </div>
      </div>

      <div class="form-row" style="margin-top:16px">
        <button class="btn-ghost" @click="goLab">{{ t('lab.manage') }}</button>
        <button class="btn-ghost" @click="spaceOpen=false">{{ t('lab.close') }}</button>
      </div>
    </div>
  </div>`,
};

// 模板外也可用的补零工具（定义在组件之外，模板里由 computed 调用）
function pad2(n) { return String(n).padStart(2, '0'); }
// 两个空间是否指同一个（个人空间 / 同一个实验室）
function sameSpace(a, b) {
  const na = a && a.type === 'lab' && a.labId ? 'lab:' + Number(a.labId) : 'personal';
  const nb = b && b.type === 'lab' && b.labId ? 'lab:' + Number(b.labId) : 'personal';
  return na === nb;
}
