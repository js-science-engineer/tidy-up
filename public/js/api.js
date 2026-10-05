// 统一 API 封装 + 全局轻状态
// 本地模式：fetch Express REST（原行为不变）
// 云端模式：window.__cloudApi 接管业务端点（PostgREST + 云存储 + RLS 隔离）
window.__localApi = async function (method, path, body) {
  const opt = { method };
  if (body instanceof FormData) {
    opt.body = body;
  } else if (body !== undefined) {
    opt.headers = { 'Content-Type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  const r = await fetch('/api' + path, opt);
  let j;
  try { j = await r.json(); } catch { throw new Error('服务响应异常（HTTP ' + r.status + '）'); }
  if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j.data;
};

window.store = Vue.reactive({ detailItemId: null, dataVersion: 0, authRequired: false, mode: 'local' });

window.api = async function (method, path, body) {
  if (window.store.mode === 'cloud' && window.__cloudApi) {
    const data = await window.__cloudApi.api(method, path, body);
    // 响应里可能带云存储 key → 批量签名后触发界面刷新（一次性，缓存后不再触发）
    try {
      const resolved = await window.__cloudApi.resolveImages(data);
      if (resolved) window.store.dataVersion++;
    } catch { /* 签名失败不阻塞数据展示 */ }
    return data;
  }
  return window.__localApi(method, path, body);
};

window.imgSrc = function (f) {
  if (!f) return '';
  if (/^https?:\/\//.test(f)) return f;
  if (window.store.mode === 'cloud' && window.__cloudApi) {
    const hit = window.__cloudApi.imgCache.get(f);
    return hit && hit.exp > Date.now() ? hit.url : '';
  }
  return '/' + f;
};
