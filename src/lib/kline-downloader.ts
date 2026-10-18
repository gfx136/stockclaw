/**
 * K 线下载器。
 * 对应 StockClaw 的 core/api/kline_downloader.dart。
 *
 * 职责：从东财拉 K 线 → 写入本地缓存 → 返回结果统计。
 * 支持限速（串行 + 间隔），避免批量下载时被限流。
 */

import { fetchKlines } from '@/lib/api/failover';
import { loadKlines, saveKlines, getLastUpdate } from '@/lib/kline-db';
import type { KlineBar, KlinePeriod } from '@/types/stock';

export interface DownloadResult {
  code: string;
  period: KlinePeriod;
  /** 本次写入根数 */
  fetched: number;
  /** 本地缓存后总根数 */
  cached: number;
  ok: boolean;
  error?: string;
}

/**
 * 下载单只股票某周期的 K 线并落库。
 *
 * @param incremental 增量模式：本地已有数据时，只补最新部分并覆盖（默认 true）。
 *                    东财接口本身按 lmt 取最近 N 根，所以增量 = 重新拉最近 N 根覆盖。
 */
export async function downloadKlines(
  code: string,
  period: KlinePeriod = 'daily',
  limit = 500,
  incremental = true
): Promise<DownloadResult> {
  try {
    if (incremental) {
      const last = await getLastUpdate(code, period);
      // 已有数据且今天更新过 → 跳过（行情当日不会变）
      if (last !== null && isSameDay(last * 1000, Date.now())) {
        const cached = await loadKlines(code, period, 100000);
        return { code, period, fetched: 0, cached: cached.length, ok: true };
      }
    }

    const bars = await fetchKlines(code, period, limit);
    if (bars.length === 0) {
      return { code, period, fetched: 0, cached: 0, ok: false, error: '接口返回空数据' };
    }
    await saveKlines(code, period, bars);
    const cached = await loadKlines(code, period, 100000);
    return { code, period, fetched: bars.length, cached: cached.length, ok: true };
  } catch (e) {
    return {
      code,
      period,
      fetched: 0,
      cached: 0,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 批量下载（串行 + 可调间隔），带进度回调 */
export async function downloadBatch(
  codes: string[],
  period: KlinePeriod = 'daily',
  limit = 500,
  onProgress?: (done: number, total: number, result: DownloadResult) => void,
  gapMs = 120
): Promise<DownloadResult[]> {
  const out: DownloadResult[] = [];
  for (let i = 0; i < codes.length; i++) {
    const r = await downloadKlines(codes[i], period, limit);
    out.push(r);
    onProgress?.(i + 1, codes.length, r);
    if (gapMs > 0 && i < codes.length - 1) {
      await sleep(gapMs);
    }
  }
  return out;
}

/**
 * 下载多周期（60分钟/日/周/月）——详情页「下载」按钮用。
 */
export async function downloadAllPeriods(
  code: string,
  limit = 500
): Promise<DownloadResult[]> {
  const periods: KlinePeriod[] = ['60min', 'daily', 'weekly', 'monthly'];
  const out: DownloadResult[] = [];
  for (const p of periods) {
    out.push(await downloadKlines(code, p, limit));
    await sleep(120);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** 判断本地 K 线是否是「今天的最新」（用于 UI 提示数据新鲜度） */
export async function isFresh(
  code: string,
  period: KlinePeriod = 'daily'
): Promise<boolean> {
  const last = await getLastUpdate(code, period);
  if (last === null) return false;
  return isSameDay(last * 1000, Date.now());
}

/** 便利函数：取 K 线，本地优先，缺失则现拉 */
export async function getKlinesWithFallback(
  code: string,
  period: KlinePeriod = 'daily',
  limit = 500
): Promise<KlineBar[]> {
  const cached = await loadKlines(code, period, limit);
  if (cached.length >= 30) return cached;
  const r = await downloadKlines(code, period, limit);
  if (!r.ok) return cached;
  return loadKlines(code, period, limit);
}