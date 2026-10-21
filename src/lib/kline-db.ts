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

  // 版本迁移（v4）：清掉历史脏数据。
  // 旧版 eastmoney.fetchKlines 用 `new Date("2026-10-20 10:30")` 解析分时日期，
  // 在 iOS 上得到 Invalid Date → ts 写成 NULL。SQLite 的复合主键对 NULL 不去重，
  // 于是每刷新一次就重复插入一批 60 分钟 K 线。这里一次性清掉，并把 meta 根数校正。
  const vrow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const ver = vrow?.user_version ?? 0;
  if (ver < 4) {
    await db.execAsync(`
      DELETE FROM kline WHERE ts IS NULL OR ts <= 0;
      UPDATE meta SET bars = (
        SELECT COUNT(*) FROM kline k WHERE k.symbol = meta.symbol AND k.period = meta.period
      );
      PRAGMA user_version = 4;
    `);
  }
}

/**
 * 🔴 写串行化（问题2修复的核心）。
 *
 * 全量下载是 **4 并发**（download-manager 的信号量滑动窗口），每个 worker 都会调
 * saveKlines，而 saveKlines 内部用 `withTransactionAsync` 开事务。
 *
 * expo-sqlite 的 `withTransactionAsync` 不是真正的独占事务（官方文档明确提示：
 * 期间任何其它异步查询都会被卷进同一个事务）。4 个 worker 的 BEGIN/COMMIT 互相
 * 交错时，一方 ROLLBACK 会把另一方已写入的数据一起回滚 —— 表现为：
 * 下载进度显示「已完成」，但打开个股发现本地一根 K 线都没有，于是又提示「需要下载」。
 *
 * 所以：① 所有写操作走同一条串行队列；② 事务优先用 withExclusiveTransactionAsync；
 * ③ 顺带用 prepared statement 替代逐条 runAsync（全量 5000 只时速度快一个量级）。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  // 让队列不被单次失败卡死
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** 在独占事务里跑（不支持时退回普通事务） */
async function inTx(
  db: SQLite.SQLiteDatabase,
  fn: (conn: SQLite.SQLiteDatabase) => Promise<void>
): Promise<void> {
  const anyDb = db as unknown as {
    withExclusiveTransactionAsync?: (t: (txn: SQLite.SQLiteDatabase) => Promise<void>) => Promise<void>;
  };
  if (typeof anyDb.withExclusiveTransactionAsync === 'function') {
    await anyDb.withExclusiveTransactionAsync(async (txn) => fn(txn ?? db));
    return;
  }
  await db.withTransactionAsync(async () => fn(db));
}

/** 批量写入 K 线（INSERT OR REPLACE，增量安全） */
export async function saveKlines(
  symbol: string,
  period: KlinePeriod,
  bars: KlineBar[]
): Promise<void> {
  if (bars.length === 0) return;
  // 同一交易日只保留一根：接口偶发重复行、或历史数据与新数据 ts 口径不一致时，
  // 都会让「同一天」出现两条记录。写入前先在内存里去一次重。
  const byDate = new Map<string, KlineBar>();
  for (const b of bars) {
    if (!b.date) continue;
    byDate.set(b.date, b);
  }
  const clean = [...byDate.values()].sort((a, b) => a.ts - b.ts);
  if (clean.length === 0) return;

  return serializeWrite(async () => {
    const db = await getDb();
    await inTx(db, async (conn) => {
      // 🔴 按「日期区间」先删旧行，而不是只靠 INSERT OR REPLACE。
      //    主键是 (symbol, period, ts)，历史上 ts 口径变过一次
      //    （旧版 new Date("2026-10-20") = UTC 零点；改版后曾用本地零点），
      //    同一交易日的两行 ts 不同 → 主键去不掉 → 图上同一天出现两根 K 线。
      //    按日期删可以连带清掉这些历史脏行，之后每个交易日只会剩一行。
      await conn.runAsync(
        `DELETE FROM kline WHERE symbol=? AND period=? AND date>=? AND date<=?`,
        [symbol, period, clean[0].date, clean[clean.length - 1].date]
      );

      const stmt = await conn.prepareAsync(
        `INSERT OR REPLACE INTO kline (symbol, period, ts, date, o, h, l, c, v)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      try {
        for (const b of clean) {
          await stmt.executeAsync([
            symbol, period, b.ts, b.date, b.open, b.high, b.low, b.close, b.volume,
          ]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
      const latest = clean[clean.length - 1];
      await conn.runAsync(
        `INSERT OR REPLACE INTO meta (symbol, period, updatedAt, bars)
         VALUES (?, ?, ?, (SELECT COUNT(*) FROM kline WHERE symbol=? AND period=?))`,
        [symbol, period, latest.ts, symbol, period]
      );
    });
  });
}

/** 读取某只股票的 K 线（按时间升序） */
export async function loadKlines(
  symbol: string,
  period: KlinePeriod,
  limit = 200
): Promise<KlineBar[]> {
  const db = await getDb();
  // 多取一倍：历史库里同一交易日可能还留着 ts 口径不同的两行，
  // 去重后根数会变少，多取一些保证最终仍能拿满 limit 根。
  const rows = await db.getAllAsync<{
    ts: number; date: string; o: number; h: number; l: number; c: number; v: number;
  }>(
    `SELECT ts, date, o, h, l, c, v FROM kline
     WHERE symbol=? AND period=? ORDER BY ts DESC LIMIT ?`,
    [symbol, period, Math.max(limit * 2, limit)]
  );
  // 按 date 去重（行已按 ts 倒序，第一次出现的即最新那行），再截到 limit 根
  const seen = new Set<string>();
  const out: KlineBar[] = [];
  for (const r of rows) {
    const key = r.date || `ts:${r.ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ts: r.ts, date: r.date, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
    });
    if (out.length >= limit) break;
  }
  return out.reverse();
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

/** 已缓存 K 线的股票代码集合（走 meta，比 DISTINCT 扫 kline 表快得多） */
export async function codesWithBars(period: KlinePeriod = 'daily'): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ symbol: string }>(
    `SELECT symbol FROM meta WHERE period = ? AND bars > 0`,
    [period]
  );
  return rows.map((r) => r.symbol);
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
  return serializeWrite(async () => {
    const db = await getDb();
    if (period) {
      await inTx(db, async (conn) => {
        await conn.runAsync(`DELETE FROM kline WHERE symbol = ? AND period = ?`, [symbol, period]);
        await conn.runAsync(`DELETE FROM meta  WHERE symbol = ? AND period = ?`, [symbol, period]);
      });
    } else {
      await inTx(db, async (conn) => {
        await conn.runAsync(`DELETE FROM kline WHERE symbol = ?`, [symbol]);
        await conn.runAsync(`DELETE FROM meta  WHERE symbol = ?`, [symbol]);
      });
    }
  });
}

/** 清空全部 K 线缓存 */
export async function clearAllKlines(): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await inTx(db, async (conn) => {
      await conn.runAsync(`DELETE FROM kline`);
      await conn.runAsync(`DELETE FROM meta`);
    });
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
  return serializeWrite(async () => {
    const db = await getDb();
    await inTx(db, async (conn) => {
      await conn.runAsync(`DELETE FROM kline WHERE period = ?`, [period]);
      await conn.runAsync(`DELETE FROM meta WHERE period = ?`, [period]);
    });
  });
}

/** 全部本地数据的最后更新时间（unix 秒） */
export async function lastUpdateAt(): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ u: number | null }>(`SELECT MAX(updatedAt) AS u FROM meta`);
  return row?.u ?? null;
}