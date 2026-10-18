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

window.store = Vue.reactive({
  detailItemId: null,
  dataVersion: 0,
  // 图片签名版本号：只有"图片地址换了"时才 +1（只触发重渲染，不触发重新拉数据）。
  // 早期签名成功也去 +1 dataVersion，导致每个页面都要再拉一遍全量数据，
  // 手机上白跑一趟网络与渲染（打开慢、发烫的来源之一）。
  imgVersion: 0,
  // 正在进行的请求数（>0 时顶栏显示一条进度条）。
  // 手机上网络慢的时候，界面看着"没反应"多半是请求还在路上——给个明确的进行中提示。
  pending: 0,
  authRequired: false,
  mode: 'local',
  // ---- 空间（仅云端模式有意义）：个人空间 / 实验室共享空间 ----
  space: { type: 'personal', labId: null },
  defaultSpace: null,  // 「打开网站时默认进入的空间」（未设置时为 null）
  labs: [],        // 当前账号可访问的实验室列表
  myName: '',      // 当前账号昵称（实验室成员显示用）
  notice: '',      // 启动时的一次性提示（如"已加入实验室"）
  joinError: '',   // 邀请链接加入失败原因
});

/* ---------------- GET 缓存 + 请求合并 ----------------
 * 为什么要有：切换模块时组件会卸载重建，每次都重新拉一遍同样的数据。
 * 手机上（尤其云端）每个请求 200~800ms，来回切几次就要等好几秒，
 * 看起来像"点了没反应 / 刷新不出来"。
 *
 * 策略：
 *   · GET 结果缓存 shortTTL，过期即作废；命中直接返回（深拷贝，避免两个页面改同一份对象）。
 *   · 同一路径正在请求中 → 复用同一个 Promise（连点两次导航不会发两遍）。
 *   · 任何写操作（POST/PATCH/PUT/DELETE）成功 → 全清缓存，保证改完立刻看到新数据。
 *   · 缓存按空间隔离：个人空间和实验室的数据不能串（key 里带 space 标识）。
 */
const GET_TTL_DEFAULT = 15000;
// 结构 / 元数据这类"极少变、但每个页面都要用"的接口给更长的有效期
const GET_TTL_BY_PATH = [
  [/^\/stats\/meta/, 60000],
  [/^\/structure$/, 30000],
  [/^\/settings$/, 60000],
  [/^\/system\/info$/, 60000],
];
const getCache = new Map();     // key -> { v, exp }
const getInflight = new Map();  // key -> Promise

