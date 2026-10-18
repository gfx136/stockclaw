import type { KlineBar, KlinePeriod, Stock } from '@/types/stock';

import { fetchAllStocks, fetchKlines, fetchQuote } from '../eastmoney';
import type { DataSource } from './types';

/**
 * 东方财富数据源。现有 eastmoney.ts 已实现全部接口，这里做接口对齐包装。
 * 东财是主力源：列表、K线、实时行情都支持。
 */
export const eastmoneySource: DataSource = {
  id: 'eastmoney',
  name: '东方财富',
  supportsList: true,
  supportsKline: true,
  supportsQuote: true,

  fetchAllStocks: (pageSize?: number) => fetchAllStocks(pageSize),
  fetchKlines: (code: string, period: KlinePeriod, limit?: number) =>
    fetchKlines(code, period, limit),
  fetchQuote: (code: string) => fetchQuote(code),
};
