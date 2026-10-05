// 设置：供应商/Key（打码）/主题/端口 + AI 连通性测试
const express = require('express');
const cfgMod = require('../config');
const { ok, wrap, ApiError } = require('../util');
const { currentProvider } = require('../services/aiProvider');

const router = express.Router();

router.get('/', (req, res) => ok(res, cfgMod.publicView(cfgMod.load())));

router.put('/', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.provider !== undefined) {
    if (!['glm', 'qwen', 'mock'].includes(b.provider)) throw new ApiError(400, 'provider 必须是 glm/qwen/mock');
    patch.provider = b.provider;
  }
  if (b.theme !== undefined) patch.theme = b.theme === 'light' ? 'light' : 'dark';
  if (b.port !== undefined) {
    const p = Number(b.port);
    if (!p || p < 1024 || p > 65535) throw new ApiError(400, '端口不合法（1024~65535）');
    patch.port = p;
  }
  // Key 处理：打码值（含 ****）不覆盖真实 Key
  if (b.glm && typeof b.glm.key === 'string' && !b.glm.key.includes('****')) patch.glm = { key: b.glm.key.trim() };
  if (b.qwen && typeof b.qwen.key === 'string' && !b.qwen.key.includes('****')) patch.qwen = { key: b.qwen.key.trim() };
  if (b.glm && b.glm.model) patch.glm = { ...(patch.glm || {}), model: String(b.glm.model) };
  if (b.qwen && b.qwen.model) patch.qwen = { ...(patch.qwen || {}), model: String(b.qwen.model) };
  const next = cfgMod.save(patch);
  ok(res, cfgMod.publicView(next));
}));

router.post('/test-ai', wrap(async (req, res) => {
  const provider = currentProvider();
  try {
    const text = await provider.chat({
      intent: 'ping',
      system: '回复 OK 两个字母即可。',
      user: 'ping',
    });
    ok(res, { reply: String(text).slice(0, 50) });
  } catch (e) {
    throw new ApiError(e.status || 502, e.message);
  }
}));

module.exports = router;
