/**
 * A 股行情配色与格式化。
 *
 * ⚠️ 关键约定：**涨 = 红，跌 = 绿**（国内市场惯例，与欧美相反）。
 * 所有展示涨跌的地方都必须走 `upDownColor()`，不要直接写死颜色。
 */

import { Colors } from '@/constants/theme';

/** 涨跌色 */
export const QuoteColors = {
  /** 上涨 / 正数 */
  up: '#E43B3B',
  /** 下跌 / 负数 */
  down: '#0AA869',
  /** 平盘 */
  flat: '#8A8F98',
} as const;

/** 根据涨跌值取色（A 股口径：涨红跌绿） */
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