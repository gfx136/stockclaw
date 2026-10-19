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

import { calcAllIndicators, snapshotAt, nthLast, sma } from '@/lib/indicators';
import { matchBBIGroup, matchWeeklyBBI } from '@/lib/weekly-bbi';
import {
  rankToTier,
  ruleLabel,
  type FilterSet,
  type FilterResult,
  type IndicatorRule,
  type IndicatorSeries,
  type IndicatorSnapshot,
  type KlineBar,
  type KlinePeriod,
  type RangeCondition,
  type SignalCondition,
  type Stock,
} from '@/types/stock';

/**
 * K 线提供者：同步返回已缓存的 K 线（无则返回 undefined / 空数组）。
 * period 缺省为日线；技术指标规则可按需请求 60分钟/周/月。
 */
export type KlineProvider = (code: string, period?: KlinePeriod) => KlineBar[] | undefined;

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
    // 排名制分档：大盘 Top100 / 中盘 101-300 / 小盘 301-500
    const rank = rankMap?.get(stock.code);
    if (rank === undefined) return false;
    if (!filter.capTiers.includes(rankToTier(rank))) return false;
  }
  if (!inRange(stock.marketCap, filter.marketCapRange)) return false;
  if (!inRange(stock.floatCap, filter.floatCapRange)) return false;
  if (!inRange(stock.amount, filter.amountRange)) return false;
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

/* ------------------------------------------------------------------ *
 * 技术指标规则判定（结构化，含适用周期）——规格 2.2 B / 4.3
 * ------------------------------------------------------------------ */

/** 是否有技术指标规则 */
export function hasAnyRules(filter: FilterSet): boolean {
  return !!(filter.rules && filter.rules.length > 0);
}

/** 收集一组规则需要的 MA 周期（含 BBI 规则的 MA26） */
function collectMaPeriods(rules: IndicatorRule[]): number[] {
  const set = new Set<number>([5, 10, 20, 60]);
  for (const r of rules) {
    if (r.kind === 'ma_above' || r.kind === 'ma_below') set.add(r.value ?? 20);
    if (r.kind === 'bbi_gt_ma26' || r.kind === 'bbi_w_gt_ma26') set.add(26);
  }
  return [...set];
}

/** 判定单条规则（最新 bar）。series 已含所需指标。 */
function judgeRule(rule: IndicatorRule, series: IndicatorSeries, bars: KlineBar[]): boolean {
  const n = bars.length;
  const i = n - 1;
  if (i < 0) return false;
  const close = bars[i].close;
  const at = (arr?: (number | undefined)[]) => (arr ? arr[i] : undefined);

  switch (rule.kind) {
    case 'ma_above': {
      const v = at(series.ma[rule.value ?? 20]);
      return v !== undefined && close > v;
    }
    case 'ma_below': {
      const v = at(series.ma[rule.value ?? 20]);
      return v !== undefined && close < v;
    }
    case 'boll_above_upper': { const v = at(series.boll.upper); return v !== undefined && close > v; }
    case 'boll_above_mid': { const v = at(series.boll.mid); return v !== undefined && close > v; }
    case 'boll_below_mid': { const v = at(series.boll.mid); return v !== undefined && close < v; }
    case 'boll_below_lower': { const v = at(series.boll.lower); return v !== undefined && close < v; }
    case 'macd_hist_pos': { const v = at(series.macd.hist); return v !== undefined && v > 0; }
    case 'macd_hist_neg': { const v = at(series.macd.hist); return v !== undefined && v < 0; }
    case 'macd_golden': {
      const d0 = at(series.macd.dif), e0 = at(series.macd.dea);
      const d1 = i > 0 ? series.macd.dif[i - 1] : undefined;
      const e1 = i > 0 ? series.macd.dea[i - 1] : undefined;
      return d0 !== undefined && e0 !== undefined && d1 !== undefined && e1 !== undefined && d1 <= e1 && d0 > e0;
    }
    case 'macd_dead': {
      const d0 = at(series.macd.dif), e0 = at(series.macd.dea);
      const d1 = i > 0 ? series.macd.dif[i - 1] : undefined;
      const e1 = i > 0 ? series.macd.dea[i - 1] : undefined;
      return d0 !== undefined && e0 !== undefined && d1 !== undefined && e1 !== undefined && d1 >= e1 && d0 < e0;
    }
    case 'kdj_gt': { const v = at(series.kdj.j); return v !== undefined && v > (rule.value ?? 80); }
    case 'kdj_lt': { const v = at(series.kdj.j); return v !== undefined && v < (rule.value ?? 20); }
    case 'rsi_gt': { const v = at(series.rsi[14]); return v !== undefined && v > (rule.value ?? 70); }
    case 'rsi_lt': { const v = at(series.rsi[14]); return v !== undefined && v < (rule.value ?? 30); }
    case 'bbi_close_gt':
    case 'bbi_w_close_gt': {
      const b = at(series.bbi);
      return b !== undefined && close > b;
    }
    case 'bbi_4close_gt': {
      for (let k = 0; k < 4; k++) {
        const idx = i - k;
        if (idx < 0) return false;
        const b = series.bbi[idx];
        if (b === undefined || bars[idx].close <= b) return false;
      }
      return true;
    }
    case 'bbi_gt_ma26':
    case 'bbi_w_gt_ma26': {
      const b = at(series.bbi);
      const m = at(series.ma[26]);
      return b !== undefined && m !== undefined && b > m;
    }
    case 'bbi_w_bull': {
      // 周线红柱：最新周线 bar 收盘 > 开盘（严格大于）
      return close > bars[i].open;
    }
  }
}

