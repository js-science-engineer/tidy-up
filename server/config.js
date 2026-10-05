// 配置：API Key、供应商、端口、主题（存 data/config.json，永不下发明文 Key）
const path = require('path');
const fs = require('fs');
const { CONFIG_FILE, DATA_DIR } = require('./paths');

const DEFAULTS = {
  provider: 'glm', // glm | qwen | mock（mock 仅供自动化测试）
  port: 5175,
  theme: 'dark',
  glm: {
    key: '',
    model: 'glm-4v-flash',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  },
  qwen: {
    key: '',
    model: 'qwen-vl-plus',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return deepMerge(structuredClone(DEFAULTS), raw);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(patch) {
  const next = deepMerge(load(), patch || {});
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function deepMerge(base, patch) {
  for (const k of Object.keys(patch)) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && base[k] && typeof base[k] === 'object') {
      deepMerge(base[k], patch[k]);
    } else {
      base[k] = patch[k];
    }
  }
  return base;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// 对外展示用：Key 一律打码
function publicView(cfg) {
  const v = structuredClone(cfg);
  v.glm.key = maskKey(v.glm.key);
  v.qwen.key = maskKey(v.qwen.key);
  v._hasGlmKey = !!cfg.glm.key;
  v._hasQwenKey = !!cfg.qwen.key;
  return v;
}

module.exports = { load, save, publicView, maskKey, CONFIG_FILE };
