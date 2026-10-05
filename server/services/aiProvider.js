// AI 供应商抽象：GLM / Qwen（OpenAI 兼容）+ mock（自动化测试）。切换只改配置，不改代码。
const cfgMod = require('../config');
const { ApiError } = require('../util');

function currentProvider() {
  const cfg = cfgMod.load();
  const conf = cfg.provider === 'qwen' ? cfg.qwen : cfg.provider === 'mock' ? null : cfg.glm;
  if (cfg.provider === 'mock') return mockProvider();
  return openaiCompat(conf, cfg.provider);
}

// ---- OpenAI 兼容实现（GLM-4V-Flash / Qwen-VL 通用） ----
function openaiCompat(conf, name) {
  return {
    name,
    async chat({ system = '', user = '', imageBase64 = null, mime = 'image/jpeg' }) {
      if (!conf.key) throw new ApiError(400, `未配置 ${name} 的 API Key，请到「设置」页填写`);
      let content;
      if (imageBase64) {
        content = [
          { type: 'text', text: user },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
        ];
      } else {
        content = user;
      }
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content });
      let r;
      try {
        r = await fetch(conf.baseURL.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conf.key}` },
          body: JSON.stringify({ model: conf.model, messages, temperature: 0.2 }),
          signal: AbortSignal.timeout(90000), // 免费模型偶发排队，90s 上限
        });
      } catch (e) {
        if (e.name === 'TimeoutError') throw new ApiError(504, 'AI 响应超时（90 秒），请重试或换一张更清晰的图片');
        throw new ApiError(502, '无法连接 AI 服务，请检查网络：' + e.message);
      }
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new ApiError(502, `AI 接口错误 ${r.status}: ${t.slice(0, 200)}`);
      }
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content;
      if (!text) throw new ApiError(502, 'AI 返回内容为空');
      return text;
    },
  };
}

// ---- Mock 实现（自动化测试用；确定性输出，按 INPUT 行解析指令） ----
function mockProvider() {
  const parseInput = (s) => {
    const m = s && s.match(/INPUT:\s*(\{[\s\S]*\})\s*$/);
    return m ? JSON.parse(m[1]) : {};
  };
  const SINGLE = [
    { name: 'STM32F103C8T6 最小系统板', aliases: ['Blue Pill 开发板', 'ARM Cortex-M3 板'], category: '开发板/模块', size: 'S', confidence: 0.96 },
  ];
  const BATCH = [
    { name: 'STM32F103C8T6 最小系统板', aliases: ['Blue Pill 开发板'], category: '开发板/模块', size: 'S', confidence: 0.95, bbox: [10, 10, 200, 150] },
    { name: '杜邦线（公对母）', aliases: ['跳线'], category: '线材/连接件', size: 'S', confidence: 0.9, bbox: [220, 10, 200, 150] },
    { name: '面包板 400 孔', aliases: ['面包板'], category: '电子元件', size: 'M', confidence: 0.88, bbox: [430, 10, 200, 150] },
  ];
  const provider = {
    name: 'mock',
    async chat({ intent = '', user = '' }) {
      const input = parseInput(user);
      if (intent === 'recognize') {
        return JSON.stringify({
          items: input.mode === 'batch' ? BATCH : SINGLE,
          webQuery: 'stm32 board',
        });
      }
      if (intent === 'structure') {
        return JSON.stringify(require('./structureGen').parseStructureText(input.text || ''));
      }
      if (intent === 'semantic') {
        const { query = '', items = [] } = input;
        const q = String(query);
        const matches = items
          .map((i) => {
            let score = 0;
            const terms = [i.name, ...(i.aliases || [])].filter(Boolean);
            for (const term of terms) {
              if (term && (term.includes(q) || q.includes(term.slice(0, 2)))) score = Math.max(score, 0.9);
            }
            return { id: i.id, score, reason: 'mock 语义匹配' };
          })
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        return JSON.stringify({ matches });
      }
      if (intent === 'webimage') return JSON.stringify({ images: ['https://example.com/stm32-1.jpg', 'https://example.com/stm32-2.jpg'] });
      throw new ApiError(500, 'mock: 未知 intent ' + intent);
    },
  };
  return provider;
}

module.exports = { currentProvider };
