import AsyncStorage from '@react-native-async-storage/async-storage';

import { eastmoneySource } from './eastmoney-source';
import { sinaSource } from './sina-source';
import { tencentSource } from './tencent-source';
import type { DataSource, DataSourceId } from './types';
import type { KlineBar, KlinePeriod, Stock } from '@/types/stock';

/**
 * 故障转移数据源管理。对应 StockClaw 的 failover_api.dart。
 *
 * 两种模式：
 * - auto：按优先级顺序尝试，第一个成功的源生效，失败自动切下一个
 * - 手动：用户锁定某一个源，只用这个
 *
 * 选择持久化到 AsyncStorage，重启 App 保留。
 */

const SOURCES: DataSource[] = [eastmoneySource, tencentSource, sinaSource];
const KEY = 'stockclaw:datasource';

export type SourceMode = 'auto' | DataSourceId;

/** 读取用户选择的数据源模式 */
export async function getSourceMode(): Promise<SourceMode> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === 'auto' || v === 'eastmoney' || v === 'tencent' || v === 'sina') return v;
  } catch {
    /* 忽略 */
  }
  return 'auto';
}

/** 保存用户选择 */
export async function setSourceMode(mode: SourceMode): Promise<void> {
  await AsyncStorage.setItem(KEY, mode);
}

/** 按当前模式返回要尝试的数据源序列 */
async function resolveOrder(): Promise<DataSource[]> {
  const mode = await getSourceMode();
  if (mode === 'auto') return SOURCES;
  const pinned = SOURCES.find((s) => s.id === mode);
  return pinned ? [pinned] : SOURCES;
}

/**
 * 带故障转移的执行器。
 * 依次尝试每个源，第一个不抛错且返回有效结果的生效。
 * 全部失败则抛最后一个错误。
 */
async function withFailover<T>(
  fn: (src: DataSource) => Promise<T>,
  validate: (r: T) => boolean
): Promise<T> {
  const order = await resolveOrder();
  let lastErr: unknown = new Error('无可用数据源');
  for (const src of order) {
    try {
      const result = await fn(src);
      if (validate(result)) return result;
      lastErr = new Error(`${src.name} 返回空数据`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** 全市场行情列表：只有东财支持，直接用（不做故障转移） */
export async function fetchAllStocks(pageSize = 200): Promise<Stock[]> {
  return eastmoneySource.fetchAllStocks(pageSize);
}

/** K 线：自动故障转移 */
export async function fetchKlines(
  code: string,
  period: KlinePeriod,
  limit = 320
): Promise<KlineBar[]> {
  return withFailover(
    (src) => src.fetchKlines(code, period, limit),
    (bars) => bars.length > 0
  );
}

/** 实时行情：自动故障转移 */
export async function fetchQuote(code: string): Promise<Partial<Stock>> {
  return withFailover(
    (src) => src.fetchQuote(code),
    (q) => (q.price ?? 0) > 0
  );
}

/** 列出所有数据源（设置页用） */
export function listSources(): { id: SourceMode; name: string; desc: string }[] {
  return [
    { id: 'auto', name: '自动（故障转移）', desc: '按优先级自动切换，推荐' },
    ...SOURCES.map((s) => ({
      id: s.id as SourceMode,
      name: s.name,
      desc: [s.supportsList && '列表', s.supportsKline && 'K线', s.supportsQuote && '实时']
        .filter(Boolean)
        .join('/'),
    })),
  ];
}

/* ------------------------------------------------------------------ *
 * 连接测速
 * ------------------------------------------------------------------ */

export interface SpeedTestResult {
  id: DataSourceId;
  name: string;
  /** 延迟毫秒；失败为 -1 */
  latencyMs: number;
  ok: boolean;
  error?: string;
}

/** 实测各数据源的 K 线接口延迟与可用性（用 600519 日线做探针） */
export async function speedTestSources(): Promise<SpeedTestResult[]> {
  const probe = async (src: DataSource): Promise<SpeedTestResult> => {
    const start = Date.now();
    try {
      const bars = await src.fetchKlines('600519', 'daily', 5);
      const latencyMs = Date.now() - start;
      return { id: src.id, name: src.name, latencyMs, ok: bars.length > 0 };
    } catch (e) {
      return {
        id: src.id,
        name: src.name,
        latencyMs: -1,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };
  // 并发测，取各自结果
  return Promise.all(SOURCES.map(probe));
}
