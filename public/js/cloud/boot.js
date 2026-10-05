// 启动引导：探测本地/云端模式；云端模式检查登录会话
// 本地模式行为与旧版完全一致；云端模式未登录时 store.authRequired=true，由根组件切换到登录页
(function () {
  async function startCloud(session) {
    window.TIDY_UID = session.user.id;
    const capi = window.CloudApi.createCloudApi({
      cloud: window.__cloudClient,
      uid: session.user.id,
      serverFetch: window.__localApi,
    });
    window.__cloudApi = capi;
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
