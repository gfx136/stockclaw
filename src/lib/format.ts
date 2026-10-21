/**
 * A 股行情配色与格式化。
 *
 * ⚠️ 关键约定：**涨 = 红，跌 = 绿**（国内市场惯例，与欧美相反）。
 * 所有展示涨跌的地方都必须走 `upDownColor()`，不要直接写死颜色。
 */

import { Colors } from '@/constants/theme';

let _isDark = true; // 默认深色（盯盘场景）
/** 供 use-color-scheme 在主题切换时调用 */
export function setQuoteDark(isDark: boolean): void {
  _isDark = isDark;
}

/**
 * 涨跌色（主题感知）。
 *
 * UI 评审修正（2026-10-21）：
 *  - 浅色「跌」色 #0F9B6C 作文字压白底仅 3.54:1，作为涨跌胶囊底色压白字同样 3.54:1，
 *    而「涨」是 4.86:1 —— 等于跌的股票比涨的更难读。改为 #0A7A54（白字 5.35 / 文字 5.35）；「涨」由 #D63030 微调到 #C82B2B，
 *    让它在卡片底上也过 4.5（4.27 → 4.81）。
 *  - 深色主题底色是亮色（#FF5252 / #26A69A），压白字只有 2.6 / 3.0:1，
 *    必须改用深字，见 pillText。
 *  - 平盘灰原来两套主题共用一个值，浅色下仅 3.0:1，拆开。
 */
export const QuoteColors = {
  get up(): string {
    return _isDark ? '#FF5252' : '#C82B2B';
  },
  get down(): string {
    return _isDark ? '#26A69A' : '#0A7A54';
  },
  /** 平盘 */
  get flat(): string {
    return _isDark ? '#8A8F98' : '#5F6570';
  },
  /** 压在涨跌实色胶囊上的文字色（浅色底深用白字，深色底亮用深字） */
  get pillText(): string {
    return _isDark ? '#0B0F13' : '#FFFFFF';
  },
} as const;

/** 根据涨跌值取色（A 股口径：涨红跌绿，随主题） */
export function upDownColor(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v) || v === 0) {
    return QuoteColors.flat;
  }
  return v > 0 ? QuoteColors.up : QuoteColors.down;
}

/** 涨跌前缀符号 */
export function upDownSign(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v) || v === 0) return '';
  return v > 0 ? '+' : '';
}

/* ------------------------------------------------------------------ *
 * 格式化
 * ------------------------------------------------------------------ */

/** 价格：保留 2 位 */
export function fmtPrice(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v.toFixed(2);
}

/** 涨跌幅：带符号 + % */
export function fmtPercent(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return `${upDownSign(v)}${v.toFixed(2)}%`;
}

/** 涨跌额：带符号 */
export function fmtChange(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return `${upDownSign(v)}${v.toFixed(2)}`;
}

/**
 * 金额 / 市值：中文单位（亿 / 万）。
 * 输入单位是元。
 */
export function fmtMoney(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v) || v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

/** 成交量：手 → 万手 / 亿手 */
export function fmtVolume(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v) || v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

/** 市盈率：负值（亏损）显示为「亏损」 */
export function fmtPE(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v) || v === 0) return '—';
  if (v < 0) return '亏损';
  return v.toFixed(2);
}

/** 换手率 */
export function fmtTurnover(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return `${v.toFixed(2)}%`;
}

/** 股票代码 → 带市场前缀的展示（如 SH600000 / SZ000001 / BJ430047） */
export function fmtCodeWithMarket(code: string): string {
  const c = code.replace(/\D/g, '');
  if (/^(60|68|90)/.test(c)) return `SH${c}`;
  if (/^(4|8)/.test(c)) return `BJ${c}`;
  return `SZ${c}`;
}

/** 市场中文名 */
export function marketName(code: string): string {
  const c = code.replace(/\D/g, '');
  if (/^688/.test(c)) return '科创板';
  if (/^60/.test(c)) return '沪主板';
  if (/^300/.test(c)) return '创业板';
  if (/^30/.test(c)) return '深主板';
  if (/^00/.test(c)) return '深主板';
  if (/^(4|8)/.test(c)) return '北交所';
  return '其他';
}

/** 深色/浅色主题下的卡片底色（供列表斑马纹用） */
export function cardBg(scheme: 'light' | 'dark' | null | undefined): string {
  return scheme === 'dark' ? Colors.dark.backgroundElement : Colors.light.backgroundElement;
}

/** 时间戳（秒）→ 「10-17 15:00」 */
export function monthDayTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}