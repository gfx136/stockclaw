import type { KlineBar, KlinePeriod, Stock } from '@/types/stock';

import { toSinaSymbol, type DataSource } from './types';

/**
 * 新浪财经数据源。对应 StockClaw 的 sina_api.dart。
 *
 * 接口（已实测连通）：
 * - 全市场列表：https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData
 *   ?page=1&num=100&sort=symbol&asc=0&node=hs_a  （需 Referer）
 *   返回 JSON 数组，中文名**不乱码**（UTF-8），字段见 mapListNode。
 * - K线：https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData
 *   ?symbol=sh600519&scale=240&ma=no&datalen=320
 *   scale: 240=日线。周线用 scale=1200（240×5），月线新浪不提供单独接口（用周线聚合或腾讯兜底）。
 *   返回 [{day, open, high, low, close, volume}, ...]
 * - 实时：https://hq.sinajs.cn/list=sh600519（GBK 编码，需 Referer 头，逗号分隔）
 *
 * 注意：hq.sinajs.cn 是 GBK 编码，中文名会乱码（只取数值字段）；
 *      但 Market_Center 列表接口是正常 UTF-8，名称可直接用。
 */

const SINA_KLINE = 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData';
const SINA_QUOTE = 'https://hq.sinajs.cn/list=';
const SINA_LIST =
  'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';

/** 新浪列表单页上限（实测 num=100 可返回 100 条） */
const SINA_PAGE_SIZE = 100;
/** A 股总数上限，用于估算分页数 */
const SINA_MAX_PAGES = 60;

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

/** 新浪列表项 → 内部 Stock 模型 */
function mapListNode(r: any): Stock | null {
  const code = String(r?.code ?? '').replace(/^\D+/, '');
  if (!code) return null;
  const num = (v: any) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    code,
    name: String(r?.name ?? ''), // UTF-8，不乱码
    price: num(r?.trade),
    changePercent: num(r?.changepercent),
    changeAmount: num(r?.pricechange),
    amount: num(r?.amount), // 元
    volume: num(r?.volume),
    turnover: num(r?.turnoverratio), // %
    pe: num(r?.per),
    pb: num(r?.pb),
    // 新浪 mktcap / nmc 单位是【万元】，转成元
    marketCap: num(r?.mktcap) * 1e4,
    floatCap: num(r?.nmc) * 1e4,
  };
}

export const sinaSource: DataSource = {
  id: 'sina',
  name: '新浪财经',
  supportsList: true, // 已补全量列表实现（Market_Center.getHQNodeData）
  supportsKline: true,
  supportsQuote: true,

  /**
   * 全市场 A 股列表。分页拉取 node=hs_a（沪深 A 股），串行避免被限流。
   * 实测：单页 num=100 可用；page70 返回 56 条（总量约 5576）。
   */
  async fetchAllStocks(pageSize = 100): Promise<Stock[]> {
    const num = Math.min(Math.max(pageSize, 20), SINA_PAGE_SIZE);
    const all: Stock[] = [];
    for (let page = 1; page <= SINA_MAX_PAGES; page++) {
      const url =
        `${SINA_LIST}?page=${page}&num=${num}&sort=symbol&asc=0&node=hs_a`;
      let rows: any[];
      try {
        const text = await fetchText(url, 'https://finance.sina.com.cn');
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        // 首页失败要抛出（让 failover 切下一个源）；后续页失败则停止，保留已拿到的
        if (page === 1) throw e;
        break;
      }
      if (rows.length === 0) break; // 到底了
      for (const r of rows) {
        const s = mapListNode(r);
        if (s) all.push(s);
      }
      if (rows.length < num) break; // 不满一页 = 最后一页
    }
    if (all.length === 0) throw new Error('新浪列表返回空数据');
    return all;
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
