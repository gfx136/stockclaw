import { fetchAllStocks } from '@/lib/api/failover';
import { loadFavorites } from '@/lib/favorites';
import { filterStocks, type KlineProvider } from '@/lib/filter-engine';
import { getFilterState, setFilterOutput, setFilterRunning } from '@/lib/filter-store';
import { multiPeriodProvider, preloadKlineMap } from '@/lib/kline-db';
import type { FilterSet, KlinePeriod } from '@/types/stock';

/**
 * 筛选执行器（用户反馈3）。
 *
 * 之前的实现：`run()` 直接在筛选面板组件里跑，`filterStocks` 是同步大循环，
 * 整个过程中 JS 线程被占满，`setMsg` 的进度文案根本刷不出来，界面只有一个小菊花；
 * 一旦关掉面板（组件卸载），`finally` 里还会把 running 复位，等于筛选被"取消"。
 *
 * 现在把执行过程提到模块级单例：
 * - 有阶段化进度（拉行情 → 载本地K线 → 逐只比对 → 整理），可画真实进度条；
 * - 面板关掉也继续跑（后台运行）；结果页读同一份状态画顶部进度条；
 * - 同一时刻只允许一个筛选任务（重复点运行不会叠加）。
 */

export type FilterStage = 'idle' | 'stocks' | 'kline' | 'scan' | 'finishing' | 'done' | 'error';

export interface FilterRunState {
  running: boolean;
  stage: FilterStage;
  /** 0~100，供进度条直接用 */
  percent: number;
  scanned: number;
  total: number;
  /** 正在加载的周期（i18n key），仅 stage==='kline' 时有值 */
  periodKey?: string;
  /** 失败原因 */
  message?: string;
  /** 命中只数 */
  resultCount?: number;
  startedAt?: number;
  finishedAt?: number;
}

const IDLE: FilterRunState = { running: false, stage: 'idle', percent: 0, scanned: 0, total: 0 };

let state: FilterRunState = IDLE;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function patch(p: Partial<FilterRunState>) {
  state = { ...state, ...p };
  emit();
}

export function subscribeFilterRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFilterRunState(): FilterRunState {
  return state;
}

const PERIOD_KEY: Record<KlinePeriod, string> = {
  '60min': 'filter_period60m',
  daily: 'filter_periodDaily',
  weekly: 'filter_periodWeekly',
  monthly: 'filter_periodMonthly',
};

/** 本次筛选需要哪些周期的 K 线 */
export function neededPeriods(filter: FilterSet): Set<KlinePeriod> {
  const s = new Set<KlinePeriod>();
  if (filter.gapMin !== undefined) s.add('daily');
  for (const r of filter.rules ?? []) {
    for (const p of r.periods ?? ['daily']) s.add(p);
  }
  return s;
}

/** 进度条文案（供筛选面板与结果页共用） */
export function runStageText(
  s: FilterRunState,
  t: (k: never) => string,
  tf: (k: never, p: Record<string, string | number>) => string
): string {
  const T = t as (k: string) => string;
  const TF = tf as (k: string, p: Record<string, string | number>) => string;
  switch (s.stage) {
    case 'stocks':
      return T('filter_stageStocks');
    case 'kline':
      return TF('filter_stageKline', { label: T(s.periodKey ?? 'filter_periodDaily') });
    case 'scan':
      return TF('filter_stageScan', { scanned: s.scanned, total: s.total });
    case 'finishing':
      return T('filter_stageFinishing');
    case 'done':
      return TF('filter_done', { n: s.resultCount ?? 0 });
    case 'error':
      return s.message ?? T('filter_failed');
    default:
      return T('filter_running');
  }
}

let runningPromise: Promise<void> | null = null;

/** 启动一次筛选；已在进行中则直接返回同一个 Promise（防重复触发） */
export function startFilterRun(): Promise<void> {
  if (runningPromise) return runningPromise;
  runningPromise = execute().finally(() => {
    runningPromise = null;
  });
  return runningPromise;
}

async function execute(): Promise<void> {
  const filter = getFilterState().filter;
  patch({
    running: true,
    stage: 'stocks',
    percent: 2,
    scanned: 0,
    total: 0,
    periodKey: undefined,
    message: undefined,
    resultCount: undefined,
    startedAt: Date.now(),
    finishedAt: undefined,
  });
  setFilterRunning(true);

  try {
    // ① 行情列表（含分页，约占 8%）
    const stocks = await fetchAllStocks(200);
    if (stocks.length === 0) {
      throw new Error('EMPTY');
    }
    patch({ stage: 'stocks', percent: 8, total: stocks.length });

    const favCodes = filter.onlyFavorites
      ? new Set((await loadFavorites()).map((f) => f.code))
      : undefined;

    // ② 本地 K 线（8% → 42%）
    const periods = [...neededPeriods(filter)];
    let provider: KlineProvider | undefined;
    let missingKline = false;
    if (periods.length > 0) {
      const maps: Partial<Record<KlinePeriod, Awaited<ReturnType<typeof preloadKlineMap>>>> = {};
      for (let i = 0; i < periods.length; i++) {
        const p = periods[i];
        patch({
          stage: 'kline',
          periodKey: PERIOD_KEY[p],
          percent: 8 + Math.round((i / periods.length) * 34),
        });
        maps[p] = await preloadKlineMap(p, p === 'daily' ? 500 : 260);
        if ((maps[p]?.size ?? 0) === 0) missingKline = true;
      }
      provider = multiPeriodProvider(maps);
      patch({ percent: 42 });
    }

    // ③ 逐只比对（42% → 96%）
    patch({ stage: 'scan', percent: 43, scanned: 0 });
    const out = await filterStocks(stocks, filter, provider, 300, favCodes, (scanned, total) => {
      patch({
        stage: 'scan',
        scanned,
        total,
        percent: 43 + Math.round((scanned / Math.max(1, total)) * 53),
      });
    });

    // ④ 整理（96% → 100%）
    patch({ stage: 'finishing', percent: 98 });
    setFilterOutput(out);
    patch({
      running: false,
      stage: 'done',
      percent: 100,
      resultCount: out.results.length,
      finishedAt: Date.now(),
      message: missingKline ? 'MISSING_KLINE' : undefined,
    });
  } catch (e) {
    patch({
      running: false,
      stage: 'error',
      percent: 0,
      finishedAt: Date.now(),
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    setFilterRunning(false);
  }
}
