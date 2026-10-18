// 启动引导：探测本地/云端模式；云端模式检查登录会话，并确定"当前空间"（个人空间 / 实验室共享空间）
// 本地模式行为与旧版完全一致；云端模式未登录时 store.authRequired=true，由根组件切换到登录页
(function () {
  const spaceKey = (uid) => 'tidy-space:' + uid;
  const defaultKey = (uid) => 'tidy-space-default:' + uid;

  function normSpace(s) {
    return (s && s.type === 'lab' && s.labId)
      ? { type: 'lab', labId: Number(s.labId) }
      : { type: 'personal', labId: null };
  }
  function readSavedSpace(uid) {
    try {
      const raw = localStorage.getItem(spaceKey(uid));
      if (!raw) return null;
      return normSpace(JSON.parse(raw));
    } catch { return null; }
  }
  function readDefaultSpace(uid) {
    try {
      const raw = localStorage.getItem(defaultKey(uid));
      if (!raw) return null;
      return normSpace(JSON.parse(raw));
    } catch { return null; }
  }
  function persistSpace(uid, s) {
    try { localStorage.setItem(spaceKey(uid), JSON.stringify(s)); } catch { /* 隐私模式等写入失败时忽略 */ }
  }

  // 设为「打开网站时的默认空间」。null / {type:'personal'} 之外的语义由调用方决定。
  window.__tidySetDefaultSpace = function (s) {
    const uid = window.TIDY_UID;
    const next = s ? normSpace(s) : null;
    try {
      if (next) localStorage.setItem(defaultKey(uid), JSON.stringify(next));
      else localStorage.removeItem(defaultKey(uid));
    } catch { /* 忽略 */ }
    window.TIDY_DEFAULT_SPACE = next;
    window.store.defaultSpace = next;
    return next;
  };
  window.__tidyGetDefaultSpace = function () { return readDefaultSpace(window.TIDY_UID); };

  // 切换当前空间：写 store + 通知云适配层 + 触发全界面重新拉取（数据源整体换了一份）
  window.__tidySetSpace = function (s) {
    const next = normSpace(s);
    if (window.__cloudApi && window.__cloudApi.setSpace) window.__cloudApi.setSpace(next);
    window.store.space = next;
    if (window.TIDY_UID) persistSpace(window.TIDY_UID, next);
    window.TIDY_SPACE = next;
    window.store.dataVersion++;
    return next;
  };

  // 邀请链接：?join=CODE（兼容 ?invite=CODE）→ 登录后自动加入实验室
  // 参数只消费一次，立刻从地址栏摘掉，避免刷新后重复加入
  function takeJoinCode() {
    try {
      const u = new URL(location.href);
      const code = (u.searchParams.get('join') || u.searchParams.get('invite') || '').trim();
      if (!code) return '';
      u.searchParams.delete('join');
      u.searchParams.delete('invite');
      const qs = u.searchParams.toString();
      history.replaceState(null, '', u.pathname + (qs ? '?' + qs : '') + u.hash);
      return code;
    } catch { return ''; }
  }

  async function refreshLabs() {
    try {
      const labs = await window.__cloudApi.api('GET', '/labs');
      window.store.labs = Array.isArray(labs) ? labs : [];
    } catch { window.store.labs = []; }
    return window.store.labs;
  }
  window.__tidyRefreshLabs = refreshLabs;

  async function startCloud(session) {
    const uid = session.user.id;
    window.TIDY_UID = uid;
    const capi = window.CloudApi.createCloudApi({
      cloud: window.__cloudClient,
      uid,
      serverFetch: window.__localApi,
    });
    window.__cloudApi = capi;
    window.store.myName = (session.user && session.user.name) || '';

    // 默认个人空间（避免在确定空间前发出任何数据请求）
    window.__tidySetSpace({ type: 'personal', labId: null });

    // 邀请链接优先：先把人拉进实验室，再决定落在哪个空间
    const code = takeJoinCode();
    let joined = false;
    if (code) {
      try {
        const lab = await capi.api('POST', '/labs/join', { code, displayName: window.store.myName });
        joined = true;
        window.store.notice = t('lab.joined', { name: lab.name });
        window.__tidySetSpace({ type: 'lab', labId: lab.id });
      } catch (e) {
        window.store.joinError = (e && e.message) ? e.message : t('lab.joinFail');
      }
    }

    const labs = await refreshLabs();

    // 非邀请进入：优先用「设为默认」的空间，其次恢复上次所在的空间
    if (!joined) {
      const def = readDefaultSpace(uid);
      const saved = readSavedSpace(uid);
      const target = def || saved;
      if (target && target.type === 'lab') window.__tidySetSpace(target);
      window.TIDY_DEFAULT_SPACE = def;
      window.store.defaultSpace = def;
    }
    // 兜底：保存/默认的实验室已不存在 / 已被移出 → 回到个人空间，并清掉失效的默认设置
    const cur = window.store.space || {};
    if (cur.type === 'lab' && !labs.some((l) => Number(l.id) === Number(cur.labId))) {
      window.__tidySetSpace({ type: 'personal', labId: null });
      const def = window.store.defaultSpace;
      if (def && def.type === 'lab' && Number(def.labId) === Number(cur.labId)) window.__tidySetDefaultSpace(null);
    }

    window.store.authRequired = false;
  }
  window.__tidyStartCloud = startCloud;

  window.__tidyBoot = (async function () {
    let info = null;
    try {
      const r = await fetch('/api/system/info');
      const j = await r.json();
      if (j && j.ok) info = j.data;
    } catch { /* 服务未起 → 本地模式兜底 */ }

    if (!info || !info.cloud) {
      window.store.mode = 'local';
      window.TIDY_UID = 'local';
      window.store.space = { type: 'personal', labId: null };
      return;
    }

    // 云模式：初始化 SDK（endpoint/publishableKey 来自服务端持有的 publicConfig）
    window.store.mode = 'cloud';
    if (typeof WorkBuddyCloud === 'undefined') {
      window.store.authRequired = true;
      window.__cloudInitError = '云端组件加载失败，请检查网络后刷新';
      return;
    }
    window.__cloudClient = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: info.cloud.endpoint,
      publishableKey: info.cloud.publishableKey,
    });
    try {
      const { data: session } = await window.__cloudClient.auth.getSession();
      if (!session) { window.store.authRequired = true; return; }
      await startCloud(session);
    } catch (e) {
      window.store.authRequired = true;
      window.__cloudInitError = e && e.message ? e.message : '登录状态检查失败';
    }
  })();
})();
