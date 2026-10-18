import type { KlineBar, KlinePeriod, Stock } from '@/types/stock';

import { toSinaSymbol, type DataSource } from './types';

/**
 * 新浪财经数据源。对应 StockClaw 的 sina_api.dart。
 *
 * 接口（已实测连通）：
 * - K线：https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData
 *   ?symbol=sh600519&scale=240&ma=no&datalen=320
 *   scale: 240=日线。周线用 scale=1200（240×5），月线新浪不提供单独接口（用周线聚合或腾讯兜底）。
 *   返回 [{day, open, high, low, close, volume}, ...]
 * - 实时：https://hq.sinajs.cn/list=sh600519（GBK 编码，需 Referer 头，逗号分隔）
 *
 * 注意：新浪接口同样 GBK 编码，只取数值字段。
 */

const SINA_KLINE = 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData';
const SINA_QUOTE = 'https://hq.sinajs.cn/list=';

/** K 线 scale 参数（分钟）：60分钟 60，日线 240，周线 1200 */
function periodToScale(p: KlinePeriod): number {
  if (p === '60min') return 60;
  if (p === 'weekly') return 1200;
  if (p === 'monthly') return 240; // 新浪无月线，用日线，上层聚合
  return 240;
}

async function fetchText(url: string, referer?: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; StockClaw/1.0)',
    };
    if (referer) headers['Referer'] = referer;
    const resp = await fetch(url, { signal: controller.signal, headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

export const sinaSource: DataSource = {
  id: 'sina',
  name: '新浪财经',
  supportsList: false, // 新浪全量列表接口复杂，列表走东财
  supportsKline: true,
  supportsQuote: true,

  async fetchAllStocks(): Promise<Stock[]> {
    throw new Error('新浪源不支持全量行情列表');
  },

  async fetchKlines(code: string, period: KlinePeriod, limit = 320): Promise<KlineBar[]> {
    const symbol = toSinaSymbol(code);
    const scale = periodToScale(period);
    const url = `${SINA_KLINE}?symbol=${symbol}&scale=${scale}&ma=no&datalen=${limit}`;
    const text = await fetchText(url);
    const json = JSON.parse(text);
    if (!Array.isArray(json)) return [];
    return json.map((r: any) => ({
      ts: Math.floor(new Date(r.day).getTime() / 1000),
      date: String(r.day),
      open: parseFloat(r.open),
      high: parseFloat(r.high),
      low: parseFloat(r.low),
      close: parseFloat(r.close),
      volume: parseFloat(r.volume),
    }));
  },

  async fetchQuote(code: string): Promise<Partial<Stock>> {
    const symbol = toSinaSymbol(code);
    // 新浪 hq.sinajs.cn 必须带 Referer，否则 403
    const text = await fetchText(`${SINA_QUOTE}${symbol}`, 'https://finance.sina.com.cn');
    // 格式：var hq_str_sh600519="名称,今开,昨收,最新,最高,最低,...";
    const m = text.match(/="([^"]+)"/);
    if (!m) return {};
    const f = m[1].split(',');
    const num = (i: number) => parseFloat(f[i] ?? '0') || 0;
    return {
      code,
      name: f[0] ?? '', // GBK 乱码时由东财列表兜底
      open: num(1),
      prevClose: num(2),
      price: num(3),
      high: num(4),
      low: num(5),
      volume: num(8),
      amount: num(9),
    };
  },
};
