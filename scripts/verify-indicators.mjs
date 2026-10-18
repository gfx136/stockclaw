/**
 * 技术指标计算库的自检脚本（纯 Node，不依赖 RN）。
 *
 * 目的：验证 MA/MACD/KDJ/RSI/BOLL/BBI 的计算口径正确，
 * 特别是与国内行情软件对齐的参数（MACD 柱 ×2、KDJ 的 SMA(3,1) 递推、RSI 的 Wilder 平滑）。
 *
 * 运行：node verify-indicators.mjs
 */

/* ---------- 从 indicators.ts 复刻的算法（保持同步） ---------- */

function empty(n) {
  return new Array(n).fill(undefined);
}

function sma(values, period) {
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

function ema(values, period) {
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

function stddev(values, period) {
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

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = empty(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const a = emaFast[i];
    const b = emaSlow[i];
    if (a !== undefined && b !== undefined) dif[i] = a - b;
  }
  const dea = ema(dif.map((v) => v ?? 0), signal).slice();
  const hist = empty(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const d = dif[i];
    const e = dea[i];
    if (d !== undefined && e !== undefined) hist[i] = (d - e) * 2;
  }
  return { dif, dea, hist };
}

function calcKDJ(bars, period = 9) {
  const n = bars.length;
  const rsv = new Array(n).fill(50);
  for (let i = 0; i < n; i++) {
    if (i < period - 1) {
      rsv[i] = 50;
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
  const k = empty(n);
  const d = empty(n);
  const j = empty(n);
  const start = period - 1;
  let kPrev = 50;
  let dPrev = 50;
  for (let i = 0; i < n; i++) {
    if (i < start) continue;
    if (i === start) {
      kPrev = 50;
      dPrev = 50;
    }
    kPrev = (rsv[i] + 2 * kPrev) / 3;
    dPrev = (kPrev + 2 * dPrev) / 3;
    k[i] = kPrev;
    d[i] = dPrev;
    j[i] = 3 * kPrev - 2 * dPrev;
  }
  return { k, d, j };
}

function rsiFrom(g, l) {
  const t = g + l;
  return t === 0 ? 50 : (100 * g) / t;
}

function calcRSI(values, period = 14) {
  const n = values.length;
  const out = empty(n);
  if (n <= period) return out;
  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = values[i] - values[i - 1];
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }
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

function calcBOLL(closes, period = 20, mult = 2) {
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

function calcBBI(closes) {
  const m3 = sma(closes, 3);
  const m6 = sma(closes, 6);
  const m12 = sma(closes, 12);
  const m24 = sma(closes, 24);
  const out = empty(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const a = m3[i],
      b = m6[i],
      c = m12[i],
      d = m24[i];
    if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
      out[i] = (a + b + c + d) / 4;
    }
  }
  return out;
}

/* ---------- 测试 ---------- */

let pass = 0;
let fail = 0;

function check(name, actual, expected, tol = 1e-6) {
  const ok =
    typeof expected === 'number'
      ? Math.abs(actual - expected) < tol
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      实际: ${actual}\n      期望: ${expected}`);
  }
}

function approx(name, a, b, tol = 0.01) {
  check(name, Math.abs(a - b) < tol ? 1 : 0, 1);
}

console.log('\n【1】SMA — 简单移动平均');
{
  const v = [1, 2, 3, 4, 5];
  const m3 = sma(v, 3);
  check('前 2 项为 undefined', m3.slice(0, 2), [undefined, undefined]);
  check('MA3[2] = (1+2+3)/3 = 2', m3[2], 2);
  check('MA3[3] = (2+3+4)/3 = 3', m3[3], 3);
  check('MA3[4] = (3+4+5)/3 = 4', m3[4], 4);
}

console.log('\n【2】EMA — 指数移动平均（alpha=2/(n+1)）');
{
  const v = [10, 20, 30];
  const e = ema(v, 3);
  check('EMA 首项 = 首值', e[0], 10);
  // alpha = 0.5; e1 = 0.5*20 + 0.5*10 = 15
  check('EMA[1] = 15', e[1], 15);
  // e2 = 0.5*30 + 0.5*15 = 22.5
  check('EMA[2] = 22.5', e[2], 22.5);
}

console.log('\n【3】MACD — 柱值须 ×2（国内软件口径）');
{
  // 构造 60 根递增价格
  const closes = Array.from({ length: 60 }, (_, i) => 10 + i * 0.5);
  const { dif, dea, hist } = calcMACD(closes);
  const i = closes.length - 1;
  // 单调递增 → DIF 应为正
  approx('上涨趋势 DIF > 0', dif[i] > 0 ? 1 : 0, 1);
  // 核心：hist 必须等于 (dif-dea)*2
  check('hist = (dif-dea)*2', hist[i], (dif[i] - dea[i]) * 2, 1e-9);
  // 若误用 ×1 口径，hist 会等于 dif-dea，此处应不为该值（除非差为 0）
  const wrong = Math.abs(hist[i] - (dif[i] - dea[i]));
  if (Math.abs(dif[i] - dea[i]) > 1e-6) {
    check('★ 确认不是 ×1 口径', wrong > 1e-6 ? 1 : 0, 1);
  }
}

console.log('\n【4】KDJ — SMA(3,1) 递推，K/D 首值 50');
{
  const bars = Array.from({ length: 40 }, (_, i) => ({
    open: 10 + i * 0.2,
    high: 10.5 + i * 0.2,
    low: 9.5 + i * 0.2,
    close: 10.2 + i * 0.2,
  }));
  const { k, d, j } = calcKDJ(bars, 9);
  // 前 8 项应为 undefined
  check('前 8 项 undefined（窗口 9 未满）', k.slice(0, 8), new Array(8).fill(undefined));
  // 第 9 项（idx 8）手工验算：
  //   窗口 bars[0..8]：hh = 10.5+8*0.2 = 12.1，ll = 9.5，close = 11.8
  //   RSV = (11.8-9.5)/(12.1-9.5)*100 = 88.46
  //   K = (88.46 + 2*50)/3 = 62.82 ；D = (62.82 + 2*50)/3 = 54.27
  approx('K[8] ≈ 62.82', k[8], 62.82, 0.05);
  approx('D[8] ≈ 54.27', d[8], 54.27, 0.05);
  // J = 3K - 2D
  check('J = 3K - 2D', j[8], 3 * k[8] - 2 * d[8], 1e-9);
  // 价格线性上移 → 每个窗口的 RSV 恒为 88.46，K 应收敛到 88.46
  approx('K 收敛到 RSV=88.46', k[39], 88.46, 0.1);
  approx('K 末值 > 起点（趋势向上使 K 抬升）', k[39] > k[8] ? 1 : 0, 1);
}

console.log('\n【5】RSI — Wilder 平滑，单调上涨应趋近 100');
{
  const up = Array.from({ length: 30 }, (_, i) => 10 + i);
  const upRsi = calcRSI(up, 14);
  approx('单调上涨 RSI ≈ 100', Math.abs(upRsi[29] - 100) < 0.01 ? 1 : 0, 1);

  const down = Array.from({ length: 30 }, (_, i) => 40 - i);
  const downRsi = calcRSI(down, 14);
  approx('单调下跌 RSI ≈ 0', Math.abs(downRsi[29] - 0) < 0.01 ? 1 : 0, 1);

  const flat = new Array(30).fill(10);
  const flatRsi = calcRSI(flat, 14);
  approx('横盘 RSI = 50（无涨无跌）', flatRsi[29], 50);
}

console.log('\n【6】BOLL — 中轨 = MA20，上下轨对称');
{
  const closes = Array.from({ length: 40 }, (_, i) => 20 + Math.sin(i / 3) * 3);
  const { mid, upper, lower } = calcBOLL(closes, 20, 2);
  const i = closes.length - 1;
  const m20 = sma(closes, 20);
  check('中轨 = MA20', mid[i], m20[i], 1e-9);
  // 上下轨关于中轨对称
  check('上下轨关于中轨对称', upper[i] - mid[i], mid[i] - lower[i], 1e-9);
  // 上下轨间距 = 4σ
  const sd = stddev(closes, 20);
  check('上轨 - 下轨 = 4σ', upper[i] - lower[i], 4 * sd[i], 1e-9);
}

console.log('\n【7】BBI — 四条均线均值');
{
  const closes = Array.from({ length: 40 }, (_, i) => 10 + i * 0.3);
  const bbi = calcBBI(closes);
  const i = closes.length - 1;
  const m3 = sma(closes, 3)[i];
  const m6 = sma(closes, 6)[i];
  const m12 = sma(closes, 12)[i];
  const m24 = sma(closes, 24)[i];
  check('BBI = (MA3+MA6+MA12+MA24)/4', bbi[i], (m3 + m6 + m12 + m24) / 4, 1e-9);
  // 单调上涨 → BBI 应低于最新价
  approx('上涨趋势 BBI < 最新收盘', bbi[i] < closes[i] ? 1 : 0, 1);
}

console.log('\n【8】边界条件');
{
  check('空数组 SMA 返回空', sma([], 5).length, 0);
  check('数据不足 SMA 全 undefined', sma([1, 2], 5), [undefined, undefined]);
  check('空数组 RSI 返回空', calcRSI([], 14).length, 0);
  const flatBars = Array.from({ length: 20 }, () => ({
    open: 10,
    high: 10,
    low: 10,
    close: 10,
  }));
  const { k } = calcKDJ(flatBars, 9);
  approx('一字板 KDJ K = 50（除零保护）', k[19], 50, 0.5);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));

process.exit(fail > 0 ? 1 : 0);