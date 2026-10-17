// 文本工具：句子切分、否定/假设语境判断、日期与报告期识别。

export const SENTENCE_BOUNDARY = /[。！？；!?;\n]/;

/** 返回 pos 所在句子的 [start, end) */
export function sentenceRange(text: string, pos: number): [number, number] {
  let s = pos;
  while (s > 0 && !SENTENCE_BOUNDARY.test(text[s - 1])) s--;
  let e = pos;
  while (e < text.length && !SENTENCE_BOUNDARY.test(text[e])) e++;
  return [s, e];
}

export function sentenceAt(text: string, pos: number): string {
  const [s, e] = sentenceRange(text, pos);
  return text.slice(s, e).trim();
}

const NEGATION_BEFORE =
  /(不(?!少|断|仅|过|同|久|错|论|管)|不得|严禁|禁止|并非|而非|非|未|没|无法|不能|不会|不可|并非|不是|切勿|切忌|勿|别|不存在|谈不上|难以|不可能|不承诺|未必|不一定|避免|警惕|谨防|拒绝|不要|不应|不宜|不建议|不推荐|而非|所谓|并不)[^，。；！？\n]{0,6}$/;
const NEGATION_AFTER = /^[^，。；！？\n]{0,10}(是不存在的|并不存在|不存在|是不可能的|不可能|是错误的|不可信|不靠谱|的说法不成立|已经没有|已不再|没有这)/;

/** 引号内的词是“提及”而非“断言”（如：我不能给出“买入/卖出/清仓”这类指令） */
export function isQuoted(text: string, start: number, end: number): boolean {
  const OPEN = '“"「『‘';
  const CLOSE = '”"」』’';
  const before = text.slice(Math.max(0, start - 20), start);
  let o = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (CLOSE.includes(before[i]) && before[i] !== '"') return false;
    if (OPEN.includes(before[i])) {
      o = i;
      break;
    }
  }
  if (o < 0) return false;
  const after = text.slice(end, end + 14);
  for (const ch of after) {
    if (CLOSE.includes(ch)) return true;
    if (OPEN.includes(ch) && ch !== '"') return false;
  }
  return false;
}
const HYPOTHETICAL_BEFORE = /(如果|假如|若是|若|倘若|您想|你想|想要|打算|计划|是否|要不要|能否|可不可以)[^，。；！？\n]{0,10}$/;

/** 命中词前 12 字内有否定词，或之后紧跟“是不存在的”等，视为否定语境 */
export function isNegated(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 12), start);
  const after = text.slice(end, end + 12);
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after);
}

export function isHypothetical(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 14), start);
  return HYPOTHETICAL_BEFORE.test(before);
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4 };

/**
 * 识别报告期表述，返回 'YYYY-Qn'（累计口径）或 'YYYY-QnS'（单季）。
 * 例：2026年上半年 → 2026-Q2；2026年第二季度 → 2026-Q2S；2025年年报 → 2025-Q4；2026Q1 → 2026-Q1
 */
export function findReportPeriod(s: string): string | null {
  // 先匹配“报告”类表述（累计口径），再匹配“第 N 季度”（单季口径）
  let m = s.match(/(20\d{2})\s*年?\s*(一季报|一季度报告|第一季度报告)/);
  if (m) return `${m[1]}-Q1`;
  m = s.match(/(20\d{2})\s*年?\s*(上半年|中报|半年报|半年度|中期报告|1-6月|1至6月)/);
  if (m) return `${m[1]}-Q2`;
  m = s.match(/(20\d{2})\s*年?\s*(前三季度|三季报|三季度报告|第三季度报告|1-9月|1至9月)/);
  if (m) return `${m[1]}-Q3`;
  m = s.match(/(20\d{2})\s*年?\s*(年报|年度报告|全年|年度)/);
  if (m) return `${m[1]}-Q4`;
  m = s.match(/(20\d{2})\s*年?\s*(?:第\s*)?([一二三四1-4])\s*季度/);
  if (m) {
    const q = CN_NUM[m[2]] ?? Number(m[2]);
    return q === 1 ? `${m[1]}-Q1` : `${m[1]}-Q${q}S`;
  }
  m = s.match(/(20\d{2})\s*[Qq]\s*([1-4])/);
  if (m) return `${m[1]}-Q${m[2]}`;
  m = s.match(/(20\d{2})\s*[Hh]1/);
  if (m) return `${m[1]}-Q2`;
  return null;
}

/** 识别具体日期，返回 'YYYY-MM-DD'。只写月日时用 defaultYear 补全 */
export function findDate(s: string, defaultYear: number): string | null {
  let m = s.match(/(20\d{2})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (m) return ymd(defaultYear, Number(m[1]), Number(m[2]));
  m = s.match(/(?<![\d-])(1[0-2]|0?[1-9])-(3[01]|[12]\d|0[1-9])(?![\d-])\s*(当天|当日|收盘|日|：|:)/);
  if (m) return ymd(defaultYear, Number(m[1]), Number(m[2]));
  return null;
}

export function findAllDates(s: string, defaultYear: number): string[] {
  const out: string[] = [];
  const re1 = /(20\d{2})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?/g;
  const re2 = /(?<![\d年])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g;
  for (const m of s.matchAll(re1)) out.push(ymd(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of s.matchAll(re2)) out.push(ymd(defaultYear, Number(m[1]), Number(m[2])));
  return out;
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 回答里是否写明了数据时点（日期、报告期或“截至…”） */
export function hasTimeLabel(s: string): boolean {
  return (
    /(20\d{2})\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}/.test(s) ||
    /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/.test(s) ||
    /截至|截止/.test(s) && /\d/.test(s)
  );
}

export function hasReportPeriodLabel(s: string): boolean {
  return findReportPeriod(s) !== null || /(一季报|中报|半年报|三季报|年报|上半年|前三季度|报告期)/.test(s);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 简单稳定哈希（FNV-1a），用于确定性抽样与随机数种子 */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 可复现的伪随机数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
