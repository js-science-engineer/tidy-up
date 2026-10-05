// 联网匹配实物图片：必应图片搜索（免费、国内直连、不耗 token），失败自动降级为空数组
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

// 抓取必应图片搜索结果页，提取原始图片 URL（murl 字段）
async function searchImages(query, { limit = 4, timeout = 6000 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = 'https://cn.bing.com/images/search?q=' + encodeURIComponent(q) + '&form=HDRSC2&first=1';
  const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) return [];
  const html = await r.text();
  const urls = [];
  const re = /murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g;
  let m;
  while ((m = re.exec(html)) && urls.length < limit) {
    const u = m[1].replace(/\\u002f/gi, '/');
    if (!urls.includes(u)) urls.push(u);
  }
  return urls;
}

// 兼容旧接口：识别结果里的 webQuery → 图片列表（尽力而为）
async function findWebImages(provider, webQuery) {
  try {
    return await searchImages(webQuery, { limit: 3 });
  } catch {
    return []; // 降级：无网络配图，UI 用用户上传的照片兜底
  }
}

module.exports = { searchImages, findWebImages };
