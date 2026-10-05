// 登录 / 注册页（云端模式）
// 平台邮箱认证完整契约：密码登录 + 验证码登录 + 注册（OTP 验证 + 密码）+ 忘记密码
// 文案走 i18n（t()），服务端返回的错误消息保持原文
(function () {
  const c = window.Components = window.Components || {};
  c.AuthPage = {
    data: () => ({
      tab: 'login',            // login | register
      loginMode: 'password',   // password | otp
      email: '',
      password: '',
      password2: '',
      code: '',
      forgot: false,
      forgotSent: false,
      busy: false,
      err: '',
      notice: '',
      countdown: 0,
      _pending: null,          // {email, verificationId, isExistingUser}
    }),
    computed: {
      client() { return window.__cloudClient; },
    },
    methods: {
      fail(msg) { this.err = msg || t('auth.fail'); },
      validEmail() { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()); },
      async sendCode() {
        this.err = ''; this.notice = '';
        if (!this.validEmail()) return this.fail(t('auth.badEmail'));
        this.busy = true;
        try {
          const sent = await this.client.auth.sendOtp({ email: this.email.trim() });
          if (sent.error) return this.fail(sent.error.message);
          this._pending = {
            email: this.email.trim(),
            verificationId: sent.data.verificationId,
            isExistingUser: !!sent.data.isExistingUser,
          };
          this.countdown = 60;
          const tick = setInterval(() => { this.countdown--; if (this.countdown <= 0) clearInterval(tick); }, 1000);
          this.notice = this.tab === 'register'
            ? (this._pending.isExistingUser ? t('auth.alreadyUser') : t('auth.codeSent'))
            : (this._pending.isExistingUser ? t('auth.codeSent') : t('auth.newUserPw'));
        } finally { this.busy = false; }
      },
      async passwordLogin() {
        this.err = '';
        if (!this.validEmail() || !this.password) return this.fail(t('auth.needEmailPw'));
        this.busy = true;
        try {
          const r = await this.client.auth.signInWithPassword({ email: this.email.trim(), password: this.password });
          if (r.error) return this.fail(r.error.message);
          await this.enter(r.data);
        } finally { this.busy = false; }
      },
      async otpLogin() {
        this.err = '';
        if (!this._pending || this._pending.email !== this.email.trim()) return this.fail(t('auth.needCodeFirst'));
        if (!this.code.trim()) return this.fail(t('auth.needCode'));
        if (!this._pending.isExistingUser) return this.fail(t('auth.notRegistered'));
        this.busy = true;
        try {
          const r = await this.client.auth.verifyOtp({
            email: this._pending.email,
            verificationId: this._pending.verificationId,
            isExistingUser: true,
            token: this.code.trim(),
          });
          if (r.error) return this.fail(r.error.message);
          await this.enter(r.data);
        } finally { this.busy = false; }
      },
      async register() {
        this.err = '';
        if (!this.validEmail()) return this.fail(t('auth.badEmail'));
        if (!this._pending || this._pending.email !== this.email.trim()) return this.fail(t('auth.needCodeReg'));
        if (!this.code.trim()) return this.fail(t('auth.needCode'));
        if ((this.password || '').length < 8) return this.fail(t('auth.pwShort'));
        if (this.password !== this.password2) return this.fail(t('auth.pwMismatch'));
        this.busy = true;
        try {
          const r = await this.client.auth.verifyOtp({
            email: this._pending.email,
            verificationId: this._pending.verificationId,
            isExistingUser: this._pending.isExistingUser,
            token: this.code.trim(),
            password: this.password,
          });
          if (r.error) return this.fail(r.error.message);
          await this.enter(r.data);
        } finally { this.busy = false; }
      },
      async doForgot() {
        this.err = '';
        if (!this.validEmail()) return this.fail(t('auth.badEmail'));
        this.busy = true;
        try {
          const r = await this.client.auth.resetPasswordForEmail(this.email.trim());
          if (r.error) return this.fail(r.error.message);
          this.forgotSent = true;
        } finally { this.busy = false; }
      },
      // 登录/注册成功 → 建立云 API 上下文并进入主应用
      async enter() {
        const { data: session } = await this.client.auth.getSession();
        await window.__tidyStartCloud(session);
        window.store.dataVersion++;
      },
    },
    template: `
    <div class="auth-wrap">
      <div class="glass card auth-card">
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:34px">🧊</div>
          <h2 style="margin:6px 0 4px">{{ t('auth.brand') }}</h2>
          <div style="color:var(--text-3);font-size:13px">{{ t('auth.subtitle') }}</div>
        </div>

        <div v-if="!forgot" class="seg" style="width:100%;justify-content:center">
          <button class="chip" :class="{on: tab==='login'}" @click="tab='login'; err=''">{{ t('auth.login') }}</button>
          <button class="chip" :class="{on: tab==='register'}" @click="tab='register'; err=''">{{ t('auth.register') }}</button>
        </div>

        <!-- 忘记密码 -->
        <div v-if="forgot" style="margin-top:16px">
          <div v-if="forgotSent" class="empty">{{ t('auth.resetSent', { email }) }}</div>
          <template v-else>
            <div class="form-row"><input v-model="email" type="email" :placeholder="t('auth.regEmail')"></div>
            <button class="btn-main" style="width:100%" :disabled="busy" @click="doForgot">{{ t('auth.sendReset') }}</button>
          </template>
          <div style="text-align:center;margin-top:12px">
            <a href="javascript:void 0" style="color:var(--text-3);font-size:13px" @click="forgot=false; forgotSent=false">{{ t('auth.backLogin') }}</a>
          </div>
        </div>

        <!-- 登录 -->
        <div v-else-if="tab==='login'" style="margin-top:16px">
          <div class="form-row"><input v-model="email" type="email" :placeholder="t('auth.email')" @keyup.enter="passwordLogin"></div>
          <div class="form-row" v-if="loginMode==='password'">
            <input v-model="password" type="password" :placeholder="t('auth.password')" @keyup.enter="passwordLogin">
          </div>
          <div class="form-row" v-else style="gap:8px">
            <input v-model="code" :placeholder="t('auth.code')" style="flex:1" @keyup.enter="otpLogin">
            <button class="btn-ghost" :disabled="busy || countdown>0" @click="sendCode">
              {{ countdown>0 ? countdown+'s' : t('auth.getCode') }}
            </button>
          </div>
          <button v-if="loginMode==='password'" class="btn-main" style="width:100%" :disabled="busy" @click="passwordLogin">{{ t('auth.doLogin') }}</button>
          <button v-else class="btn-main" style="width:100%" :disabled="busy" @click="otpLogin">{{ t('auth.doLogin') }}</button>
          <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:13px">
            <a href="javascript:void 0" style="color:var(--text-3)" @click="loginMode = loginMode==='password' ? 'otp' : 'password'">
              {{ loginMode==='password' ? t('auth.otpMode') : t('auth.pwMode') }}
            </a>
            <a href="javascript:void 0" style="color:var(--text-3)" @click="forgot=true; err=''">{{ t('auth.forgot') }}</a>
          </div>
        </div>

        <!-- 注册 -->
        <div v-else style="margin-top:16px">
          <div class="form-row"><input v-model="email" type="email" :placeholder="t('auth.email')"></div>
          <div class="form-row" style="gap:8px">
            <input v-model="code" :placeholder="t('auth.code')" style="flex:1">
            <button class="btn-ghost" :disabled="busy || countdown>0" @click="sendCode">
              {{ countdown>0 ? countdown+'s' : t('auth.getCode') }}
            </button>
          </div>
          <div class="form-row"><input v-model="password" type="password" :placeholder="t('auth.pwPlaceholder')"></div>
          <div class="form-row"><input v-model="password2" type="password" :placeholder="t('auth.pw2Placeholder')" @keyup.enter="register"></div>
          <button class="btn-main" style="width:100%" :disabled="busy" @click="register">{{ t('auth.doRegister') }}</button>
        </div>

        <div v-if="notice" style="color:var(--text-2);font-size:12.5px;margin-top:12px;text-align:center">{{ notice }}</div>
        <div v-if="err" style="color:#fca5a5;font-size:12.5px;margin-top:12px;text-align:center">{{ err }}</div>
      </div>
    </div>`,
  };
})();