/**
 * 规则的默认适用周期（规格 §3.1）：
 * - 周期无关规则（MA/BOLL/MACD/KDJ/RSI）→ 60分钟/日/周/月 四周期全部生效
 * - BBI 组规则自带周期标签（日线/周线定向）
 */
export function defaultPeriodsForRule(rule: IndicatorRule): KlinePeriod[] {
  switch (rule.kind) {
    case 'bbi_w_close_gt':
    case 'bbi_w_gt_ma26':
    case 'bbi_w_bull':
      return ['weekly'];
    case 'bbi_close_gt':
    case 'bbi_4close_gt':
    case 'bbi_gt_ma26':
      return ['daily'];
    default:
      return ['60min', 'daily', 'weekly', 'monthly'];
  }
}

/** 规则判定的最小 K 线根数（数据窗口，规格 §3.2） */
function minBarsForRule(rule: IndicatorRule): number {  switch (rule.kind) {
    case 'ma_above':
    case 'ma_below':
      return (rule.value ?? 20) + 1;
    case 'boll_above_upper':
    case 'boll_above_mid':
    case 'boll_below_mid':
    case 'boll_below_lower':
      return 21;
    case 'macd_hist_pos':
    case 'macd_hist_neg':
    case 'macd_golden':
    case 'macd_dead':
      return 36;
    case 'kdj_gt':
    case 'kdj_lt':
      return 11;
    case 'rsi_gt':
    case 'rsi_lt':
      return 16;
    // BBI 日线规则需 ≥ 25 根（BBI 24 根 + 连续4根多3根历史）
    case 'bbi_close_gt':
    case 'bbi_4close_gt':
    case 'bbi_gt_ma26':
      return 25;
    // BBI 周线规则需 ≥ 27 根（MA26 26 根 + 1）
    case 'bbi_w_close_gt':
    case 'bbi_w_gt_ma26':
    case 'bbi_w_bull':
      return 27;
  }
}

/**
 * 判定一只股票是否命中所有规则（AND）。
 * 规格 §3.1：周期无关规则对四周期全部生效；每条规则在其每个选中周期都须满足。
 * 某周期本地数据不足 → 该股票计入「未参与」（noData），不是简单未命中。
 */
