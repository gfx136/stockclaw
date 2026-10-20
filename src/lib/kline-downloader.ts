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
 * 会话级「刚拉过」记忆。
 * `getLastUpdate` 存的是**最后一根 K 线的时间戳**，不是抓取时间：
 * 周线/月线的最新 bar 可能是本周一/本月 1 号，永远不等于今天，
 * 于是 `isSameDay` 永远不成立 → 每切一次周期就重拉一次周线/月线。
 * 这里用内存表兜住，5 分钟内同一 code+period 不重复请求。
 */
const fetchedAt = new Map<string, number>();
const SESSION_TTL_MS = 5 * 60 * 1000;

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
    const key = `${code}:${period}`;
    if (incremental) {
      const last = await getLastUpdate(code, period);
      const justFetched = Date.now() - (fetchedAt.get(key) ?? 0) < SESSION_TTL_MS;
      // 已有数据且（今天更新过 或 本会话刚拉过）→ 跳过（行情当日不会变）
      if (last !== null && (justFetched || isSameDay(last * 1000, Date.now()))) {
        const cached = await loadKlines(code, period, 100000);
        if (cached.length > 0) {
          return { code, period, fetched: 0, cached: cached.length, ok: true };
        }
      }
    }

    const bars = await fetchKlines(code, period, limit);
    if (bars.length === 0) {
      // 接口返回空：若本地本来就有数据，不能因此把这只股票判成「失败」——
      // 全量下载的 fetchOne 会据此把股票标记为未完成、断点反复重试。
      const cachedRows = await loadKlines(code, period, 100000);
      if (cachedRows.length > 0) {
        return { code, period, fetched: 0, cached: cachedRows.length, ok: true };
      }
      return { code, period, fetched: 0, cached: 0, ok: false, error: '接口返回空数据' };
    }
    await saveKlines(code, period, bars);
    fetchedAt.set(key, Date.now());
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
 * 这是显式动作，强制重拉（incremental=false），不能因为"今天已经更新过"就跳过。
 */
export async function downloadAllPeriods(
  code: string,
  limit = 500
): Promise<DownloadResult[]> {
  const periods: KlinePeriod[] = ['60min', 'daily', 'weekly', 'monthly'];
  const out: DownloadResult[] = [];
  for (const p of periods) {
    out.push(await downloadKlines(code, p, limit, false));
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

/* ------------------------------------------------------------------ *
 * 个股「打开即后台更新」（用户需求3）
 *
 * 点开个股后静默把该股 4 个周期都补/更新一遍，不阻塞界面、不弹任何提示。
 * · 同一只股票同时只跑一次（快速连点左右箭头切股时不会叠加请求）
 * · 复用 downloadKlines 的 incremental 逻辑：当天已更新过的周期直接跳过，
 *   所以已全量下载过的股票打开时几乎零网络开销
 * · 单周期失败不影响其它周期
 * ------------------------------------------------------------------ */

const refreshInflight = new Map<string, Promise<boolean>>();

/**
 * 后台刷新某只股票的全部周期。
 * @returns 是否**确实有新数据写入**（true 时调用方可以重绘图表）
 */
export function refreshStockKlines(code: string, dailyLimit = 800): Promise<boolean> {
  const running = refreshInflight.get(code);
  if (running) return running;

  const job = (async (): Promise<boolean> => {
    let changed = false;
    const plan: { p: KlinePeriod; n: number }[] = [
      { p: 'daily', n: dailyLimit },
      { p: '60min', n: Math.min(dailyLimit, 400) },
      { p: 'weekly', n: 300 },
      { p: 'monthly', n: 240 },
    ];
    for (const { p, n } of plan) {
      try {
        const r = await downloadKlines(code, p, n, true);
        if (r.ok && r.fetched > 0) changed = true;
      } catch {
        /* 单个周期失败：保持已有本地数据，继续下一个周期 */
      }
      await sleep(80); // 礼貌间隔，避免连点切股时打爆接口
    }
    return changed;
  })();

  refreshInflight.set(code, job);
  void job.finally(() => {
    if (refreshInflight.get(code) === job) refreshInflight.delete(code);
  });
  return job;
}

/** 某只股票是否正在后台刷新（UI 可选展示小菊花用） */
export function isRefreshing(code: string): boolean {
  return refreshInflight.has(code);
}