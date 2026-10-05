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
        this.msg = '✅ 设置已保存';
      } catch (e) { this.err = e.message; }
      finally { this.busy = false; }
    },
    async testAi() {
      this.msg = ''; this.err = '';
      try {
        const r = await api('POST', '/settings/test-ai');
        this.msg = '✅ AI 连通正常：' + r.reply;
      } catch (e) { this.err = e.message; }
    },
    async backupNow() {
      this.busy = true; this.msg = ''; this.err = '';
      try {
        const r = await api('POST', '/backup');
        this.msg = '✅ 已备份：' + r.file;
        this.backups = r.backups;
      } catch (e) { this.err = e.message; }
      finally { this.busy = false; }
    },
    async restore(b) {
      if (!confirm(`用「${b.file}」恢复数据？当前数据会先做一次应急备份，恢复后需要重启服务。`)) return;
      this.busy = true; this.msg = ''; this.err = '';
      try {
        const r = await api('POST', '/backup/restore', { file: b.file });
        this.msg = `✅ 已恢复 ${r.restored}（应急备份：${r.emergencyBackup}）。请关闭本页面并重新双击启动程序。`;
      } catch (e) { this.err = e.message; }
      finally { this.busy = false; }
    },
    sizeText(n) { return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; },
  },
  template: `
  <section class="screen">
    <div class="page-title">设置</div>
    <div class="page-sub">AI 供应商 · 数据备份与恢复 · 手机访问</div>

    <div class="settings">
      <div class="glass card" v-if="cfg">
        <h3 class="sec">🤖 AI 识别服务</h3>
        <div class="form-grid">
          <label>供应商</label>
          <select v-model="cfg.provider" style="max-width:280px">
            <option value="glm">智谱 GLM-4V-Flash（免费，推荐）</option>
            <option value="qwen">阿里云百炼 Qwen-VL</option>
          </select>
          <label>智谱 API Key</label>
          <input v-model="keyInput.glm" :placeholder="cfg._hasGlmKey ? ('已保存：' + cfg.glm.key) : '尚未设置'" type="password" style="max-width:420px">
          <label>Qwen API Key</label>
          <input v-model="keyInput.qwen" :placeholder="cfg._hasQwenKey ? ('已保存：' + cfg.qwen.key) : '尚未设置'" type="password" style="max-width:420px">
          <label>GLM 模型</label><input v-model="cfg.glm.model" style="max-width:280px">
          <label>Qwen 模型</label><input v-model="cfg.qwen.model" style="max-width:280px">
        </div>
        <div class="actions">
          <button class="btn-main" :disabled="busy" @click="save">保存设置</button>
          <button class="btn-ghost" :disabled="busy" @click="testAi">测试 AI 连通</button>
        </div>
      </div>

      <div class="glass card" v-if="info && !isCloud">
        <h3 class="sec">📱 手机访问（需同一 WiFi）</h3>
        <div class="today-row" v-for="u in info.lanUrls" :key="u"><div class="grow">{{ u }}</div></div>
        <div class="muted" v-if="!info.lanUrls.length">未检测到局域网地址（未联网或仅本机可用）</div>
      </div>

      <div class="glass card" v-if="!isCloud">
        <h3 class="sec">💾 数据备份与恢复</h3>
        <div class="actions" style="margin:0 0 14px">
          <button class="btn-main" :disabled="busy" @click="backupNow">立即备份</button>
          <span class="muted">每次启动会自动备份一次，保留最近 10 份</span>
        </div>
        <div class="backup-row" v-for="b in backups" :key="b.file">
          <div class="grow">{{ b.file }} <span class="muted">{{ sizeText(b.size) }}</span></div>
          <button class="btn-ghost btn-danger" :disabled="busy" @click="restore(b)">从此备份恢复</button>
        </div>
        <div v-if="!backups.length" class="empty">暂无备份</div>
      </div>

      <div class="glass card" v-if="isCloud">
        <h3 class="sec">☁️ 云端数据</h3>
        <div class="muted">数据由云数据库与云文件存储托管，随账号多设备同步，无需本地备份。</div>
      </div>

      <div class="ai-hint" v-if="msg">{{ msg }}</div>
      <div class="ai-hint" v-if="err">⚠️ {{ err }}</div>
    </div>
  </section>`,
};
