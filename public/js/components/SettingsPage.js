window.Components = window.Components || {};
window.Components.SettingsPage = {
  data: () => ({
    cfg: null, info: null, backups: [], busy: false, msg: '', err: '',
    keyInput: { glm: '', qwen: '' },
  }),
  computed: {
    // 云端模式：端口与本地 zip 备份不适用（数据由云数据库/云存储托管）
    isCloud() { return window.store.mode === 'cloud'; },
  },
  async mounted() { await this.refresh(); },
  methods: {
    async refresh() {
      this.cfg = await api('GET', '/settings');
      this.info = await api('GET', '/system/info');
      this.backups = this.isCloud ? [] : await api('GET', '/backup/list');
    },
    async save() {
      this.busy = true; this.msg = ''; this.err = '';
      try {
        const patch = {
          provider: this.cfg.provider, theme: this.cfg.theme,
          glm: { key: this.keyInput.glm || this.cfg.glm.key, model: this.cfg.glm.model },
          qwen: { key: this.keyInput.qwen || this.cfg.qwen.key, model: this.cfg.qwen.model },
        };
        if (!this.isCloud) patch.port = this.cfg.port;
        this.cfg = await api('PUT', '/settings', patch);
        this.keyInput = { glm: '', qwen: '' };
        this.msg = t('set.saved');
      } catch (e) { this.err = e.message; }
      finally { this.busy = false; }
    },
    async testAi() {
      this.msg = ''; this.err = '';
      try {
        const r = await api('POST', '/settings/test-ai');
        this.msg = t('set.aiOk') + r.reply;
      } catch (e) { this.err = e.message; }
    },
    async backupNow() {
      this.busy = true; this.msg = ''; this.err = '';
      try {
        const r = await api('POST', '/backup');
        this.msg = t('set.backedUp') + r.file;
        this.backups = r.backups;
      } catch (e) { this.err = e.message; }
      finally { this.busy = false; }
    },
    async restore(b) {
      if (!confirm(t('set.restoreConfirm', { file: b.file }))) return;
      this.busy = true; this.msg = ''; this.err = '';
      try {
        const r = await api('POST', '/backup/restore', { file: b.file });
        this.msg = t('set.restored', { restored: r.restored, eb: r.emergencyBackup });
      } catch (e) { this.err = e.message; }
      finally { this.busy = false; }
    },
    // 中 / 英切换：i18n 模块内部持久化并即时刷新全界面
    pickLang(lang) { setLang(lang); },
    sizeText(n) { return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; },
  },
  template: `
  <section class="screen">
    <div class="page-title">{{ t('set.title') }}</div>
    <div class="page-sub">{{ t('set.sub') }}</div>

    <div class="settings">
      <div class="glass card" v-if="cfg">
        <h3 class="sec">🌐 {{ t('set.langTitle') }}</h3>
        <div class="seg" style="width:auto;justify-content:flex-start">
          <button class="chip" :class="{on: getLang()==='zh'}" @click="pickLang('zh')">中文</button>
          <button class="chip" :class="{on: getLang()==='en'}" @click="pickLang('en')">English</button>
        </div>
        <div class="muted" style="margin-top:8px">{{ t('set.langNote') }}</div>
      </div>

      <div class="glass card" v-if="cfg">
        <h3 class="sec">{{ t('set.aiTitle') }}</h3>
        <div class="form-grid">
          <label>{{ t('set.provider') }}</label>
          <select v-model="cfg.provider" style="max-width:280px">
            <option value="glm">{{ t('set.glmOpt') }}</option>
            <option value="qwen">{{ t('set.qwenOpt') }}</option>
          </select>
          <label>{{ t('set.glmKey') }}</label>
          <input v-model="keyInput.glm" :placeholder="cfg._hasGlmKey ? (t('set.savedAs') + cfg.glm.key) : t('set.notSet')" type="password" style="max-width:420px">
          <label>{{ t('set.qwenKey') }}</label>
          <input v-model="keyInput.qwen" :placeholder="cfg._hasQwenKey ? (t('set.savedAs') + cfg.qwen.key) : t('set.notSet')" type="password" style="max-width:420px">
          <label>{{ t('set.glmModel') }}</label><input v-model="cfg.glm.model" style="max-width:280px">
          <label>{{ t('set.qwenModel') }}</label><input v-model="cfg.qwen.model" style="max-width:280px">
        </div>
        <div class="actions">
          <button class="btn-main" :disabled="busy" @click="save">{{ t('set.save') }}</button>
          <button class="btn-ghost" :disabled="busy" @click="testAi">{{ t('set.testAi') }}</button>
        </div>
      </div>

      <div class="glass card" v-if="info && !isCloud">
        <h3 class="sec">{{ t('set.phoneTitle') }}</h3>
        <div class="today-row" v-for="u in info.lanUrls" :key="u"><div class="grow">{{ u }}</div></div>
        <div class="muted" v-if="!info.lanUrls.length">{{ t('set.noLan') }}</div>
      </div>

      <div class="glass card" v-if="!isCloud">
        <h3 class="sec">{{ t('set.backupTitle') }}</h3>
        <div class="actions" style="margin:0 0 14px">
          <button class="btn-main" :disabled="busy" @click="backupNow">{{ t('set.backupNow') }}</button>
          <span class="muted">{{ t('set.backupNote') }}</span>
        </div>
        <div class="backup-row" v-for="b in backups" :key="b.file">
          <div class="grow">{{ b.file }} <span class="muted">{{ sizeText(b.size) }}</span></div>
          <button class="btn-ghost btn-danger" :disabled="busy" @click="restore(b)">{{ t('set.restore') }}</button>
        </div>
        <div v-if="!backups.length" class="empty">{{ t('set.noBackups') }}</div>
      </div>

      <div class="glass card" v-if="isCloud">
        <h3 class="sec">{{ t('set.cloudTitle') }}</h3>
        <div class="muted">{{ t('set.cloudNote') }}</div>
      </div>

      <div class="ai-hint" v-if="msg">{{ msg }}</div>
      <div class="ai-hint" v-if="err">⚠️ {{ err }}</div>
    </div>
  </section>`,
};
