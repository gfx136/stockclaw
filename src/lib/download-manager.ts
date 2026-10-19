import AsyncStorage from '@react-native-async-storage/async-storage';

import { downloadKlines } from '@/lib/kline-downloader';
import { dbStats } from '@/lib/kline-db';
import type { Stock } from '@/types/stock';

/**
 * 全量 K 线下载管理器（补充规格 v1.2 §6.2，规格 C12）。
 *
 * 目标产品形态：**单队列串行 + 缓存 + 断点续传，不存在多核并行**。
 * iOS 版实现规格：
 * - 默认并发 4（信号量 + 滑动窗口，非分批等待）
 * - 同一数据源最多 4 在途；每只请求间隔 ≥50ms
 * - 跨源串行（新浪→腾讯→东财，由 downloadKlines 内部 failover 处理）
 * - 每只最多重试 2 次，退避 1s / 3s
 * - 每完成 20 只批量写库 + 更新断点
 * - 断点续传：持久化已完成股票 ID 集合
 * - 后台（BGProcessingTask）降为 2 并发
 */

const DONE_KEY = 'stockclaw:download_done_v1';
const LAST_RUN_KEY = 'stockclaw:download_last_run';
const FOREGROUND_CONCURRENCY = 4;
const BACKGROUND_CONCURRENCY = 2;
const GAP_MS = 50;
const BATCH_SIZE = 20;
const RETRY_DELAYS = [1000, 3000];

export interface DownloadState {
  running: boolean;
  paused: boolean;
  done: number;
  total: number;
  failed: number;
  current: string;
  lastRunAt: number | null;
  /** 预计剩余秒（滚动平均） */
  etaSec: number | null;
}

let state: DownloadState = {
  running: false, paused: false, done: 0, total: 0, failed: 0, current: '', lastRunAt: null, etaSec: null,
};
const listeners = new Set<() => void>();
function notify() {
  state = { ...state };
  listeners.forEach((l) => l());
}
export function subscribeDownload(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getDownloadState(): DownloadState {
  return state;
}

let stopFlag = false;
let pauseFlag = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadDoneSet(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DONE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
async function saveDoneSet(s: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(DONE_KEY, JSON.stringify([...s]));
  } catch { /* ignore */ }
}

export async function getLastDownloadInfo(): Promise<{ at: number; count: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function getDownloadedCount(): Promise<number> {
  return (await loadDoneSet()).size;
}

/** 清空断点（配合「清空全部本地数据」） */
export async function clearDownloadCursor(): Promise<void> {
  try { await AsyncStorage.removeItem(DONE_KEY); } catch { /* ignore */ }
}

/**
 * 启动全量/增量下载（信号量滑动窗口）。
 * @param stocks 目标股票
 * @param opts.background 后台模式（并发降为 2）
 */
export async function startFullDownload(stocks: Stock[], opts?: { background?: boolean }): Promise<void> {
  if (state.running) return;
  stopFlag = false;
  pauseFlag = false;
  const doneSet = await loadDoneSet();
  const todo = stocks.filter((s) => !doneSet.has(s.code));
  if (todo.length === 0) {
    state = { ...state, lastRunAt: Date.now() };
    notify();
    return;
  }
  const concurrency = opts?.background ? BACKGROUND_CONCURRENCY : FOREGROUND_CONCURRENCY;
  const startTs = Date.now();
  state = {
    running: true, paused: false, done: 0, total: todo.length, failed: 0,
    current: '', lastRunAt: state.lastRunAt, etaSec: null,
  };
  notify();

  let idx = 0;
  let sinceWrite = 0;

  // 单只下载（含重试退避）
  const fetchOne = async (code: string): Promise<boolean> => {
    const periods = [
      { p: 'daily' as const, n: 500 },
      { p: 'weekly' as const, n: 260 },
      { p: 'monthly' as const, n: 300 },
    ];
    for (const { p, n } of periods) {
      let ok = false;
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          await downloadKlines(code, p, n);
          ok = true;
          break;
        } catch {
          if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt]);
        }
      }
      if (!ok) return false;
      await sleep(GAP_MS); // 礼貌访问间隔
    }
    return true;
  };

  // 信号量滑动窗口：每完成一只立即补入下一只
  const worker = async () => {
    while (idx < todo.length) {
      if (stopFlag) return;
      while (pauseFlag && !stopFlag) await sleep(300);
      if (stopFlag) return;
      const myIdx = idx++;
      const s = todo[myIdx];
      state.current = s.code;
      notify();
      const ok = await fetchOne(s.code);
      if (ok) {
        doneSet.add(s.code);
        state.done++;
      } else {
        state.failed++;
      }
      sinceWrite++;
      if (sinceWrite >= BATCH_SIZE) {
        sinceWrite = 0;
        await saveDoneSet(doneSet); // 每 20 只批量写库 + 断点
      }
      const elapsed = (Date.now() - startTs) / 1000;
      const rate = state.done / Math.max(1, elapsed);
      state.etaSec = rate > 0 ? Math.round((todo.length - state.done) / rate) : null;
      notify();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await saveDoneSet(doneSet);
  if (!stopFlag) {
    try { await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify({ at: Date.now(), count: state.done })); } catch { /* ignore */ }
  }
  state = { ...state, running: false, paused: false, current: '', lastRunAt: Date.now(), etaSec: null };
  notify();
}

export function pauseDownload(): void {
  pauseFlag = true;
  state.paused = true;
  notify();
}
export function resumeDownload(): void {
  pauseFlag = false;
  state.paused = false;
  notify();
}
export function stopDownload(): void {
  stopFlag = true;
  pauseFlag = false;
}
export function isDownloading(): boolean {
  return state.running;
}

/** 是否已有本地数据（决定首次全量 vs 日常增量） */
export async function hasLocalData(): Promise<boolean> {
  const s = await dbStats();
  return s.codes > 0;
}