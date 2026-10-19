import * as SQLite from 'expo-sqlite';

import type { KlineBar, KlinePeriod } from '@/types/stock';

/**
 * K 线本地缓存。对应 StockClaw 的 local_kline_db.dart。
 *
 * 结构按原应用的 SQLite schema 复刻：
 * - kline 表：(symbol, period, ts) 主键，存 OHLCV
 * - meta 表：每只股票的日/周/月最后更新时间，用于增量下载
 *
 * 注意：原应用按日/周/月分表缓存（updatedAt/updatedAtW/updatedAtM）。
 * 这里用 period 字段区分，单表即可，查询更清晰。
 */

const DB_NAME = 'stockclaw.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
    await initSchema(await dbPromise);
  }
  return dbPromise;
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA user_version = 3;
    CREATE TABLE IF NOT EXISTS kline (
      symbol TEXT NOT NULL,
      period TEXT NOT NULL,
      ts INTEGER NOT NULL,
      date TEXT,
      o REAL,
      h REAL,
      l REAL,
      c REAL,
      v REAL,
      PRIMARY KEY (symbol, period, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_kline_symbol_period ON kline(symbol, period, ts);
    CREATE TABLE IF NOT EXISTS meta (
      symbol TEXT NOT NULL,
      period TEXT NOT NULL,
      updatedAt INTEGER,
      bars INTEGER,
      PRIMARY KEY (symbol, period)
    );
  `);
}

/** 批量写入 K 线（INSERT OR REPLACE，增量安全） */
export async function saveKlines(
  symbol: string,
  period: KlinePeriod,
  bars: KlineBar[]
): Promise<void> {
  if (bars.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const b of bars) {
      await db.runAsync(
        `INSERT OR REPLACE INTO kline (symbol, period, ts, date, o, h, l, c, v)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [symbol, period, b.ts, b.date, b.open, b.high, b.low, b.close, b.volume]
      );
    }
    const latest = bars[bars.length - 1];
    await db.runAsync(
      `INSERT OR REPLACE INTO meta (symbol, period, updatedAt, bars)
       VALUES (?, ?, ?, (SELECT COUNT(*) FROM kline WHERE symbol=? AND period=?))`,
      [symbol, period, latest.ts, symbol, period]
    );
  });
}

/** 读取某只股票的 K 线（按时间升序） */
export async function loadKlines(
  symbol: string,
  period: KlinePeriod,
  limit = 200
): Promise<KlineBar[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    ts: number; date: string; o: number; h: number; l: number; c: number; v: number;
  }>(
    `SELECT ts, date, o, h, l, c, v FROM kline
     WHERE symbol=? AND period=? ORDER BY ts DESC LIMIT ?`,
    [symbol, period, limit]
  );
  return rows
    .map((r) => ({
      ts: r.ts, date: r.date, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
    }))
    .reverse();
}

/** 读某股票某周期的最后更新时间（用于增量下载判断） */
export async function getLastUpdate(
  symbol: string,
  period: KlinePeriod
): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ updatedAt: number }>(
    `SELECT updatedAt FROM meta WHERE symbol=? AND period=?`,
    [symbol, period]
  );
  return row?.updatedAt ?? null;
}

/** 读取缓存的 K 线条数 */
export async function getBarCount(
  symbol: string,
  period: KlinePeriod
): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ bars: number }>(
    `SELECT bars FROM meta WHERE symbol=? AND period=?`,
    [symbol, period]
  );
  return row?.bars ?? 0;
}

/* ------------------------------------------------------------------ *
 * 筛选专用：批量预载
 *
 * 筛选引擎的 klineProvider 是**同步**接口（筛几千只股票时不能每只都 await），
 * 所以流程是：先 await preloadKlineMap() 把所有已缓存 K 线读进内存 Map，
 * 再把 Map 包成同步 provider 传给 filterStocks()。
 * ------------------------------------------------------------------ */

/** 预载结果：code → 该周期的 K 线序列（升序） */
export type KlineMap = Map<string, KlineBar[]>;

/**
 * 一次性把某周期下**所有已缓存**的 K 线读进内存。
 *
 * @param period    周期
 * @param maxBars   每只股票最多取多少根（默认 500，够 MA60/BOLL20 用）
 * @param codes     只载入这些代码；省略则载入全部已缓存股票
 */
export async function preloadKlineMap(
  period: KlinePeriod = 'daily',
  maxBars = 500,
  codes?: string[]
): Promise<KlineMap> {
  const db = await getDb();
  const map: KlineMap = new Map();
  if (codes && codes.length === 0) return map;

  if (codes && codes.length > 0) {
    // 指定代码：分批查，避免 SQL 参数过多
    const BATCH = 400;
    for (let i = 0; i < codes.length; i += BATCH) {
      const slice = codes.slice(i, i + BATCH);
      const placeholders = slice.map(() => '?').join(',');
      const rows = await db.getAllAsync<{
        symbol: string; ts: number; date: string;
        o: number; h: number; l: number; c: number; v: number;
      }>(
        `SELECT symbol, ts, date, o, h, l, c, v FROM kline
          WHERE period = ? AND symbol IN (${placeholders})
          ORDER BY symbol ASC, ts ASC`,
        [period, ...slice]
      );
      pushRows(map, rows, maxBars);
    }
    return map;
  }

  const rows = await db.getAllAsync<{
    symbol: string; ts: number; date: string;
    o: number; h: number; l: number; c: number; v: number;
  }>(
    `SELECT symbol, ts, date, o, h, l, c, v FROM kline
      WHERE period = ?
      ORDER BY symbol ASC, ts ASC`,
    [period]
  );
  pushRows(map, rows, maxBars);
  return map;
}

