import type { KlineBar, KlinePeriod, Stock } from '@/types/stock';

import { toTencentSymbol, type DataSource } from './types';

/**
 * 腾讯财经数据源。对应 StockClaw 的 tencent_api.dart。
 *
 * 接口（已实测连通）：
 * - K线：https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,week,,,320,qfq
 *   返回 data.<symbol>.qfq<period>，每条 [日期, 开, 收, 高, 低, 量]
 * - 实时：https://qt.gtimg.cn/q=sh600519（GBK 编码，~ 分隔，只用数值字段）
 *
 * 注意：腾讯接口返回 GBK 编码，中文名称会乱码。本实现只取数值字段，
 * 名称由东财全量列表兜底（故障转移时 upsert 合并）。
 */

const TEX_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const TEX_QUOTE = 'https://qt.gtimg.cn/q=';

function periodToParam(p: KlinePeriod): string {
  if (p === '60min') return 'm60';
  if (p === 'weekly') return 'week';
  if (p === 'monthly') return 'month';
  return 'day';
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockClaw/1.0)' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
}

export const tencentSource: DataSource = {
  id: 'tencent',
  name: '腾讯财经',
  supportsList: false, // 腾讯无全量列表接口，列表走东财
  supportsKline: true,
  supportsQuote: true,

  async fetchAllStocks(): Promise<Stock[]> {
    throw new Error('腾讯源不支持全量行情列表');
  },

  async fetchKlines(code: string, period: KlinePeriod, limit = 320): Promise<KlineBar[]> {
    const symbol = toTencentSymbol(code);
    const param = periodToParam(period);
    let rows: any[] = [];
    if (period === '60min') {
      // 分钟线走 mkline 接口（不复权），key 为 m60
      const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},${param},,${limit}`;
      const json = await fetchJson(url);
      if (json.code !== 0) return [];
      rows = json.data?.[symbol]?.[param] ?? [];
    } else {
      const url = `${TEX_KLINE}?param=${symbol},${param},,,${limit},qfq`;
      const json = await fetchJson(url);
      if (json.code !== 0) return [];
      const node = json.data?.[symbol];
      const key = `qfq${param}`;
      rows = node?.[key] ?? node?.[param] ?? [];
    }
    return rows.map((r: any[]) => ({
      ts: Math.floor(new Date(r[0]).getTime() / 1000),
      date: String(r[0]),
      open: parseFloat(r[1]),
      close: parseFloat(r[2]),
      high: parseFloat(r[3]),
      low: parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }));
  },

  async fetchQuote(code: string): Promise<Partial<Stock>> {
    const symbol = toTencentSymbol(code);
    const text = await fetchText(`${TEX_QUOTE}${symbol}`);
    // 格式：v_sh600519="1~名称~代码~最新~昨收~今开~量~...~高~低~..."
    const m = text.match(/="([^"]+)"/);
    if (!m) return {};
    const f = m[1].split('~');
    const num = (i: number) => parseFloat(f[i] ?? '0') || 0;
    return {
      code,
      name: f[1] ?? '', // GBK 乱码时由东财列表兜底
      price: num(3),
      prevClose: num(4),
      open: num(5),
      volume: num(6),
      high: num(33),
      low: num(34),
      changePercent: num(32), // 涨跌幅
      turnover: num(38), // 换手率 %
      pe: num(39), // 市盈率 TTM
      marketCap: num(45) * 1e8, // 总市值（腾讯单位是亿，转元）
    };
  },
};
