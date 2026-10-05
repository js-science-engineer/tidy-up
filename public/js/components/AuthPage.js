// 登录 / 注册页（云端模式）
// 平台邮箱认证完整契约：密码登录 + 验证码登录 + 注册（OTP 验证 + 密码）+ 忘记密码
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
      fail(msg) { this.err = msg || '操作失败，请重试'; },
      validEmail() { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()); },
      async sendCode() {
        this.err = ''; this.notice = '';
        if (!this.validEmail()) return this.fail('请输入正确的邮箱地址');
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
            ? (this._pending.isExistingUser ? '该邮箱已注册，将直接登录' : '验证码已发送到邮箱，请查收')
            : (this._pending.isExistingUser ? '验证码已发送到邮箱，请查收' : '该邮箱尚未注册，将引导你设置密码');
        } finally { this.busy = false; }
      },
      async passwordLogin() {
        this.err = '';
        if (!this.validEmail() || !this.password) return this.fail('请输入邮箱和密码');
        this.busy = true;
        try {
          const r = await this.client.auth.signInWithPassword({ email: this.email.trim(), password: this.password });
          if (r.error) return this.fail(r.error.message);
          await this.enter(r.data);
        } finally { this.busy = false; }
      },
      async otpLogin() {
        this.err = '';
        if (!this._pending || this._pending.email !== this.email.trim()) return this.fail('请先获取验证码');
        if (!this.code.trim()) return this.fail('请输入邮箱验证码');
        if (!this._pending.isExistingUser) return this.fail('该邮箱尚未注册，请切换到「注册」');
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
        if (!this.validEmail()) return this.fail('请输入正确的邮箱地址');
        if (!this._pending || this._pending.email !== this.email.trim()) return this.fail('请先获取邮箱验证码');
        if (!this.code.trim()) return this.fail('请输入邮箱验证码');
        if ((this.password || '').length < 8) return this.fail('密码至少 8 位');
        if (this.password !== this.password2) return this.fail('两次输入的密码不一致');
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
        if (!this.validEmail()) return this.fail('请输入正确的邮箱地址');
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
          <h2 style="margin:6px 0 4px">TidyLab · 实验室收纳</h2>
          <div style="color:var(--text-3);font-size:13px">登录后同步你的收纳数据与电子宠物</div>
        </div>

        <div v-if="!forgot" class="seg" style="width:100%;justify-content:center">
          <button class="chip" :class="{on: tab==='login'}" @click="tab='login'; err=''">登录</button>
          <button class="chip" :class="{on: tab==='register'}" @click="tab='register'; err=''">注册</button>
        </div>

        <!-- 忘记密码 -->
        <div v-if="forgot" style="margin-top:16px">
          <div v-if="forgotSent" class="empty">重置链接已发送到 {{ email }}，请查收邮箱。</div>
          <template v-else>
            <div class="form-row"><input v-model="email" type="email" placeholder="注册邮箱"></div>
            <button class="btn-main" style="width:100%" :disabled="busy" @click="doForgot">发送重置链接</button>
          </template>
          <div style="text-align:center;margin-top:12px">
            <a href="javascript:void 0" style="color:var(--text-3);font-size:13px" @click="forgot=false; forgotSent=false">返回登录</a>
          </div>
        </div>

        <!-- 登录 -->
        <div v-else-if="tab==='login'" style="margin-top:16px">
          <div class="form-row"><input v-model="email" type="email" placeholder="邮箱" @keyup.enter="passwordLogin"></div>
          <div class="form-row" v-if="loginMode==='password'">
            <input v-model="password" type="password" placeholder="密码" @keyup.enter="passwordLogin">
          </div>
          <div class="form-row" v-else style="gap:8px">
            <input v-model="code" placeholder="邮箱验证码" style="flex:1" @keyup.enter="otpLogin">
            <button class="btn-ghost" :disabled="busy || countdown>0" @click="sendCode">
              {{ countdown>0 ? countdown+'s' : '获取验证码' }}
            </button>
          </div>
          <button v-if="loginMode==='password'" class="btn-main" style="width:100%" :disabled="busy" @click="passwordLogin">登 录</button>
          <button v-else class="btn-main" style="width:100%" :disabled="busy" @click="otpLogin">登 录</button>
          <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:13px">
            <a href="javascript:void 0" style="color:var(--text-3)" @click="loginMode = loginMode==='password' ? 'otp' : 'password'">
              {{ loginMode==='password' ? '验证码登录' : '密码登录' }}
            </a>
            <a href="javascript:void 0" style="color:var(--text-3)" @click="forgot=true; err=''">忘记密码？</a>
          </div>
        </div>

        <!-- 注册 -->
        <div v-else style="margin-top:16px">
          <div class="form-row"><input v-model="email" type="email" placeholder="邮箱"></div>
          <div class="form-row" style="gap:8px">
            <input v-model="code" placeholder="邮箱验证码" style="flex:1">
            <button class="btn-ghost" :disabled="busy || countdown>0" @click="sendCode">
              {{ countdown>0 ? countdown+'s' : '获取验证码' }}
            </button>
          </div>
          <div class="form-row"><input v-model="password" type="password" placeholder="设置密码（至少 8 位）"></div>
          <div class="form-row"><input v-model="password2" type="password" placeholder="确认密码" @keyup.enter="register"></div>
          <button class="btn-main" style="width:100%" :disabled="busy" @click="register">注 册</button>
        </div>

        <div v-if="notice" style="color:var(--text-2);font-size:12.5px;margin-top:12px;text-align:center">{{ notice }}</div>
        <div v-if="err" style="color:#fca5a5;font-size:12.5px;margin-top:12px;text-align:center">{{ err }}</div>
      </div>
    </div>`,
  };
})();
