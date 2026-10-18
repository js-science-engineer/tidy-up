window.Components = window.Components || {};
window.Components.SettingsPage = {
  data: () => ({
    cfg: null, info: null, backups: [], busy: false, msg: '', err: '',
    keyInput: { glm: '', qwen: '' },
    perfLite: false,       // 界面性能模式（关毛玻璃/背景动画，手机上更省电）
    petAuto: true,         // 电子宠物自动表演（关掉后只有点它才动）
    petOn: true,           // 电子宠物是否在运行（关掉 = 整层停止，不再渲染）
    loadErr: '',           // 设置读取失败原因（失败也要给出口，不能一直停在骨架屏）
  }),
  computed: {
    // 云端模式：端口与本地 zip 备份不适用（数据由云数据库/云存储托管）
    isCloud() { return window.store.mode === 'cloud'; },
  },
  async mounted() {
    this.perfLite = window.__perfLiteOn ? window.__perfLiteOn() : false;
    this.petAuto = window.__petAutoPlay ? window.__petAutoPlay.get() : true;
    this.petOn = window.PetWidget && window.PetWidget.isEnabled ? window.PetWidget.isEnabled() : true;
    try { await this.refresh(); } catch (e) { this.loadErr = (e && e.message) || '设置读取失败'; }
  },
  methods: {
    setPerf(on) {
      this.perfLite = window.__setPerfLite ? window.__setPerfLite(on) : on;
      this.msg = on ? '已开启性能模式：关闭毛玻璃与背景动画，手机更流畅、更省电' : '已关闭性能模式：恢复玻璃质感与背景光斑动画';
    },
    setPetAuto(on) {
      this.petAuto = window.__petAutoPlay ? window.__petAutoPlay.set(on) : on;
      this.msg = on ? '电子宠物会自己玩耍表演' : '电子宠物已改为「按需表演」：不打扰、不耗电，点它照样会动';
    },
    async reload() {
      this.loadErr = '';
      try { await this.refresh(); } catch (e) { this.loadErr = (e && e.message) || '设置读取失败'; }
    },
    setPetOn(on) {
      if (!(window.PetWidget && window.PetWidget.setEnabled)) { this.msg = '宠物模块尚未加载，请刷新页面后再试'; return; }
      this.petOn = window.PetWidget.setEnabled(on);
      this.msg = on ? '电子宠物已重新开启，右下角见' : '电子宠物已停止：整层退出运行（不渲染、无动画），随时可在这里重新开启';
    },
    async refresh() {
      // 三个请求并行发（原来是串行 await，手机上等于 3 个来回叠加，
      // 这里是"切到设置页要等好几秒"的主因）
      const [cfg, info, backups] = await Promise.all([
        api('GET', '/settings'),
        api('GET', '/system/info').catch(() => null),
        this.isCloud ? Promise.resolve([]) : api('GET', '/backup/list').catch(() => []),
      ]);
      this.cfg = cfg;
      this.info = info;
      this.backups = backups || [];
      this.loadErr = '';
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
    <page-skeleton v-if="!cfg && !loadErr" :rows="3"></page-skeleton>
    <div class="glass card" v-else-if="loadErr">
      <div class="empty">⚠️ {{ loadErr }}</div>
      <div style="text-align:center;margin-top:10px"><button class="btn-main" @click="reload">重试</button></div>
    </div>

    <div class="settings" v-if="cfg">
      <div class="glass card" v-if="cfg">
        <h3 class="sec">🌐 {{ t('set.langTitle') }}</h3>
        <div class="seg" style="width:auto;justify-content:flex-start">
          <button class="chip" :class="{on: getLang()==='zh'}" @click="pickLang('zh')">中文</button>
          <button class="chip" :class="{on: getLang()==='en'}" @click="pickLang('en')">English</button>
        </div>
        <div class="muted" style="margin-top:8px">{{ t('set.langNote') }}</div>
      </div>

      <div class="glass card" v-if="cfg">
        <h3 class="sec">⚡ 界面性能（手机卡顿 / 发烫）</h3>
        <div class="seg" style="width:auto;justify-content:flex-start">
          <button class="chip" :class="{on: perfLite}" @click="setPerf(true)">性能优先</button>
          <button class="chip" :class="{on: !perfLite}" @click="setPerf(false)">效果优先</button>
        </div>
        <div class="muted" style="margin-top:8px">
          手机 / 触屏设备默认「性能优先」：关闭背景毛玻璃模糊与光斑漂移动画（这两项是持续占用 GPU、导致发烫的主因），
          界面改用具玻璃质感的实心面板，观感接近但帧率稳定。电脑上默认「效果优先」，想看完整玻璃折射效果切回来即可。
        </div>
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--rim-lo)">
          <div style="margin-bottom:8px"><b>🐾 电子宠物自动表演</b></div>
          <div class="seg" style="width:auto;justify-content:flex-start">
            <button class="chip" :class="{on: petAuto}" @click="setPetAuto(true)">会自己玩耍</button>
            <button class="chip" :class="{on: !petAuto}" @click="setPetAuto(false)">按需表演</button>
          </div>
          <div class="muted" style="margin-top:8px">
            手机上默认「按需表演」：宠物待机时完全静止（0 动画、不占 CPU），点它或拖它照样会动。
            自动表演虽然可爱，但等于让手机在你不操作时也一直跑动画——这是除图片之外最容易被忽略的耗电项。
          </div>
        </div>
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--rim-lo)">
          <div style="margin-bottom:8px"><b>🐾 电子宠物模拟</b></div>
          <div class="seg" style="width:auto;justify-content:flex-start">
            <button class="chip" :class="{on: petOn}" @click="setPetOn(true)">运行中</button>
            <button class="chip" :class="{on: !petOn}" @click="setPetOn(false)">已停止</button>
          </div>
          <div class="muted" style="margin-top:8px">
            停止后宠物整层退出运行：不再渲染、不再跑任何动画和计时器，页面上一个宠物相关的元素都不会留下——
            适合上课、开会或者只想安静整理东西的时候。想让它回来，点这里「运行中」，或点页面右下角那枚
            「宠物已停止 · 点这里重新开启」的小胶囊即可；选择会记住，刷新后保持。
          </div>
        </div>
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
