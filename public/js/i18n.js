/* TidyLab i18n：中 / 英界面切换（无构建步骤，浏览器与 Node 测试共用）
 *
 * - 词典 DICT.zh / DICT.en，key 形如 "模块.条目"
 * - t(key, vars)：模板与 JS 通用；内部状态经 Vue.reactive 包装，
 *   在模板/computed 里调用 t() 可自动追踪依赖 → setLang 后全界面即时刷新
 * - getLang() / setLang(lang)：偏好持久化到 localStorage('tidy-lang')，
 *   首次访问按浏览器语言自动选择（zh 默认）
 * - 缺失 key：先回落中文，再回落 key 本身；支持数组值（如星期表）
 */
(function (root) {
  const DICT = {
    zh: {
      nav: {
        dashboard: '总览',
        studio: '收纳空间',
        scan: '识别入库',
        search: '搜索',
        stats: '统计看板',
        settings: '设置',
        sort: '调整模块顺序',
        sortTip: '拖动整行，或点 ▲▼ 微调；排第一位的就是打开网站的首页',
        sortDone: '完成',
        moveUp: '上移',
        moveDown: '下移',
        sortReset: '↺ 恢复默认顺序',
      },
      topbar: {
        brand: 'TidyLab · 实验室收纳',
        searchPh: '搜索物品，试试「那个蓝色的测电压的东西」…',
        localTime: '当地时间',
        weekPrefix: '周',
        weekdays: ['日', '一', '二', '三', '四', '五', '六'],
        toLight: '切换浅色',
        toDark: '切换深色',
      },
      set: {
        title: '设置',
        sub: 'AI 供应商 · 数据备份与恢复 · 手机访问',
        aiTitle: '🤖 AI 识别服务',
        provider: '供应商',
        glmOpt: '智谱 GLM-4V-Flash（免费，推荐）',
        qwenOpt: '阿里云百炼 Qwen-VL',
        glmKey: '智谱 API Key',
        qwenKey: 'Qwen API Key',
        savedAs: '已保存：',
        notSet: '尚未设置',
        glmModel: 'GLM 模型',
        qwenModel: 'Qwen 模型',
        save: '保存设置',
        testAi: '测试 AI 连通',
        phoneTitle: '📱 手机访问（需同一 WiFi）',
        noLan: '未检测到局域网地址（未联网或仅本机可用）',
        backupTitle: '💾 数据备份与恢复',
        backupNow: '立即备份',
        backupNote: '每次启动会自动备份一次，保留最近 10 份',
        restore: '从此备份恢复',
        restoreConfirm: '用「{file}」恢复数据？当前数据会先做一次应急备份，恢复后需要重启服务。',
        restored: '✅ 已恢复 {restored}（应急备份：{eb}）。请关闭本页面并重新双击启动程序。',
        noBackups: '暂无备份',
        cloudTitle: '☁️ 云端数据',
        cloudNote: '数据由云数据库与云文件存储托管，随账号多设备同步，无需本地备份。',
        langTitle: '语言 / Language',
        langNote: '切换界面显示语言，立即生效',
        saved: '✅ 设置已保存',
        aiOk: '✅ AI 连通正常：',
        backedUp: '✅ 已备份：',
      },
      auth: {
        brand: 'TidyLab · 实验室收纳',
        subtitle: '登录后同步你的收纳数据与电子宠物',
        login: '登录',
        register: '注册',
        doLogin: '登 录',
        doRegister: '注 册',
        email: '邮箱',
        regEmail: '注册邮箱',
        password: '密码',
        code: '邮箱验证码',
        getCode: '获取验证码',
        pwPlaceholder: '设置密码（至少 8 位）',
        pw2Placeholder: '确认密码',
        otpMode: '验证码登录',
        pwMode: '密码登录',
        forgot: '忘记密码？',
        sendReset: '发送重置链接',
        resetSent: '重置链接已发送到 {email}，请查收邮箱。',
        backLogin: '返回登录',
        fail: '操作失败，请重试',
        badEmail: '请输入正确的邮箱地址',
        needEmailPw: '请输入邮箱和密码',
        needCodeFirst: '请先获取验证码',
        needCode: '请输入邮箱验证码',
        notRegistered: '该邮箱尚未注册，请切换到「注册」',
        needCodeReg: '请先获取邮箱验证码',
        pwShort: '密码至少 8 位',
        pwMismatch: '两次输入的密码不一致',
        alreadyUser: '该邮箱已注册，将直接登录',
        codeSent: '验证码已发送到邮箱，请查收',
        newUserPw: '该邮箱尚未注册，将引导你设置密码',
      },
      footer: {
        product: '实验室物品收纳管理系统',
        cloud: '数据云端同步（多设备可用）',
        local: '数据保存在本机',
      },
      app: {
        notFound: '页面不存在',
      },
    },
    en: {
      nav: {
        dashboard: 'Overview',
        studio: 'Storage',
        scan: 'Photo Intake',
        search: 'Search',
        stats: 'Stats',
        settings: 'Settings',
        sort: 'Reorder modules',
        sortTip: 'Drag a row or tap ▲▼ to fine-tune; the first one becomes your home page',
        sortDone: 'Done',
        moveUp: 'Move up',
        moveDown: 'Move down',
        sortReset: '↺ Reset to default order',
      },
      topbar: {
        brand: 'TidyLab · Lab Storage',
        searchPh: 'Search items — try "that blue voltage meter thing"…',
        localTime: 'Local time',
        weekPrefix: '',
        weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        toLight: 'Switch to light theme',
        toDark: 'Switch to dark theme',
      },
      set: {
        title: 'Settings',
        sub: 'AI provider · Backup & restore · Phone access',
        aiTitle: '🤖 AI Recognition',
        provider: 'Provider',
        glmOpt: 'Zhipu GLM-4V-Flash (free, recommended)',
        qwenOpt: 'Alibaba Qwen-VL',
        glmKey: 'Zhipu API Key',
        qwenKey: 'Qwen API Key',
        savedAs: 'Saved: ',
        notSet: 'Not set',
        glmModel: 'GLM model',
        qwenModel: 'Qwen model',
        save: 'Save settings',
        testAi: 'Test AI connection',
        phoneTitle: '📱 Phone access (same Wi-Fi required)',
        noLan: 'No LAN address detected (offline, or local access only)',
        backupTitle: '💾 Backup & Restore',
        backupNow: 'Back up now',
        backupNote: 'Auto-backup on every launch; the latest 10 are kept',
        restore: 'Restore',
        restoreConfirm: 'Restore data from "{file}"? Current data will be saved as an emergency backup first, and a restart is required afterwards.',
        restored: '✅ Restored {restored} (emergency backup: {eb}). Please close this page and start the app again.',
        noBackups: 'No backups yet',
        cloudTitle: '☁️ Cloud data',
        cloudNote: 'Data is hosted by the cloud database & file storage and synced across devices with your account — no local backup needed.',
        langTitle: 'Language / 语言',
        langNote: 'Switch the interface language. Takes effect immediately',
        saved: '✅ Settings saved',
        aiOk: '✅ AI connection OK: ',
        backedUp: '✅ Backed up: ',
      },
      auth: {
        brand: 'TidyLab · Lab Storage',
        subtitle: 'Sign in to sync your storage data and desktop pet',
        login: 'Sign in',
        register: 'Sign up',
        doLogin: 'Sign in',
        doRegister: 'Sign up',
        email: 'Email',
        regEmail: 'Email used for sign-up',
        password: 'Password',
        code: 'Email verification code',
        getCode: 'Get code',
        pwPlaceholder: 'Set a password (min 8 characters)',
        pw2Placeholder: 'Confirm password',
        otpMode: 'Code login',
        pwMode: 'Password login',
        forgot: 'Forgot password?',
        sendReset: 'Send reset link',
        resetSent: 'Reset link sent to {email}. Please check your inbox.',
        backLogin: 'Back to sign in',
        fail: 'Operation failed, please try again',
        badEmail: 'Please enter a valid email address',
        needEmailPw: 'Please enter your email and password',
        needCodeFirst: 'Please request a code first',
        needCode: 'Please enter the email verification code',
        notRegistered: 'This email is not registered yet — please switch to "Sign up"',
        needCodeReg: 'Please request the verification code first',
        pwShort: 'Password must be at least 8 characters',
        pwMismatch: 'The two passwords do not match',
        alreadyUser: 'Email already registered — signing you in directly',
        codeSent: 'Verification code sent — please check your inbox',
        newUserPw: 'Email not registered yet — you will be guided to set a password',
      },
      footer: {
        product: 'Lab Item Storage Management',
        cloud: 'Data synced via cloud (multi-device)',
        local: 'Data stored on this device',
      },
      app: {
        notFound: 'Page not found',
      },
    },
  };

  const LANGS = ['zh', 'en'];
  const STORE_KEY = 'tidy-lang';

  // 语言偏好探测：localStorage 已保存 > 浏览器语言（en* → 英文）> 默认中文
  function detect() {
    try {
      if (root.localStorage) {
        const s = root.localStorage.getItem(STORE_KEY);
        if (s && LANGS.includes(s)) return s;
      }
    } catch (e) { /* 隐私模式等读取失败时忽略 */ }
    try {
      const nav = root.navigator;
      const langs = (nav && nav.languages && nav.languages.length) ? nav.languages
        : (nav && nav.language ? [nav.language] : []);
      for (const l of langs) if (/^en/i.test(String(l))) return 'en';
    } catch (e) { /* 忽略 */ }
    return 'zh';
  }

  // Vue 存在时用 reactive（模板里的 t() 可随语言切换自动重渲染）；Node 测试环境退化为普通对象
  const reactive = (root.Vue && typeof root.Vue.reactive === 'function') ? root.Vue.reactive : (o) => o;
  const state = reactive({ lang: detect() });

  function lookup(lang, key) {
    const dict = DICT[lang];
    if (!dict) return undefined;
    return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
  }

  function t(key, vars) {
    let v = lookup(state.lang, key);
    if (v === undefined) v = lookup('zh', key);   // 缺翻译时回落中文
    if (v === undefined) return key;              // 仍缺失则显示 key，便于发现漏项
    if (typeof v === 'string' && vars) {
      v = v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
    }
    return v;
  }

  function getLang() { return state.lang; }

  function setLang(lang) {
    if (!LANGS.includes(lang)) return state.lang;   // 非法值直接忽略
    state.lang = lang;
    try { if (root.localStorage) root.localStorage.setItem(STORE_KEY, lang); } catch (e) { /* 忽略 */ }
    try {
      if (root.document && root.document.documentElement) {
        root.document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
      }
    } catch (e) { /* 忽略 */ }
    return state.lang;
  }

  const api = { DICT, LANGS, t, getLang, setLang };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node 测试用
  root.TidyI18n = api;
  root.t = api.t;
  root.getLang = api.getLang;
  root.setLang = api.setLang;
})(typeof window !== 'undefined' ? window : globalThis);
