// JSON 提取与提示词工具
function extractJSON(text) {
  if (!text) throw new Error('AI 返回为空');
  let t = String(text).trim();
  t = t.replace(/```(json)?/gi, '```');
  const fence = t.indexOf('```');
  if (fence >= 0) {
    const end = t.indexOf('```', fence + 3);
    if (end > fence) t = t.slice(fence + 3, end);
  }
  const start = t.indexOf('{');
  const end2 = t.lastIndexOf('}');
  if (start < 0 || end2 <= start) throw new Error('AI 输出中未找到 JSON：' + String(text).slice(0, 120));
  return JSON.parse(t.slice(start, end2 + 1));
}

const PRESET_CATEGORIES = ['电子元件','开发板/模块','仪器设备','线材/连接件','工具','化学试剂','耗材','结构件/五金','包装/收纳','文档/资料','其他'];

module.exports = { extractJSON, PRESET_CATEGORIES };
