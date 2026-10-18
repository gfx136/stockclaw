/**
 * 技术指标计算库。
 * 对应 StockClaw 的 core/indicators/，按 RN/TS 重新实现。
 *
 * 设计约定：
 * - 全部是**纯函数**，不读取任何外部状态，输入 `number[]` / `KlineBar[]`，输出对齐长度的序列。
 * - 输出序列长度与输入**严格一致**，未进入计算窗口的位置为 `undefined`，
 *   这样调用方可以直接用同一下标同时取 K 线与指标（画图、筛选都方便）。
 * - 计算口径采用国内行情软件（通达信/同花顺系）的通行参数，
 *   与原应用一致：MACD(12,26,9)、KDJ(9,3,3)、RSI(6/14)、BOLL(20,2)、BBI(3,6,12,24)。
 */

import type { IndicatorSeries, IndicatorSnapshot, KlineBar } from '@/types/stock';

/** 空值填充：把长度为 n 的数组全部置 undefined */
function empty(n: number): (number | undefined)[] {
  return new Array<number | undefined>(n).fill(undefined);
}

/** 简单移动平均 SMA */
export function sma(values: number[], period: number): (number | undefined)[] {
  const out = empty(values.length);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * 指数移动平均 EMA。
 * seed：第一项用第一个有效值做种子（国内软件惯例），之后按 α = 2/(period+1) 递推。
 * 与 SMA 不同，EMA 从第 0 项就有值（虽然是弱有效），这里从第 0 项起就填，
 * 保证 MACD 序列从头部就对齐。
 */
export function ema(values: number[], period: number): (number | undefined)[] {
  const out = empty(values.length);
  if (values.length === 0 || period <= 0) return out;
  const alpha = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * 平滑移动平均（通达信 SMA(X, N, M)）：
 *   Y[i] = (M * X[i] + (N - M) * Y[i-1]) / N
 * KDJ 的 K/D 用 SMA(x, 3, 1) 计算。
 */
export function smma(
  values: number[],
  period: number,
  weight = 1
): (number | undefined)[] {
  const out = empty(values.length);
  if (values.length === 0 || period <= 0) return out;
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = (weight * values[i] + (period - weight) * prev) / period;
    out[i] = prev;
  }
  return out;
}

/** 标准差（总体口径，与通达信 STD 一致） */
function stddev(values: number[], period: number): (number | undefined)[] {
  const out = empty(values.length);
  const mean = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    const m = mean[i];
    if (m === undefined) continue;
    let acc = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const d = values[k] - m;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 各指标
 * ------------------------------------------------------------------ */

/** MA：移动平均，可一次算多组周期 */
export function calcMA(
  closes: number[],
  periods: number[] = [5, 10, 20, 60]
): Record<number, (number | undefined)[]> {
  const result: Record<number, (number | undefined)[]> = {};
  for (const p of periods) result[p] = sma(closes, p);
  return result;
}

/**
 * MACD(12, 26, 9)
 *   DIF = EMA(close,12) - EMA(close,26)
 *   DEA = EMA(DIF, 9)
 *   HIST = (DIF - DEA) × 2     ← 国内软件惯例乘 2，与通达信柱状图一致
 */
export function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): IndicatorSeries['macd'] {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif: (number | undefined)[] = empty(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const a = emaFast[i];
    const b = emaSlow[i];
    if (a !== undefined && b !== undefined) dif[i] = a - b;
  }

  // DEA 对 DIF 做 EMA——DIF 头部已全部有值，故 DEA 也全长有值
  const difNums = dif.map((v) => v ?? 0);
  const deaRaw = ema(difNums, signal);
  const dea: (number | undefined)[] = deaRaw.slice() as (number | undefined)[];

  const hist: (number | undefined)[] = empty(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const d = dif[i];
    const e = dea[i];
    if (d !== undefined && e !== undefined) hist[i] = (d - e) * 2;
  }
  return { dif, dea, hist };
}

/**
 * KDJ(9, 3, 3)
 *   RSV = (C - LLV(L,9)) / (HHV(H,9) - LLV(L,9)) × 100
 *   K = SMA(RSV, 3, 1)，D = SMA(K, 3, 1)，J = 3K - 2D
 *   RSV 分母为 0 时（一字板）取 50，避免除零。
 */
export function calcKDJ(
  bars: KlineBar[],
  period = 9,
  kWeight = 1,
  dWeight = 1
): IndicatorSeries['kdj'] {
  const n = bars.length;
  const rsv: number[] = new Array(n).fill(50);
  for (let i = 0; i < n; i++) {
    if (i < period - 1) {
      rsv[i] = 50; // 窗口未满，用中性值占位，后续 K/D 自然收敛
      continue;
    }
    let hh = -Infinity;
    let ll = Infinity;
    for (let k = i - period + 1; k <= i; k++) {
      if (bars[k].high > hh) hh = bars[k].high;
      if (bars[k].low < ll) ll = bars[k].low;
    }
    const denom = hh - ll;
    rsv[i] = denom === 0 ? 50 : ((bars[i].close - ll) / denom) * 100;
  }

  // K/D 从窗口首次填满的位置开始递推，之前保持 undefined，避免前段被中性值污染。
  // 递推式即通达信 SMA(X, 3, 1)：Y = (X + 2·Y_prev) / 3
  const k = empty(n);
  const d = empty(n);
  const j = empty(n);
  const start = period - 1;
  let kPrev = 50;
  let dPrev = 50;
  for (let i = 0; i < n; i++) {
    if (i < start) continue;
    if (i === start) {
      kPrev = 50; // 起始中性
      dPrev = 50;
    }
    kPrev = (kWeight * rsv[i] + (3 - kWeight) * kPrev) / 3;
    dPrev = (dWeight * kPrev + (3 - dWeight) * dPrev) / 3;
    k[i] = kPrev;
    d[i] = dPrev;
    j[i] = 3 * kPrev - 2 * dPrev;
  }
  return { k, d, j };
}

/**
 * RSI(N) —— Wilder 平滑口径
 *   上涨均值 / 下跌均值用 SMA(X, N, 1) 递推（等价于 Wilder 平滑）
 *   RSI = 100 × up / (up + down)；分母为 0 时取 50（无波动）
 */
export function calcRSI(values: number[], period = 14): (number | undefined)[] {
  const n = values.length;
  const out = empty(n);
  if (n <= period) return out;

  const gains: number[] = new Array(n).fill(0);
  const losses: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = values[i] - values[i - 1];
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }

  // 首个 RSI 用前 period 根的简单平均做种子
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  const total = avgGain + avgLoss;
  if (total === 0) return 50;
  return (100 * avgGain) / total;
}

