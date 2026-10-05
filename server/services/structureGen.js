// AI 对话生成收纳结构：解析自然语言 → 区域/楼层/柜子结构（预览不入库）
const { extractJSON } = require('./promptUtil');
const { ApiError } = require('../util');

// 真实 AI 提示词
function buildPrompt(text) {
  return [
    '根据用户的描述生成收纳柜体结构，只输出 JSON，不要多余文字。',
    '结构规则：一个 zone（区域）下分 floors（楼层），每层 floor 下有 cabinets（柜子，含门型 door：double=双开门/single=单开门/drawer=抽屉），每个柜子默认带 1 个格位 shelf。',
    '输出格式：',
    '{"zoneName":"区域一","floors":[{"floor":1,"cabinets":[{"name":"1号柜","door":"double","shelves":[{"name":"格位1","kind":"shelf"}]}]}]}',
    `用户描述：${text}`,
  ].join('\n');
}

// Mock/兜底用的确定性解析器（覆盖 PRD B1 例句句式）
function parseStructureText(text) {
  const t = String(text || '');
  const cn = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  const toNum = (s) => (/\d/.test(s) ? parseInt(s, 10) : (cn[s] || parseInt(s, 10) || 1));

  const zoneMatch = t.match(/「([^」]+)」/) || t.match(/区域名[称是为：:]\s*([^\s，。,]+)/);
  let zoneCounter = 1;

  // 逐层描述：第X层……N个柜子……
  const floorSegs = [...t.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*层\s*([^。；;]*)/g)];
  const floors = [];
  for (const seg of floorSegs) {
    const floorNo = toNum(seg[1]);
    const body = seg[2];
    const totalM = body.match(/(\d+)\s*个?柜[子门]?/);
    const total = totalM ? parseInt(totalM[1], 10) : 0;
    if (!total) continue;
    let doubles = 0, singles = 0, drawers = 0;
    const dm = body.match(/(\d+)\s*个?双开门/);
    const sm = body.match(/(\d+)\s*个?单开门/);
    const dr = body.match(/(\d+)\s*个?抽屉/);
    if (/都是双开门|全是双开门|均为双开门/.test(body)) doubles = total;
    else if (/都是单开门|全是单开门/.test(body)) singles = total;
    else if (/都是抽屉|全是抽屉/.test(body)) drawers = total;
    else {
      doubles = dm ? parseInt(dm[1], 10) : 0;
      singles = sm ? parseInt(sm[1], 10) : 0;
      drawers = dr ? parseInt(dr[1], 10) : 0;
      if (doubles + singles + drawers < total) singles += total - (doubles + singles + drawers);
    }
    const cabinets = [];
    let n = 1;
    for (let i = 0; i < doubles; i++) cabinets.push({ name: `${n++}号柜`, door: 'double', shelves: [{ name: '格位1', kind: 'shelf' }] });
    for (let i = 0; i < singles; i++) cabinets.push({ name: `${n++}号柜`, door: 'single', shelves: [{ name: '格位1', kind: 'shelf' }] });
    for (let i = 0; i < drawers; i++) cabinets.push({ name: `${n++}号柜`, door: 'drawer', shelves: [{ name: '格位1', kind: 'drawer' }] });
    floors.push({ floor: floorNo, cabinets });
  }

  if (!floors.length) {
    // 兜底：只说"N个柜子"
    const m = t.match(/(\d+)\s*个?柜[子门]?/);
    if (m) {
      const total = parseInt(m[1], 10);
      const cabinets = [];
      for (let i = 0; i < total; i++) cabinets.push({ name: `${i + 1}号柜`, door: 'single', shelves: [{ name: '格位1', kind: 'shelf' }] });
      floors.push({ floor: 1, cabinets });
    }
  }
  if (!floors.length) throw new ApiError(400, '无法理解该描述。示例：两层。第一层 5 个柜子：1 个双开门 + 4 个单开门。第二层 3 个柜子，都是双开门。');

  floors.sort((a, b) => a.floor - b.floor);
  let n = 1;
  for (const f of floors) for (const c of f.cabinets) c.name = `${n++}号柜`;
  return {
    zoneName: zoneMatch ? zoneMatch[1] : `区域${['一','二','三','四','五','六','七','八','九','十'][zoneCounter - 1] || zoneCounter}`,
    floors,
  };
}

async function generate(provider, text) {
  const raw = await provider.chat({
    intent: 'structure',
    system: '你是收纳结构生成器，永远只输出合法 JSON。',
    user: buildPrompt(text) + `\nINPUT: ${JSON.stringify({ text })}`,
  });
  const parsed = extractJSON(raw);
  // 归一化
  const floors = (parsed.floors || []).map((f) => ({
    floor: Number(f.floor) || 1,
    cabinets: (f.cabinets || []).map((c) => ({
      name: String(c.name || '柜子').slice(0, 40),
      door: ['double', 'single', 'drawer'].includes(c.door) ? c.door : 'single',
      shelves: (c.shelves && c.shelves.length ? c.shelves : [{ name: '格位1', kind: 'shelf' }]).map((s) => ({
        name: String(s.name || '格位1').slice(0, 40),
        kind: s.kind === 'drawer' ? 'drawer' : 'shelf',
      })),
    })),
  })).filter((f) => f.cabinets.length);
  if (!floors.length) throw new ApiError(400, 'AI 未能生成结构，请换个描述试试');
  return { zoneName: String(parsed.zoneName || '新区域').slice(0, 40), floors };
}

module.exports = { generate, parseStructureText };