export function matchRules(
  stock: Stock,
  rules: IndicatorRule[],
  klineProvider: KlineProvider
): { pass: boolean; hits: string[]; noData: boolean } {
  const hits: string[] = [];
  let anyNoData = false;

  for (const rule of rules) {
    const periods = rule.periods && rule.periods.length > 0 ? rule.periods : defaultPeriodsForRule(rule);
    const minBars = minBarsForRule(rule);
    let rulePass = true;

    for (const period of periods) {
      let bars: KlineBar[] | undefined;
      try {
        bars = klineProvider(stock.code, period);
      } catch {
        bars = undefined;
      }
      // 数据不足 → 计未参与（不是未命中）
      if (!bars || bars.length < minBars) {
        anyNoData = true;
        rulePass = false;
        break;
      }
      const series = calcAllIndicators(bars, collectMaPeriods([rule]));
      if (!judgeRule(rule, series, bars)) {
        rulePass = false;
        break;
      }
    }

    if (!rulePass) return { pass: false, hits: [], noData: anyNoData };
    hits.push(ruleLabel(rule));
  }

  return { pass: true, hits, noData: anyNoData };
}

/** 跳空缺口幅度判定：最新 bar 开盘 vs 前一 bar 收盘，% */
export function gapPercent(bars: KlineBar[]): number | undefined {
  const n = bars.length;
  if (n < 2) return undefined;
  const prevClose = bars[n - 2].close;
  if (!prevClose) return undefined;
  return ((bars[n - 1].open - prevClose) / prevClose) * 100;
}

/** 信号判定结果 */
interface SignalMatch {
  hit: boolean;
  hits: string[];
  snapshot?: IndicatorSnapshot;
  /** 数据不足（本地 K 线缺失） */
  noData: boolean;
}

/**
 * 判定一只股票的旧版扁平 signals（BBI 分组 + 日线信号）。
 * BBI 组内 AND；BBI 与其他日线信号合并取命中集合。
 */
function matchStockSignals(
  stock: Stock,
  sig: SignalCondition,
  klineProvider: KlineProvider
): SignalMatch {
  const hits: string[] = [];

  // —— 周线 BBI 组 ——
  if (hasWeeklyBBI(sig)) {
    let weeklyBars: KlineBar[] | undefined;
    try {
      weeklyBars = klineProvider(stock.code, 'weekly');
    } catch {
      weeklyBars = undefined;
    }
    if (!weeklyBars || weeklyBars.length < 26) {
      return { hit: false, hits: [], noData: true };
    }
    if (sig.weeklyBBIStrategy) {
      const r = matchWeeklyBBI(weeklyBars);
      if (!r.pass) return { hit: false, hits: [], noData: false };
      hits.push(`周线BBI多头 (BBI ${r.weeklyBBI?.toFixed(2)}>MA26 ${r.weeklyMA26?.toFixed(2)})`);
    }
    const wHits = matchBBIGroup(weeklyBars, {
      closeGtBBI: sig.weeklyCloseGtBBI,
      bull: sig.weeklyBull,
      bbiGtMA26: sig.weeklyBBIGtMA26,
    });
    const wExpected = [sig.weeklyCloseGtBBI, sig.weeklyBull, sig.weeklyBBIGtMA26].filter(Boolean).length;
    if (wExpected > 0) {
      if (wHits.length < wExpected) return { hit: false, hits: [], noData: false };
      hits.push(...wHits.map((h) => `周线:${h}`));
    }
  }

  // —— 日线 BBI 组 ——
  if (hasDailyBBI(sig)) {
    let dailyBars: KlineBar[] | undefined;
    try {
      dailyBars = klineProvider(stock.code, 'daily');
    } catch {
      dailyBars = undefined;
    }
    if (!dailyBars || dailyBars.length < 26) {
      return { hit: false, hits: [], noData: true };
    }
    const dHits = matchBBIGroup(dailyBars, {
      closeGtBBI: sig.dailyCloseGtBBI,
      bbiGtMA26: sig.dailyBBIGtMA26,
      fourCloseGtBBI: sig.daily4CloseGtBBI,
    });
    const dExpected = [sig.dailyCloseGtBBI, sig.dailyBBIGtMA26, sig.daily4CloseGtBBI].filter(Boolean).length;
    if (dExpected > 0) {
      if (dHits.length < dExpected) return { hit: false, hits: [], noData: false };
      hits.push(...dHits.map((h) => `日线:${h}`));
    }
  }

  // 是否还有 BBI 以外的其他日线信号
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
    return { hit: hits.length > 0, hits, noData: false };
  }

  let bars: KlineBar[] | undefined;
  try {
    bars = klineProvider(stock.code);
  } catch {
    bars = undefined;
  }
  if (!bars || bars.length < MIN_BARS_FOR_SIGNAL) {
    return { hit: false, hits: [], noData: true };
  }

  try {
    const series = calcAllIndicators(bars);
    const otherHits = matchSignals(sig, series, bars);
    const allHits = [...hits, ...otherHits];
    return {
      hit: allHits.length > 0,
      hits: allHits,
      snapshot: snapshotAt(series, bars),
      noData: false,
    };
  } catch {
    return { hit: false, hits: [], noData: true };
  }
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
 * @param klineProvider 本地 K 线提供者（有信号/规则条件时必需）
 * @param limit         结果上限（默认 300，避免列表过长）
 * @param favorites     自选代码集合（onlyFavorites 时用）
 * @param onProgress    进度回调（已扫描 / 总数）
 */