/**
 * BOLL(20, 2)
 *   中轨 = MA(close, 20)，上/下轨 = 中轨 ± 2 × STD(close, 20)
 */
export function calcBOLL(
  closes: number[],
  period = 20,
  mult = 2
): IndicatorSeries['boll'] {
  const mid = sma(closes, period);
  const sd = stddev(closes, period);
  const upper = empty(closes.length);
  const lower = empty(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const m = mid[i];
    const s = sd[i];
    if (m !== undefined && s !== undefined) {
      upper[i] = m + mult * s;
      lower[i] = m - mult * s;
    }
  }
  return { mid, upper, lower };
}

/**
 * BBI —— 多空指标：四条均线的平均值
 *   BBI = (MA3 + MA6 + MA12 + MA24) / 4
 */
export function calcBBI(closes: number[]): (number | undefined)[] {
  const m3 = sma(closes, 3);
  const m6 = sma(closes, 6);
  const m12 = sma(closes, 12);
  const m24 = sma(closes, 24);
  const out = empty(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const a = m3[i];
    const b = m6[i];
    const c = m12[i];
    const d = m24[i];
    if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
      out[i] = (a + b + c + d) / 4;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

/** 一次性算出全部指标 */
export function calcAllIndicators(
  bars: KlineBar[],
  maPeriods: number[] = [5, 10, 20, 60],
  rsiPeriods: number[] = [6, 14]
): IndicatorSeries {
  const closes = bars.map((b) => b.close);
  const rsi: Record<number, (number | undefined)[]> = {};
  for (const p of rsiPeriods) rsi[p] = calcRSI(closes, p);
  return {
    ma: calcMA(closes, maPeriods),
    macd: calcMACD(closes),
    kdj: calcKDJ(bars),
    rsi,
    boll: calcBOLL(closes),
    bbi: calcBBI(closes),
  };
}

/** 取序列末项（跳过尾部 undefined） */
function last<T>(arr: (T | undefined)[]): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== undefined) return arr[i];
  }
  return undefined;
}

/** 取序列倒数第 k 项（k=0 为末项），跳过尾部 undefined 后再倒数 */
function nthLast<T>(arr: (T | undefined)[], k: number): T | undefined {
  const vals = arr.filter((v): v is T => v !== undefined);
  const idx = vals.length - 1 - k;
  return idx >= 0 ? vals[idx] : undefined;
}

/** 抽取指定下标处的指标快照；index 省略则取末项 */
export function snapshotAt(
  series: IndicatorSeries,
  bars: KlineBar[],
  index?: number
): IndicatorSnapshot {
  if (bars.length === 0) return {};
  const i = index ?? bars.length - 1;
  const pick = <T>(arr: (T | undefined)[]): T | undefined => arr[i];

  return {
    ma5: pick(series.ma[5]),
    ma10: pick(series.ma[10]),
    ma20: pick(series.ma[20]),
    ma60: pick(series.ma[60]),
    dif: pick(series.macd.dif),
    dea: pick(series.macd.dea),
    macdHist: pick(series.macd.hist),
    k: pick(series.kdj.k),
    d: pick(series.kdj.d),
    j: pick(series.kdj.j),
    rsi6: pick(series.rsi[6]),
    rsi14: pick(series.rsi[14]),
    bollMid: pick(series.boll.mid),
    bollUpper: pick(series.boll.upper),
    bollLower: pick(series.boll.lower),
    bbi: pick(series.bbi),
  };
}

export { last, nthLast };