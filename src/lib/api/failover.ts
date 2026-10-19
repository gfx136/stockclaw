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

/** 支持全市场列表的源（用于 fetchAllStocks 的故障转移） */
const LIST_SOURCES = SOURCES.filter((s) => s.supportsList);

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

/**
 * 按当前模式返回要尝试的数据源序列。
 * @param requireList 为 true 时只返回支持「全市场列表」的源
 */
async function resolveOrder(requireList = false): Promise<DataSource[]> {
  const pool = requireList ? LIST_SOURCES : SOURCES;
  const mode = await getSourceMode();
  if (mode === 'auto') return pool;
  const pinned = pool.find((s) => s.id === mode);
  return pinned ? [pinned] : pool;
}

/**
 * 带故障转移的执行器。
 * 依次尝试每个源，第一个不抛错且返回有效结果的生效。
 * 全部失败则抛出聚合后的错误（含尝试过哪些源，便于排查）。
 */
async function withFailover<T>(
  fn: (src: DataSource) => Promise<T>,
  validate: (r: T) => boolean,
  requireList = false
): Promise<T> {
  const order = await resolveOrder(requireList);
  const tried: string[] = [];
  let lastErr: unknown = new Error('无可用数据源');
  for (const src of order) {
    try {
      const result = await fn(src);
      if (validate(result)) return result;
      lastErr = new Error(`${src.name} 返回空数据`);
      tried.push(`${src.name}(空)`);
    } catch (e) {
      lastErr = e;
      tried.push(src.name);
    }
  }
  // 全部失败：给一个可操作的中文提示，而不是把原生的
  // "Network connection was lost" 直接甩给用户
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `所有数据源均失败（已尝试：${tried.join('、')}）。\n` +
      `可能是当前网络限制了行情接口访问，请检查网络或切换数据源。\n` +
      `[${detail}]`
  );
}

/**
 * 全市场行情列表：多源故障转移。
 *
 * ⚠️ 历史问题：这里原先直接写死 `eastmoneySource.fetchAllStocks()`，
 * 是**单点无兜底**——东财 push2 域名一旦被网络阻断（企业出口常见），
 * 首页就整体报 "Network connection was lost" 白屏。
 * 现在改为走 withFailover：东财 → 新浪（支持列表的两个源），任一可用即可。
 *
 * 注：腾讯无全量列表接口，不参与；K线/实时行情走下面的 withFailover。
 */
export async function fetchAllStocks(pageSize = 200): Promise<Stock[]> {
  return withFailover(
    (src) => src.fetchAllStocks(pageSize),
    (list) => list.length > 0,
    true // 只尝试支持列表的源
  );
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

/** 列出所有数据源（设置页用）。显示顺序按产品规格：自动 / 新浪 / 腾讯 / 东财 */
export function listSources(): { id: SourceMode; name: string; desc: string }[] {
  const order: DataSourceId[] = ['sina', 'tencent', 'eastmoney'];
  const rest = order
    .map((id) => SOURCES.find((s) => s.id === id))
    .filter((s): s is DataSource => !!s)
    .map((s) => ({
      id: s.id as SourceMode,
      name: s.name,
      desc: [s.supportsList && '列表', s.supportsKline && 'K线', s.supportsQuote && '实时']
        .filter(Boolean)
        .join('/'),
    }));
  return [{ id: 'auto', name: '自动（故障转移）', desc: '按优先级自动切换，推荐' }, ...rest];
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