export function filterStocks(
  stocks: Stock[],
  filter: FilterSet,
  klineProvider?: KlineProvider,
  limit = 300,
  favorites?: Set<string>,
  onProgress?: (scanned: number, total: number) => void
): FilterOutput {
  const needSignals = hasAnySignal(filter.signals);
  const needRules = hasAnyRules(filter);
  const needGap = filter.gapMin !== undefined;
  const needKline = needSignals || needRules || needGap;
  const results: FilterResult[] = [];
  let passedBase = 0;
  let skippedNoKline = 0;

  let warning: string | undefined;
  if (needKline && !klineProvider) {
    warning =
      '已设置技术指标条件，但未提供本地 K 线数据，信号条件已被忽略。请先在详情页下载 K 线。';
  }

  // 市值排名映射（排名制分档用）：市值降序，第 1 名市值最大
  let rankMap: Map<string, number> | undefined;
  if (filter.capTiers && filter.capTiers.length > 0) {
    const sorted = [...stocks].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    rankMap = new Map(sorted.map((s, i) => [s.code, i + 1]));
  }

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    // 进度回调（每 200 只报一次，避免频繁 setState）
    if (onProgress && i % 200 === 0) onProgress(i, stocks.length);
    // 仅自选
    if (filter.onlyFavorites && favorites && !favorites.has(stock.code)) continue;
    if (!matchBase(stock, filter, rankMap)) continue;
    passedBase++;

    if (!needKline || !klineProvider) {
      results.push({ stock, hits: [] });
      if (results.length >= limit) break;
      continue;
    }

    const preHits: string[] = [];

    // —— 跳空缺口（日线） ——
    if (needGap) {
      let dailyBars: KlineBar[] | undefined;
      try {
        dailyBars = klineProvider(stock.code, 'daily');
      } catch {
        dailyBars = undefined;
      }
      if (!dailyBars || dailyBars.length < 2) {
        skippedNoKline++;
        continue;
      }
      const g = gapPercent(dailyBars);
      if (g === undefined || g < filter.gapMin!) continue;
      preHits.push(`跳空缺口${g.toFixed(2)}%`);
    }

    // —— 技术指标规则（AND 组合，含适用周期） ——
    if (needRules) {
      const r = matchRules(stock, filter.rules!, klineProvider);
      if (!r.pass) {
        if (r.noData) skippedNoKline++;
        continue;
      }
      preHits.push(...r.hits);
    }

    // —— 旧版扁平 signals（BBI 分组 + 日线信号） ——
    if (needSignals) {
      const sm = matchStockSignals(stock, filter.signals!, klineProvider);
      if (sm.noData) {
        skippedNoKline++;
        continue;
      }
      if (!sm.hit) continue;
      results.push({
        stock,
        snapshot: sm.snapshot,
        hits: [...preHits, ...sm.hits],
      });
      if (results.length >= limit) break;
    } else {
      // 只有 rules / gap（无扁平 signals）
      results.push({ stock, hits: preHits });
      if (results.length >= limit) break;
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