function pushRows(
  map: KlineMap,
  rows: {
    symbol: string; ts: number; date: string;
    o: number; h: number; l: number; c: number; v: number;
  }[],
  maxBars: number
): void {
  for (const r of rows) {
    let arr = map.get(r.symbol);
    if (!arr) {
      arr = [];
      map.set(r.symbol, arr);
    }
    arr.push({
      ts: r.ts, date: r.date, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
    });
  }
  // 每只只保留最近 maxBars 根
  if (maxBars > 0) {
    for (const [k, arr] of map) {
      if (arr.length > maxBars) map.set(k, arr.slice(arr.length - maxBars));
    }
  }
}

/** 把预载的 Map 包成筛选引擎要的同步 provider（单周期） */
export function mapToProvider(map: KlineMap) {
  return (code: string): KlineBar[] | undefined => map.get(code);
}

/**
 * 多周期 provider：按周期提供已缓存 K 线。
 * maps 是 period → KlineMap 的映射；缺的周期返回 undefined。
 * 用于技术指标规则的多周期判定（60分钟/日/周/月）。
 */
export function multiPeriodProvider(
  maps: Partial<Record<KlinePeriod, KlineMap>>
): (code: string, period?: KlinePeriod) => KlineBar[] | undefined {
  return (code, period = 'daily') => maps[period]?.get(code);
}

/** 已缓存 K 线的股票代码集合 */
export async function cachedCodes(period: KlinePeriod = 'daily'): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM kline WHERE period = ?`,
    [period]
  );
  return rows.map((r) => r.symbol);
}

/** 该股票各周期已缓存的根数 */
export async function countKlines(
  symbol: string
): Promise<Record<KlinePeriod, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ period: string; bars: number }>(
    `SELECT period, bars FROM meta WHERE symbol = ?`,
    [symbol]
  );
  const out: Record<KlinePeriod, number> = { '60min': 0, daily: 0, weekly: 0, monthly: 0 };
  for (const r of rows) {
    if (r.period === '60min' || r.period === 'daily' || r.period === 'weekly' || r.period === 'monthly') {
      out[r.period] = r.bars ?? 0;
    }
  }
  return out;
}

/** 删除某只股票某周期的缓存 */
export async function deleteKlines(
  symbol: string,
  period?: KlinePeriod
): Promise<void> {
  const db = await getDb();
  if (period) {
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM kline WHERE symbol = ? AND period = ?`, [symbol, period]);
      await db.runAsync(`DELETE FROM meta  WHERE symbol = ? AND period = ?`, [symbol, period]);
    });
  } else {
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM kline WHERE symbol = ?`, [symbol]);
      await db.runAsync(`DELETE FROM meta  WHERE symbol = ?`, [symbol]);
    });
  }
}

/** 清空全部 K 线缓存 */
export async function clearAllKlines(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM kline`);
    await db.runAsync(`DELETE FROM meta`);
  });
}

/** 数据库体积与规模统计（设置页展示用） */
export async function dbStats(): Promise<{
  totalBars: number;
  codes: number;
  bytes: number;
}> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number; c: number }>(
    `SELECT COALESCE(SUM(bars),0) AS n, COUNT(DISTINCT symbol) AS c FROM meta`
  );
  let bytes = 0;
  try {
    const pc = await db.getFirstAsync<{ page_count: number }>(`PRAGMA page_count`);
    const ps = await db.getFirstAsync<{ page_size: number }>(`PRAGMA page_size`);
    bytes = (pc?.page_count ?? 0) * (ps?.page_size ?? 4096);
  } catch {
    bytes = 0;
  }
  return { totalBars: row?.n ?? 0, codes: row?.c ?? 0, bytes };
}

/** 分周期统计（本地数据管理明细页用） */
export interface PeriodStat {
  period: KlinePeriod;
  codes: number;
  bars: number;
  lastUpdate: number | null;
}
export async function perPeriodStats(): Promise<PeriodStat[]> {
  const db = await getDb();
  const out: PeriodStat[] = [];
  for (const p of ['60min', 'daily', 'weekly', 'monthly'] as KlinePeriod[]) {
    const row = await db.getFirstAsync<{ n: number; c: number; u: number | null }>(
      `SELECT COALESCE(SUM(bars),0) AS n, COUNT(DISTINCT symbol) AS c, MAX(updatedAt) AS u FROM meta WHERE period = ?`,
      [p]
    );
    out.push({ period: p, codes: row?.c ?? 0, bars: row?.n ?? 0, lastUpdate: row?.u ?? null });
  }
  return out;
}

/** 按周期删除本地数据（二次确认后调用；下次下载重新补齐） */
export async function deleteByPeriod(period: KlinePeriod): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM kline WHERE period = ?`, [period]);
    await db.runAsync(`DELETE FROM meta WHERE period = ?`, [period]);
  });
}

/** 全部本地数据的最后更新时间（unix 秒） */
export async function lastUpdateAt(): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ u: number | null }>(`SELECT MAX(updatedAt) AS u FROM meta`);
  return row?.u ?? null;
}