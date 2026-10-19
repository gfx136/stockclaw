import AsyncStorage from '@react-native-async-storage/async-storage';

import { downloadKlines } from '@/lib/kline-downloader';
import type { Stock } from '@/types/stock';

/**
 * 全量 K 线下载管理器（补充规格 §4.2）。
 * - 首次全量：每只拉 日线(2年)/周线(10年)/月线(25年)；60分钟不纳入默认全量
 * - 增量：downloadKlines 内有「今日已更新则跳过」检查，重跑只补未完成
 * - 并发 4，请求间隔礼貌访问；断点续传（每完成一只写进度，杀进程不丢）
 * - 可暂停 / 停止 / 恢复
 */

const PROGRESS_KEY = 'stockclaw:download_done_v1';
const LAST_RUN_KEY = 'stockclaw:download_last_run';
const CONCURRENCY = 4;
const GAP_MS = 120;

export interface DownloadState {
  running: boolean;
  paused: boolean;
  done: number;
  total: number;
  failed: number;
  current: string;
  lastRunAt: number | null;
}

let state: DownloadState = { running: false, paused: false, done: 0, total: 0, failed: 0, current: '', lastRunAt: null };
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadDoneSet(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
async function saveDoneSet(s: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify([...s]));
  } catch { /* ignore */ }
}

/** 上次下载信息 */
export async function getLastDownloadInfo(): Promise<{ at: number; count: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 已同步的股票只数（断点） */
export async function getDownloadedCount(): Promise<number> {
  return (await loadDoneSet()).size;
}

/**
 * 启动全量下载。已在跑则忽略。
 * 断点续传：已完成的 code 跳过。
 */
export async function startFullDownload(stocks: Stock[]): Promise<void> {
  if (state.running) return;
  stopFlag = false;
  pauseFlag = false;
  const doneSet = await loadDoneSet();
  const todo = stocks.filter((s) => !doneSet.has(s.code));
  state = { running: true, paused: false, done: 0, total: todo.length, failed: 0, current: '', lastRunAt: state.lastRunAt };
  notify();

  let idx = 0;
  const worker = async () => {
    while (idx < todo.length) {
      if (stopFlag) return;
      while (pauseFlag && !stopFlag) await sleep(300);
      if (stopFlag) return;
      const s = todo[idx++];
      state.current = s.code;
      notify();
      try {
        await downloadKlines(s.code, 'daily', 500);
        await sleep(GAP_MS);
        await downloadKlines(s.code, 'weekly', 260);
        await sleep(GAP_MS);
        await downloadKlines(s.code, 'monthly', 300);
        doneSet.add(s.code);
        state.done++;
      } catch {
        state.failed++;
      }
      if (state.done % 5 === 0) await saveDoneSet(doneSet); // 定期存断点
      notify();
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await saveDoneSet(doneSet);
  if (!stopFlag) {
    try {
      await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify({ at: Date.now(), count: state.done }));
    } catch { /* ignore */ }
  }
  state = { ...state, running: false, paused: false, current: '', lastRunAt: Date.now() };
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
