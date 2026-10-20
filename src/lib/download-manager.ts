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
  /**
   * 准备阶段（问题1修复）：正在取股票列表 / 统计待下载数量。
   * 这个阶段可能持续数秒（网络请求 + 读断点），若不显示状态，
   * 用户点完「下载」会觉得毫无反应。
   */
  preparing: boolean;
  done: number;
  total: number;
  failed: number;
  current: string;
  lastRunAt: number | null;
  /** 预计剩余秒（滚动平均） */
  etaSec: number | null;
  /** 本次运行结束后的结果（用于给出明确反馈） */
  lastResult: 'done' | 'up-to-date' | 'stopped' | null;
  /** 已存在本地数据的股票数（用于「已是最新」提示） */
  skipped: number;
}

let state: DownloadState = {
  running: false, paused: false, preparing: false, done: 0, total: 0, failed: 0,
  current: '', lastRunAt: null, etaSec: null, lastResult: null, skipped: 0,
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
  // ⚠️ 只拦「真正在跑」的情况。不能拦 preparing——因为调用方可能是
  //    beginPreparing() 之后紧接着调本函数（日常增量路径），
  //    若此处拦 preparing 会导致自己把自己挡住、下载永远不启动。
  if (state.running) return;
  stopFlag = false;
  pauseFlag = false;

  // 问题1修复①：先进入「准备中」状态并立刻通知 UI，
  // 否则读断点/统计待下载数量的这几秒里用户看不到任何反馈。
  state = { ...state, preparing: true, lastResult: null, done: 0, failed: 0, etaSec: null };
  notify();

  const doneSet = await loadDoneSet();
  const todo = stocks.filter((s) => !doneSet.has(s.code));
  const alreadyHad = stocks.length - todo.length;

  if (todo.length === 0) {
    // 问题1修复②：全部已下载时不再静默返回，而是给出明确的「已是最新」反馈。
    state = {
      ...state, preparing: false, running: false, lastResult: 'up-to-date',
      skipped: alreadyHad, total: stocks.length, done: 0, failed: 0, lastRunAt: Date.now(),
    };
    notify();
    try { await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify({ at: Date.now(), count: 0 })); } catch { /* ignore */ }
    return;
  }

  const concurrency = opts?.background ? BACKGROUND_CONCURRENCY : FOREGROUND_CONCURRENCY;
  const startTs = Date.now();
  state = {
    running: true, paused: false, preparing: false, done: 0, total: todo.length, failed: 0,
    current: '', lastRunAt: state.lastRunAt, etaSec: null, lastResult: null, skipped: alreadyHad,
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
  // 结束时给出明确结果（问题1修复③）：完成 / 被用户停止
  state = {
    ...state, running: false, paused: false, preparing: false, current: '', etaSec: null,
    lastRunAt: Date.now(), lastResult: stopFlag ? 'stopped' : 'done',
  };
  notify();
}

export function pauseDownload(): void {
  pauseFlag = true;
  state.paused = true;
  notify();
}

/**
 * 进入「准备中」状态（问题1修复）。
 * 调用方在开始取股票列表**之前**调用，让进度条立即出现，
 * 避免「点了下载但几秒内毫无反应」。若随后未真正开始下载（如用户取消），
 * 必须调用 endPreparing() 复位。
 */
export function beginPreparing(): void {
  if (state.running) return;
  state = { ...state, preparing: true, lastResult: null, done: 0, failed: 0, total: 0, etaSec: null };
  notify();
}

/** 退出「准备中」状态（未进入实际下载时调用） */
export function endPreparing(): void {
  if (state.running) return; // 已转入实际下载，不做复位
  state = { ...state, preparing: false };
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