function spaceKey() {
  const s = window.store.space || {};
  return s.type === 'lab' && s.labId ? 'lab:' + s.labId : 'personal';
}
function ttlFor(path) {
  for (const [re, ttl] of GET_TTL_BY_PATH) if (re.test(path)) return ttl;
  return GET_TTL_DEFAULT;
}
function clone(v) {
  // 数据都是 JSON 结构；structuredClone 比 JSON 往返快，且保留 null/数组形态
  try { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
  catch { return v; }   // 含不可克隆对象时退回原引用，宁可不缓存也不报错
}
window.__clearApiCache = function () { getCache.clear(); getInflight.clear(); };

async function rawApi(method, path, body) {
  if (window.store.mode === 'cloud' && window.__cloudApi) {
    const data = await window.__cloudApi.api(method, path, body);
    // 响应里可能带云存储 key → 批量签名后通知界面重渲染图片（只刷图片，不重拉数据）
    try {
      const resolved = await window.__cloudApi.resolveImages(data);
      if (resolved) window.store.imgVersion++;
    } catch { /* 签名失败不阻塞数据展示 */ }
    return data;
  }
  return window.__localApi(method, path, body);
}

window.api = async function (method, path, body) {
  const m = String(method || 'GET').toUpperCase();
  const isGet = m === 'GET';

  if (!isGet) {
    // 写操作：先做，成功后清缓存（先清也行，宁可多拉一次也不要看到旧数据）
    const r = await rawApi(m, path, body);
    window.__clearApiCache();
    return r;
  }

  const key = spaceKey() + ' ' + path;
  const hit = getCache.get(key);
  if (hit && hit.exp > Date.now()) return clone(hit.v);
  if (hit) getCache.delete(key);

  const running = getInflight.get(key);
  if (running) return clone(await running);

  window.store.pending++;
  const job = rawApi(m, path, body).then((v) => {
    // 只缓存纯 JSON 结果（FormData 上传等不缓存）
    try {
      // 上限 60 条：搜索这类路径带参数的请求会不断产生新 key，别让缓存无限涨
      if (getCache.size >= 60) getCache.delete(getCache.keys().next().value);
      getCache.set(key, { v: clone(v), exp: Date.now() + ttlFor(path) });
    } catch { /* 忽略 */ }
    return v;
  }).finally(() => {
    getInflight.delete(key);
    window.store.pending = Math.max(0, window.store.pending - 1);
  });
  getInflight.set(key, job);
  try { return await job; } finally { /* pending 已在 finally 里回退 */ }
};


// 当前空间显示名（顶栏 / 实验室页共用）
window.spaceLabel = function () {
  const s = window.store.space || {};
  if (s.type === 'lab' && s.labId) {
    const lab = (window.store.labs || []).find((l) => Number(l.id) === Number(s.labId));
    return lab ? lab.name : (window.t ? window.t('lab.unknown') : '实验室');
  }
  return window.t ? window.t('lab.personal') : '个人空间';
};

// 1x1 透明图：签名 URL 还没就绪时先占位，避免出现"碎图标"，也避免 img 反复请求空地址
const IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 批量补签：把渲染过程中发现"没签过/已过期"的 key 收集起来，合并成一次请求
let imgPending = new Set();
let imgTimer = null;
window.__imgEnsure = function (key) {
  if (!key || !window.__cloudApi || !window.__cloudApi.resolveImages) return;
  imgPending.add(key);
  if (imgTimer) return;
  imgTimer = setTimeout(async () => {
    imgTimer = null;
    const keys = [...imgPending];
    imgPending = new Set();
    try {
      // 只有真正拿到新 URL 才触发刷新，避免"刷新→再签→再刷新"的死循环
      if (await window.__cloudApi.resolveImages(keys)) window.store.imgVersion++;
    } catch { /* 补签失败不阻塞渲染 */ }
  }, 60);
};

// 图片地址。第二个参数是「需要多宽的图」（逻辑像素的 2 倍足够，屏幕再高也看不出差别）：
//   · 不传 → 原图（详情全屏、灯箱、下载原图用）
//   · 传 w → 服务端按需生成缩略图并落盘缓存
// 关键：<img> 是按「图片原始像素」解码的，一张 1706×1279 的实拍图解码占 8.7MB 内存，
// 而列表里的小图只有 17~40px。实测 84 件物品不加缩略图要吃掉 ~780MB 图像内存，
// 手机端滚动会持续触发内存回收与纹理重传 —— 这是发烫、掉帧最主要的来源。
window.imgSrc = function (f, w) {
  // 读一下 imgVersion：签名完成后让用到图片的模板自动重渲染（无需整页重拉数据）
  void window.store.imgVersion;
  if (!f) return '';
  if (/^(?:https?|data|blob):/i.test(f)) return f;
  if (window.store.mode === 'cloud' && window.__cloudApi) {
    const hit = window.__cloudApi.imgCache.get(f);
    if (!hit) {
      window.__imgEnsure(f);
      return IMG_PLACEHOLDER;
    }
    // 过期了也先用旧地址顶着（后台正在换新），比直接空白体验好得多
    if (hit.exp <= Date.now()) window.__imgEnsure(f);
    return window.__imgTransform ? window.__imgTransform(hit.url, w) : hit.url;
  }
  return '/' + f + (w ? '?w=' + w : '');
};

// 云端存储的图片变换（Supabase render/image）：只改 URL，不额外发请求。
// 若当前云端套餐不支持变换，服务器会返回 4xx → 下面的全局兜底会关掉变换并回退原图，
// 保证"要么快、要么稳"，绝不会满屏破图。
let imgTransformOK = true;
window.__imgTransform = function (url, w) {
  if (!w || !imgTransformOK || !url) return url;
  if (!/\/storage\/v1\/object\/sign\//.test(url)) return url;
  const u = url.replace('/storage/v1/object/sign/', '/storage/v1/render/image/sign/');
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'width=' + w + '&quality=72&resize=contain';
};
if (typeof document !== 'undefined') {
  document.addEventListener('error', function (e) {
    const t = e.target;
    if (t && t.tagName === 'IMG' && imgTransformOK && /\/render\/image\/sign\//.test(t.src || '')) {
      imgTransformOK = false;      // 只降级一次
      window.store.imgVersion++;   // 让所有图片模板按原图地址重新渲染
    }
  }, true);
}

// ---- 上传前等比压缩（手机性能的关键一环）----
// 手机原图常见 3~5MB / 4000px，而实物图在列表里只占 17~140px。原图直接上传的后果：
// 上传慢、列表一次拉几十张要解码几亿像素（内存爆、滚动卡、手机发烫）。
// 这里统一缩到长边 1600 + JPEG 0.85，体积通常降到 1/5，肉眼看不出差别。
window.shrinkImage = function (file, opts) {
  const o = opts || {};
  const maxEdge = o.maxEdge || 1600;
  const quality = o.quality || 0.85;
  const maxBytes = o.maxBytes || 900 * 1024;
  if (!file || !/^image\//.test(file.type || '')) return Promise.resolve(file);
  if (/gif|svg/i.test(file.type)) return Promise.resolve(file);   // 动图/矢量不动
  if (typeof document === 'undefined') return Promise.resolve(file);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        const tooBig = Math.max(w, h) > maxEdge || file.size > maxBytes;
        if (!tooBig || !w || !h) { URL.revokeObjectURL(url); resolve(file); return; }
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => {
          URL.revokeObjectURL(url);
          if (!b) { resolve(file); return; }
          // 压完反而更大（本来就小、或已是高质量 JPEG）→ 用原图，别越压越糊
          if (b.size >= file.size * 0.95) { resolve(file); return; }
          const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
          try { resolve(new File([b], name, { type: 'image/jpeg', lastModified: Date.now() })); }
          catch { resolve(file); }
        }, 'image/jpeg', quality);
      } catch { URL.revokeObjectURL(url); resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
};
