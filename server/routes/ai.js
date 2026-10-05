// 云端模式辅助 AI 路由：无库依赖的纯 AI 端点（供前端云适配器调用）
// 语义搜索：候选物品由前端传入（云端数据经 RLS 由前端持有），服务端只做 LLM 推测排序。
const express = require('express');
const { ok, wrap, ApiError } = require('../util');
const { extractJSON } = require('../services/promptUtil');
const { currentProvider } = require('../services/aiProvider');

const router = express.Router();

// 轻量限流：每 IP 每分钟 30 次（防公网滥用用户配置的 AI 额度）
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const win = hits.get(ip) || [];
  const alive = win.filter((t) => now - t < 60000);
  if (alive.length >= 30) return res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' });
  alive.push(now);
  hits.set(ip, alive);
  next();
}
router.use(rateLimit);

router.post('/semantic-search', wrap(async (req, res) => {
  const q = String((req.body || {}).query || '').trim();
  const candidates = Array.isArray((req.body || {}).candidates) ? req.body.candidates : [];
  if (!q) throw new ApiError(400, '请输入搜索内容');
  if (!candidates.length) return ok(res, { matches: [] });
  const provider = currentProvider();
  const raw = await provider.chat({
    intent: 'semantic',
    system: '你是物品搜索助手，根据用户的模糊描述推测用户可能指的物品，只输出合法 JSON。',
    user: [
      '根据用户描述从候选物品中选出可能匹配的，按匹配度(0~1)排序，最多 5 条，只输出 JSON：',
      '{"matches":[{"id":1,"score":0.9,"reason":"一句话理由"}]}',
      `候选物品：${JSON.stringify(candidates.map((i) => ({ id: i.id, name: i.name, aliases: i.aliases, category: i.category })))}`,
      `用户描述：${q}`,
      `INPUT: ${JSON.stringify({ query: q, items: candidates.map((i) => ({ id: i.id, name: i.name, aliases: i.aliases })) })}`,
    ].join('\n'),
  });
  const parsed = extractJSON(raw);
  const byId = new Map(candidates.map((i) => [Number(i.id), i]));
  const matches = (parsed.matches || [])
    .filter((m) => byId.has(Number(m.id)))
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, 5)
    .map((m) => ({ id: Number(m.id), score: Number(m.score), reason: m.reason || '' }));
  ok(res, { matches });
}));

module.exports = router;
