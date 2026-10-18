/**
 * 筛选引擎。
 * 对应 StockClaw 的 core/api/filter_engine.dart，按 RN/TS 重新实现。
 *
 * 职责：给定「股票列表 + 筛选条件集（+ 可选的本地 K 线）」，输出命中的股票与信号标签。
 *
 * 设计要点：
 * 1. **基础条件（市值/PE/涨跌幅/换手率/价格/关键字）只看行情快照**，不依赖 K 线，
 *    所以即使本地没有缓存也能全量筛选，速度快。
 * 2. **技术指标信号条件依赖本地 K 线**，需要调用方提供 `klineProvider`。
 *    没提供时信号条件会被忽略并在结果里给出 warning，而不是静默返回空。
 * 3. 单只股票的指标计算异常不会中断整体筛选（try/catch 跳过）。
 * 4. **指标只算一次**，金叉/死叉所需的「前一项」直接从序列里取，不重复计算。
 */

import { calcAllIndicators, snapshotAt, nthLast } from '@/lib/indicators';
import { matchBBIGroup, matchWeeklyBBI } from '@/lib/weekly-bbi';
import {
  rankToTier,
  type FilterSet,
  type FilterResult,
  type IndicatorSeries,
  type KlineBar,
  type RangeCondition,
  type SignalCondition,
  type Stock,
} from '@/types/stock';

/**
 * K 线提供者：同步返回已缓存的 K 线（无则返回 undefined / 空数组）。
 * period 缺省为日线；weeklyBBIStrategy 信号会请求周线。
 */
export type KlineProvider = (code: string, period?: 'daily' | 'weekly') => KlineBar[] | undefined;

