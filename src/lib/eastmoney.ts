import type { KlineBar, KlinePeriod, Stock } from '@/types/stock';

/**
 * 东方财富数据源适配。
 * 对应 StockClaw 的 eastmoney_api.dart。
 *
 * 注意：东财 API 是国内服务，本机有代理时需要绕过（proxy 会 502）。
 * RN 的 fetch 默认不走系统代理设置，通常直连；但为保险起见，
 * 这里统一走 https，并处理好 secid 的市场前缀规则：
 *   - 上海（60/68/90 开头）→ 1.xxxxxx
 *   - 深圳（00/30/20 开头）→ 0.xxxxxx
 *   - 北京（4/8 开头）→ 0.xxxxxx（东财用 0 表示北交所）
 */

const EM_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_CLIST = 'https://82.push2.eastmoney.com/api/qt/clist/get';
const EM_QUOTE = 'https://push2.eastmoney.com/api/qt/stock/get';

/** 根据股票代码生成东财 secid（市场.代码） */
export function toSecid(code: string): string {
  const c = code.replace(/\D/g, '');
  if (/^(60|68|90)/.test(c)) return `1.${c}`; // 上海主板/科创/其他
  return `0.${c}`; // 深圳/创业板/北交所
}

/** K 线周期 → 东财 klt 参数 */
function periodToKlt(p: KlinePeriod): number {
  if (p === '60min') return 60;
  if (p === 'weekly') return 102;
  if (p === 'monthly') return 103;
  return 101; // daily
}

/** 通用 fetch 包装：超时 + JSON 解析 + 错误归一化 */
async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockClaw/1.0)' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 东财日期 → unix 秒。
 * ⚠️ 分时周期返回的是 `"2026-10-20 10:30"`（不是 ISO 8601），
 *    iOS 的 JavaScriptCore 对非 ISO 字符串 `new Date()` 会得到 Invalid Date，
 *    ts 变成 NaN → 绑到 SQLite 是 NULL → 主键 (symbol,period,ts) 去重失效，
 *    每刷新一次就重复插入一批 60 分钟 K 线。
 *    这里显式补成 ISO（空格换 T、日期补 T00:00:00），解析失败则返回 0 由调用方剔除。
 */
function parseTs(date: string): number {
  const s = date.trim();
  const iso = s.includes(' ') ? s.replace(' ', 'T') : s.length <= 10 ? `${s}T00:00:00` : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** 拉取 K 线历史（日/周/月） */
export async function fetchKlines(
  code: string,
  period: KlinePeriod = 'daily',
  limit = 200
): Promise<KlineBar[]> {
  const secid = toSecid(code);
  const klt = periodToKlt(period);
  // beg/end 用 0/大数 让东财返回全部，我们再截取最近 limit 条
  const url =
    `${EM_KLINE}?secid=${secid}&klt=${klt}&fqt=1` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&beg=0&end=20500101&lmt=${limit}`;

  const json = await fetchJson(url);
  if (json.rc !== 0 || !json.data?.klines) return [];

  const klines: string[] = json.data.klines;
  const out: KlineBar[] = [];
  for (const line of klines) {
    // 格式：日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
    const parts = line.split(',');
    const date = parts[0];
    const ts = parseTs(date);
    if (!ts) continue; // 解析不出的行直接丢弃，避免写入 NaN/NULL 污染主键
    out.push({
      ts,
      date,
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      high: parseFloat(parts[3]),
      low: parseFloat(parts[4]),
      volume: parseFloat(parts[5]),
      amount: parseFloat(parts[6] ?? '0'),
      changePercent: parseFloat(parts[8] ?? '0'),
      turnover: parseFloat(parts[10] ?? '0'),
    });
  }
  return out;
}

/**
 * 拉取 A 股行情列表（全量）。
 * fs 参数覆盖：沪主板 m:1+t:2、深主板 m:0+t:6、创业板 m:0+t:80、科创板 m:1+t:23
 * 分多页拉取，每页最多 pz 条。
 */
export async function fetchAllStocks(pageSize = 100): Promise<Stock[]> {
  const fields =
    'f12,f14,f2,f3,f6,f8,f20,f21,f9'; // 代码,名称,最新价,涨跌幅,成交额,换手率,总市值,流通市值,PE
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';

  // 先拿总数
  const firstUrl =
    `${EM_CLIST}?pn=1&pz=${pageSize}&po=1&np=1&fltt=2&invt=2` +
    `&fid=f3&fs=${encodeURIComponent(fs)}&fields=${fields}`;
  const first = await fetchJson(firstUrl);
  if (first.rc !== 0 || !first.data) return [];

  const total = first.data.total as number;
  const pages = Math.ceil(total / pageSize);
  const all: Stock[] = [...mapClist(first.data.diff)];

  // 逐页拉（串行，避免并发被限流）
  for (let pn = 2; pn <= pages; pn++) {
    const url =
      `${EM_CLIST}?pn=${pn}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2` +
      `&fid=f3&fs=${encodeURIComponent(fs)}&fields=${fields}`;
    try {
      const json = await fetchJson(url);
      if (json.rc === 0 && json.data?.diff) {
        all.push(...mapClist(json.data.diff));
      }
    } catch {
      // 单页失败跳过，不阻塞整体
    }
  }
  return all;
}

function mapClist(diff: any[]): Stock[] {
  return (diff ?? []).map((d: any) => ({
    code: String(d.f12 ?? ''),
    name: String(d.f14 ?? ''),
    price: Number(d.f2 ?? 0),
    changePercent: Number(d.f3 ?? 0),
    amount: Number(d.f6 ?? 0), // 成交额（元）
    turnover: Number(d.f8 ?? 0),
    marketCap: Number(d.f20 ?? 0),
    floatCap: Number(d.f21 ?? 0), // 流通市值（元）
    pe: Number(d.f9 ?? 0),
  }));
}

/** 拉取个股实时行情（详情页顶部用） */
export async function fetchQuote(code: string): Promise<Partial<Stock>> {
  const secid = toSecid(code);
  const fields =
    'f43,f44,f45,f46,f47,f48,f50,f51,f52,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170,f171';
  const url = `${EM_QUOTE}?secid=${secid}&fields=${fields}&fltt=2&invt=2`;
  const json = await fetchJson(url);
  if (json.rc !== 0 || !json.data) return {};
  const d = json.data;
  return {
    code: String(d.f57 ?? code),
    name: String(d.f58 ?? ''),
    price: Number(d.f43 ?? 0),
    changePercent: Number(d.f170 ?? 0),
    changeAmount: Number(d.f169 ?? 0),
    amount: Number(d.f48 ?? 0),
    turnover: Number(d.f168 ?? 0),
    marketCap: Number(d.f116 ?? 0),
    floatCap: Number(d.f117 ?? 0),
    pe: Number(d.f162 ?? 0),
    pb: Number(d.f167 ?? 0),
    // 详情扩展字段
    open: Number(d.f46 ?? 0),
    high: Number(d.f44 ?? 0),
    low: Number(d.f45 ?? 0),
    prevClose: Number(d.f60 ?? 0),
    volume: Number(d.f47 ?? 0),
    volumeRatio: Number(d.f50 ?? 0),
    amplitude: Number(d.f171 ?? 0),
    limitUp: Number(d.f51 ?? 0),
    limitDown: Number(d.f52 ?? 0),
  };
}