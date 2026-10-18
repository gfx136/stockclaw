/**
 * 周线 BBI 选股策略（用户的通达信公式的 clean-room 实现）。
 *
 * 原公式：
 *   周线BBI  := (MA(CLOSE,3)+MA(CLOSE,6)+MA(CLOSE,12)+MA(CLOSE,24))/4;
 *   周线MA26 := MA(CLOSE,26);
 *   周线收盘 := CLOSE;
 *   市值     := FINANCE(41)/100000000;          -- 总市值，单位亿
 *   排除ST    := NOT(NAMELIKE('ST')) AND NOT(NAMELIKE('*ST'));
 *   排除科创板 := NOT(CODELIKE('688')) AND NOT(CODELIKE('689'));
 *   排除北交所 := NOT(CODELIKE('8')) AND NOT(CODELIKE('43')) AND NOT(CODELIKE('82'))
 *                AND NOT(CODELIKE('83')) AND NOT(CODELIKE('87'));
 *   排除银行  := NOT(NAMELIKE('银行'));
 *   最终选股: 周线BBI > 周线MA26 AND 周线收盘 > 周线BBI
 *            AND 市值 >= 20 AND 排除ST AND 排除科创板 AND 排除北交所 AND 排除银行;
 *
 * 性能设计（关键）：
 *   排除条件全是「名称/代码/市值」级别的便宜判断，不需要 K 线，
 *   先用它们把全市场 ~5500 只压到几百只候选，再只对候选拉周线 K 线算 BBI。
 *   这样把 O(全市场 × 拉K线) 降成 O(候选 × 拉K线)。
 */

import { calcBBI, sma } from '@/lib/indicators';
import type { KlineBar, Stock } from '@/types/stock';

/** 市值下限：20 亿（FINANCE(41) 单位元 → /1e8 得亿） */
export const MIN_MARKET_CAP_YI = 20;

/** 周线 BBI 至少需要多少根周线（MA24 窗口 + 余量） */
export const MIN_WEEKLY_BARS = 30;

/** 判断单只股票是否被排除条件刷掉（不需要 K 线） */
export function isExcluded(stock: Stock): boolean {
  const name = stock.name;
  const code = stock.code.replace(/\D/g, '');

  // 排除 ST / *ST
  if (name.includes('ST')) return true;
  // 排除银行
  if (name.includes('银行')) return true;
  // 排除科创板（688 / 689）
  if (code.startsWith('688') || code.startsWith('689')) return true;
  // 排除北交所（43 / 82 / 83 / 87 / 8 开头）
  if (
    code.startsWith('43') ||
    code.startsWith('82') ||
    code.startsWith('83') ||
    code.startsWith('87') ||
    code.startsWith('8')
  ) {
    return true;
  }
  // 市值 < 20 亿
  const capYi = (stock.marketCap ?? 0) / 1e8;
  if (capYi < MIN_MARKET_CAP_YI) return true;

  return false;
}

/** 第一阶段：便宜过滤（不拉 K 线），返回候选列表 */
export function prefilter(stocks: Stock[]): Stock[] {
  return stocks.filter((s) => !isExcluded(s));
}

/** 周线 BBI 策略的判定结果 */
export interface WeeklyBBIResult {
  pass: boolean;
  weeklyBBI?: number;
  weeklyMA26?: number;
  weeklyClose?: number;
  /** 用于结果页展示命中原因 */
  reason?: string;
}

/**
 * 对单只股票的周线 K 线判定公式条件。
 * bars 必须按时间升序。至少需要 MIN_WEEKLY_BARS 根。
 */
export function matchWeeklyBBI(bars: KlineBar[]): WeeklyBBIResult {
  if (bars.length < MIN_WEEKLY_BARS) {
    return { pass: false, reason: `周线不足 ${MIN_WEEKLY_BARS} 根` };
  }
  const closes = bars.map((b) => b.close);
  const bbiSeries = calcBBI(closes);
  const ma26Series = sma(closes, 26);

  const i = bars.length - 1;
  const bbi = bbiSeries[i];
  const ma26 = ma26Series[i];
  const close = closes[i];

  if (bbi === undefined || ma26 === undefined) {
    return { pass: false, reason: '指标窗口未满' };
  }

  const pass = bbi > ma26 && close > bbi;
  return {
    pass,
    weeklyBBI: bbi,
    weeklyMA26: ma26,
    weeklyClose: close,
    reason: pass ? undefined : 'BBI/MA26/收盘 关系不满足',
  };
}
