import type { KlineBar, KlinePeriod, Stock } from '@/types/stock';

/**
 * 数据源抽象。对应 StockClaw 的 core/api/ 多源设计。
 *
 * 每个数据源实现同样的三件事：全市场行情列表、K 线历史、个股实时行情。
 * 字段口径统一为内部模型（Stock / KlineBar），上层不感知差异。
 */

export type DataSourceId = 'eastmoney' | 'tencent' | 'sina';

export interface DataSource {
  id: DataSourceId;
  /** 展示名 */
  name: string;
  /** 是否支持全市场行情列表 */
  supportsList: boolean;
  /** 是否支持 K 线 */
  supportsKline: boolean;
  /** 是否支持实时行情 */
  supportsQuote: boolean;

  fetchAllStocks(pageSize?: number): Promise<Stock[]>;
  fetchKlines(code: string, period: KlinePeriod, limit?: number): Promise<KlineBar[]>;
  fetchQuote(code: string): Promise<Partial<Stock>>;
}

/** 市场代码 → 各源用的证券标识 */
export function toSinaSymbol(code: string): string {
  const c = code.replace(/\D/g, '');
  return /^6/.test(c) ? `sh${c}` : `sz${c}`;
}

export function toTencentSymbol(code: string): string {
  return toSinaSymbol(code); // 腾讯与新浪同为 sh/sz 前缀
}