/** 判断数值是否落在区间内；区间字段缺省视为不限制 */
function inRange(value: number | undefined, range?: RangeCondition): boolean {
  if (!range) return true;
  const { min, max } = range;
  if (min === undefined && max === undefined) return true;
  if (value === undefined || Number.isNaN(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/** 信号条件里是否有实际启用的项 */
export function hasAnySignal(s?: SignalCondition): boolean {
  if (!s) return false;
  return (
    !!s.maBullish ||
    !!s.maBearish ||
    !!s.macdGoldenCross ||
    !!s.macdDeadCross ||
    !!s.macdHistTurnPositive ||
    !!s.kdjGoldenCross ||
    !!s.kdjOversold ||
    !!s.kdjOverbought ||
    !!s.rsiOversold ||
    !!s.rsiOverbought ||
    !!s.aboveBollMid ||
    !!s.belowBollLower ||
    !!s.volumeSurge ||
    !!s.weeklyBBIStrategy ||
    // BBI 分组（周线/日线）
    !!s.weeklyCloseGtBBI ||
    !!s.weeklyBull ||
    !!s.weeklyBBIGtMA26 ||
    !!s.dailyCloseGtBBI ||
    !!s.daily4CloseGtBBI ||
    !!s.dailyBBIGtMA26
  );
}

/** 是否有周线 BBI 条件 */
function hasWeeklyBBI(s?: SignalCondition): boolean {
  return !!(s && (s.weeklyBBIStrategy || s.weeklyCloseGtBBI || s.weeklyBull || s.weeklyBBIGtMA26));
}

/** 是否有日线 BBI 条件 */
function hasDailyBBI(s?: SignalCondition): boolean {
  return !!(s && (s.dailyCloseGtBBI || s.daily4CloseGtBBI || s.dailyBBIGtMA26));
}

/** 基础条件快筛（不依赖 K 线），通过返回 true。rankMap 提供市值排名（排名制分档用） */
export function matchBase(
  stock: Stock,
  filter: FilterSet,
  rankMap?: Map<string, number>
): boolean {
  // —— 排除条件（最先判，成本最低） ——
  const name = stock.name;
  const code = stock.code.replace(/\D/g, '');
  if (filter.excludeST && name.includes('ST')) return false;
  if (filter.excludeBank && name.includes('银行')) return false;
  if (filter.excludeKCB && (code.startsWith('688') || code.startsWith('689'))) return false;
  if (filter.excludeChiNext && code.startsWith('30')) return false;
  if (
    filter.excludeBSE &&
    (code.startsWith('43') ||
      code.startsWith('82') ||
      code.startsWith('83') ||
      code.startsWith('87') ||
      code.startsWith('8'))
  ) {
    return false;
  }

  if (filter.capTiers && filter.capTiers.length > 0) {
    // 排名制分档：大盘 Top100 / 中盘 101-300 / 小盘 301-500 / 长尾 >500
    const rank = rankMap?.get(stock.code);
    if (rank === undefined) return false;
    if (!filter.capTiers.includes(rankToTier(rank))) return false;
  }
  if (!inRange(stock.marketCap, filter.marketCapRange)) return false;
  if (!inRange(stock.pe, filter.peRange)) return false;
  if (!inRange(stock.changePercent, filter.changeRange)) return false;
  if (!inRange(stock.turnover, filter.turnoverRange)) return false;
  if (!inRange(stock.price, filter.priceRange)) return false;

  const kw = filter.keyword?.trim();
  if (kw) {
    const k = kw.toLowerCase();
    if (!stock.code.toLowerCase().includes(k) && !stock.name.toLowerCase().includes(k)) {
      return false;
    }
  }
  return true;
}

/**
 * 技术信号判定。
 * @param series 已算好的指标序列（只算一次）
 * @returns 命中的标签数组；空数组 = 未命中
 */
export function matchSignals(
  s: SignalCondition,
  series: IndicatorSeries,
  bars: KlineBar[]
): string[] {
  const hits: string[] = [];
  const n = bars.length;
  if (n === 0) return hits;

  const snap = snapshotAt(series, bars);
  const lastClose = bars[n - 1].close;

  // —— 均线排列 ——
  const { ma5, ma10, ma20 } = snap;
  if (s.maBullish && ma5 !== undefined && ma10 !== undefined && ma20 !== undefined) {
    if (ma5 > ma10 && ma10 > ma20) hits.push('均线多头');
  }
  if (s.maBearish && ma5 !== undefined && ma10 !== undefined && ma20 !== undefined) {
    if (ma5 < ma10 && ma10 < ma20) hits.push('均线空头');
  }

  // —— MACD ——
  const dif = series.macd.dif;
  const dea = series.macd.dea;
  const hist = series.macd.hist;
  const difPrev = nthLast(dif, 1);
  const deaPrev = nthLast(dea, 1);
  const histPrev = nthLast(hist, 1);
  const difNow = nthLast(dif, 0);
  const deaNow = nthLast(dea, 0);
  const histNow = nthLast(hist, 0);

  if (s.macdGoldenCross && difPrev !== undefined && deaPrev !== undefined && difNow !== undefined && deaNow !== undefined) {
    if (difPrev <= deaPrev && difNow > deaNow) hits.push('MACD金叉');
  }
  if (s.macdDeadCross && difPrev !== undefined && deaPrev !== undefined && difNow !== undefined && deaNow !== undefined) {
    if (difPrev >= deaPrev && difNow < deaNow) hits.push('MACD死叉');
  }
  if (s.macdHistTurnPositive && histPrev !== undefined && histNow !== undefined) {
    if (histPrev <= 0 && histNow > 0) hits.push('MACD柱转正');
  }

  // —— KDJ ——
  const kSeries = series.kdj.k;
  const dSeries = series.kdj.d;
  const kNow = nthLast(kSeries, 0);
  const dNow = nthLast(dSeries, 0);
  if (s.kdjGoldenCross) {
    const kp = nthLast(kSeries, 1);
    const dp = nthLast(dSeries, 1);
    if (kp !== undefined && dp !== undefined && kNow !== undefined && dNow !== undefined) {
      if (kp <= dp && kNow > dNow) hits.push('KDJ金叉');
    }
  }
  if (s.kdjOversold && kNow !== undefined && kNow < 20) hits.push('KDJ超卖');
  if (s.kdjOverbought && kNow !== undefined && kNow > 80) hits.push('KDJ超买');

  // —— RSI ——
  const rsi14 = nthLast(series.rsi[14] ?? [], 0);
  if (s.rsiOversold && rsi14 !== undefined && rsi14 < 30) hits.push('RSI超卖');
  if (s.rsiOverbought && rsi14 !== undefined && rsi14 > 70) hits.push('RSI超买');

  // —— BOLL ——
  const mid = nthLast(series.boll.mid, 0);
  const lower = nthLast(series.boll.lower, 0);
  if (s.aboveBollMid && mid !== undefined && lastClose > mid) hits.push('站上布林中轨');
  if (s.belowBollLower && lower !== undefined && lastClose < lower) hits.push('跌破布林下轨');

  // —— 放量 ——
  if (s.volumeSurge) {
    const { days, multiple } = s.volumeSurge;
    if (n > days) {
      let sum = 0;
      for (let i = n - 1 - days; i < n - 1; i++) sum += bars[i].volume;
      const avg = sum / days;
      if (avg > 0 && bars[n - 1].volume > avg * multiple) hits.push('放量');
    }
  }

  return hits;
}

/** 筛选统计 */
export interface FilterStats {
  /** 参与筛选的股票总数 */
  total: number;
  /** 通过基础条件的数量 */
  passedBase: number;
  /** 因缺少本地 K 线而被跳过的数量（仅当有信号条件时有意义） */
  skippedNoKline: number;
  /** 最终命中数量 */
  matched: number;
}

export interface FilterOutput {
  results: FilterResult[];
  stats: FilterStats;
  /** 有信号条件却没提供 K 线数据源时的提示 */
  warning?: string;
}

/** 技术指标至少需要多少根 K 线才有意义（MA60/BOLL 等需要足够窗口） */
export const MIN_BARS_FOR_SIGNAL = 60;

/**
 * 主筛选函数。
 *
 * @param stocks        行情全量列表
 * @param filter        条件集
 * @param klineProvider 本地 K 线提供者（有信号条件时必需）
 * @param limit         结果上限（默认 300，避免列表过长）
 */
export function filterStocks(
  stocks: Stock[],
  filter: FilterSet,
  klineProvider?: KlineProvider,
  limit = 300
): FilterOutput {
  const needSignals = hasAnySignal(filter.signals);
  const results: FilterResult[] = [];
  let passedBase = 0;
  let skippedNoKline = 0;

  let warning: string | undefined;
  if (needSignals && !klineProvider) {
    warning =
      '已设置技术指标条件，但未提供本地 K 线数据，信号条件已被忽略。请先在详情页下载 K 线。';
  }

  // 市值排名映射（排名制分档用）：市值降序，第 1 名市值最大
  let rankMap: Map<string, number> | undefined;
  if (filter.capTiers && filter.capTiers.length > 0) {
    const sorted = [...stocks].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    rankMap = new Map(sorted.map((s, i) => [s.code, i + 1]));
  }

  for (const stock of stocks) {
    if (!matchBase(stock, filter, rankMap)) continue;
    passedBase++;

    if (!needSignals || !klineProvider) {
      results.push({ stock, hits: [] });
      if (results.length >= limit) break;
      continue;
    }

    const sig = filter.signals!;
    const hits: string[] = [];

    // —— 周线 BBI 组：用周线数据判定 ——
    if (hasWeeklyBBI(sig)) {
      let weeklyBars: KlineBar[] | undefined;
      try {
        weeklyBars = klineProvider(stock.code, 'weekly');
      } catch {
        weeklyBars = undefined;
      }
      if (!weeklyBars || weeklyBars.length < 26) {
        skippedNoKline++;
        continue;
      }
      // 整策略开关：BBI>MA26 且 收盘>BBI
      if (sig.weeklyBBIStrategy) {
        const r = matchWeeklyBBI(weeklyBars);
        if (!r.pass) continue;
        hits.push(`周线BBI多头 (BBI ${r.weeklyBBI?.toFixed(2)}>MA26 ${r.weeklyMA26?.toFixed(2)})`);
      }
      // 分组条件（组内 AND）
      const wHits = matchBBIGroup(weeklyBars, {
        closeGtBBI: sig.weeklyCloseGtBBI,
        bull: sig.weeklyBull,
        bbiGtMA26: sig.weeklyBBIGtMA26,
      });
      const wExpected = [sig.weeklyCloseGtBBI, sig.weeklyBull, sig.weeklyBBIGtMA26].filter(Boolean).length;
      if (wExpected > 0) {
        if (wHits.length < wExpected) continue;
        hits.push(...wHits.map((h) => `周线:${h}`));
      }
    }

    // —— 日线 BBI 组：用日线数据判定 ——
    if (hasDailyBBI(sig)) {
      let dailyBars: KlineBar[] | undefined;
      try {
        dailyBars = klineProvider(stock.code, 'daily');
      } catch {
        dailyBars = undefined;
      }
      if (!dailyBars || dailyBars.length < 26) {
        skippedNoKline++;
        continue;
      }
      const dHits = matchBBIGroup(dailyBars, {
        closeGtBBI: sig.dailyCloseGtBBI,
        bbiGtMA26: sig.dailyBBIGtMA26,
        fourCloseGtBBI: sig.daily4CloseGtBBI,
      });
      const dExpected = [sig.dailyCloseGtBBI, sig.dailyBBIGtMA26, sig.daily4CloseGtBBI].filter(Boolean).length;
      if (dExpected > 0) {
        if (dHits.length < dExpected) continue;
        hits.push(...dHits.map((h) => `日线:${h}`));
      }
    }

    // 判断是否还有 BBI 以外的其他日线信号
    const onlyBBI = hasWeeklyBBI(sig) || hasDailyBBI(sig);
    const hasOtherDailySignal = hasAnySignal({
      ...sig,
      weeklyBBIStrategy: undefined,
      weeklyCloseGtBBI: undefined,
      weeklyBull: undefined,
      weeklyBBIGtMA26: undefined,
      dailyCloseGtBBI: undefined,
      daily4CloseGtBBI: undefined,
      dailyBBIGtMA26: undefined,
    });

    if (onlyBBI && !hasOtherDailySignal) {
      if (hits.length > 0) {
        results.push({ stock, hits });
        if (results.length >= limit) break;
      }
      continue;
    }

    let bars: KlineBar[] | undefined;
    try {
      bars = klineProvider(stock.code);
    } catch {
      bars = undefined;
    }
    if (!bars || bars.length < MIN_BARS_FOR_SIGNAL) {
      skippedNoKline++;
      continue;
    }

    try {
      const series = calcAllIndicators(bars);
      const otherHits = matchSignals(sig, series, bars);
      if (otherHits.length > 0 || hits.length > 0) {
        results.push({ stock, snapshot: snapshotAt(series, bars), hits: [...hits, ...otherHits] });
        if (results.length >= limit) break;
      }
    } catch {
      continue;
    }
  }

  return {
    results,
    stats: {
      total: stocks.length,
      passedBase,
      skippedNoKline,
      matched: results.length,
    },
    warning,
  };
}