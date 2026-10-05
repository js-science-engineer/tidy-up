// 识别服务：单物 / 批量（bbox）两种模式
const { extractJSON } = require('./promptUtil');
const { ApiError } = require('../util');

const CATEGORIES = ['电子元件', '开发板/模块', '仪器设备', '线材/连接件', '工具', '化学试剂', '耗材', '结构件/五金', '包装/收纳', '文档/资料', '其他'];

function buildPrompt(mode) {
  return [
    '你是实验室物品管理员。图中是用户拍摄的实物照片（可能是随手拍、白底图、屏幕翻拍或截图），请聚焦画面主体识别物品，只输出 JSON，不要任何多余文字。',
    '识别要点：优先看物品上的丝印/标签/铭牌/接口形状等可靠特征；拍歪、模糊、 partial 遮挡时按最可能的常见物品推断，但 confidence 要降低。',
    mode === 'batch'
      ? '图中可能有多件物品，请逐件给出 bbox（[x,y,w,h]，数值 0~1000 归一化）。'
      : '图中只有一件物品；若背景里有杂物，忽略杂物只认主体。',
    '输出格式：',
    '{"items":[{"name":"标准中文名称","aliases":["别名"],"category":"类别","size":"S|M|L","confidence":0.96' +
      (mode === 'batch' ? ',"bbox":[x,y,w,h]' : '') + '}],',
    '"webQuery":"适合搜索该实物图片的英文关键词"}',
    'name 用规范中文商品名（如"数字万用表"），不要把品牌型号当名字；category 必须且只能从以下选择（不确定时选"其他"）：' + CATEGORIES.join('|'),
    'size 按实物尺寸：S=手掌可握 / M=需双手或小箱 / L=大件。',
    '识别不了时 confidence 低于 0.5，name 填"未知物品"。',
  ].join('\n');
}

async function analyze(provider, { mode, imageBase64, mime }) {
  const call = (extraHint) => provider.chat({
    intent: 'recognize',
    system: '你是实验室物品识别助手，永远只输出合法 JSON。',
    user: buildPrompt(mode) + (extraHint ? `\n注意：${extraHint}` : '') +
      `\nINPUT: ${JSON.stringify({ mode })}`,
    imageBase64,
    mime,
  });
  let text;
  try {
    text = await call();
  } catch (e) {
    // AI 平台对不支持的图片格式报参数错误（如智谱 1210）：转成可操作的提示
    if (/1210|参数有误|image|format|media/i.test(String((e && e.message) || ''))) {
      throw new ApiError(400, '该图片格式 AI 暂不支持，请使用 JPG/PNG/WebP（在网页上传会自动转换）');
    }
    throw e;
  }
  let parsed;
  try {
    parsed = extractJSON(text);
  } catch (e) {
    text = await call('上次输出不是合法 JSON，请只输出 JSON 本体。');
    parsed = extractJSON(text); // 再失败则抛错 → 明确错误提示（验收 C6）
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (!items.length) throw new ApiError(502, 'AI 未识别出任何物品，请重试或更换图片');
  return {
    mode,
    items: items.map((it) => ({
      name: String(it.name || '未知物品').slice(0, 80),
      aliases: Array.isArray(it.aliases) ? it.aliases.map(String).slice(0, 5) : [],
      // 类别白名单：AI 给出列表外的类别时回落"其他"，保证分区建议与入库分类正确
      category: CATEGORIES.includes(it.category) ? it.category : '其他',
      size: ['S', 'M', 'L'].includes(it.size) ? it.size : 'S',
      confidence: Math.min(1, Math.max(0, Number(it.confidence) || 0.5)),
      bbox: Array.isArray(it.bbox) ? it.bbox.map(Number) : null,
    })),
    webQuery: String(parsed.webQuery || ''),
  };
}

module.exports = { analyze };
