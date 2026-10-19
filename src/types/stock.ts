/**
 * 数据模型定义。
 * 对应 StockClaw 的 core/models/，但按 RN/TS 重新实现。
 */

/** 股票基础信息（行情列表项） */
export interface Stock {
  /** 代码，如 600000 */
  code: string;
  /** 名称，如 浦发银行 */
  name: string;
  /** 最新价 */
  price: number;
  /** 涨跌幅 % */
  changePercent: number;
  /** 成交额（元） */
  amount?: number;
  /** 换手率 % */
  turnover?: number;
  /** 市盈率（动态） */
  pe?: number;
  /** 总市值（元） */
  marketCap?: number;
  /** 流通市值（元） */
  floatCap?: number;
  /** 涨跌额 */
  changeAmount?: number;

  /* —— 详情页扩展行情字段（仅 fetchQuote 返回） —— */
  /** 今开 */
  open?: number;
  /** 最高 */
  high?: number;
  /** 最低 */
  low?: number;
  /** 昨收 */
  prevClose?: number;
  /** 成交量（手） */
  volume?: number;
  /** 量比 */
  volumeRatio?: number;
  /** 振幅 % */
  amplitude?: number;
  /** 市净率 */
  pb?: number;
  /** 涨停价 */
  limitUp?: number;
  /** 跌停价 */
  limitDown?: number;
}

/** K 线单条 */
export interface KlineBar {
  /** 时间戳（秒） */
  ts: number;
  /** 日期字符串 YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 成交额（元） */
  amount?: number;
  /** 涨跌幅 % */
  changePercent?: number;
  /** 换手率 % */
  turnover?: number;
}

/** K 线周期 */
export type KlinePeriod = '60min' | 'daily' | 'weekly' | 'monthly';

/** 市值分层（补充规格 §3.4：只有 大盘/中盘/小盘 三档） */
export type MarketCapTier = 'large' | 'mid' | 'small';

/** 收藏条目 */
export interface FavoriteItem {
  code: string;
  name: string;
  addedAt: number;
}

/* ------------------------------------------------------------------ *
 * 技术指标
 * ------------------------------------------------------------------ */

/** 带指标的 K 线序列（undefined 表示尚未进入计算窗口） */
export interface IndicatorSeries {
  /** 移动平均组：周期 → 序列 */
  ma: Record<number, (number | undefined)[]>;
  macd: {
    dif: (number | undefined)[];
    dea: (number | undefined)[];
    hist: (number | undefined)[];
  };
  kdj: {
    k: (number | undefined)[];
    d: (number | undefined)[];
    j: (number | undefined)[];
  };
  rsi: Record<number, (number | undefined)[]>;
  boll: {
    mid: (number | undefined)[];
    upper: (number | undefined)[];
    lower: (number | undefined)[];
  };
  bbi: (number | undefined)[];
}

/** 单根 K 线上某一时点的指标快照（筛选 / 详情页用） */
export interface IndicatorSnapshot {
  ma5?: number;
  ma10?: number;
  ma20?: number;
  ma26?: number;
  ma60?: number;
  dif?: number;
  dea?: number;
  macdHist?: number;
  k?: number;
  d?: number;
  j?: number;
  rsi6?: number;
  rsi14?: number;
  bollMid?: number;
  bollUpper?: number;
  bollLower?: number;
  bbi?: number;
}

/* ------------------------------------------------------------------ *
 * 筛选
 * ------------------------------------------------------------------ */

/** 数值区间条件（字段缺省 = 不限制） */
export interface RangeCondition {
  min?: number;
  max?: number;
}

/** 技术指标信号条件 */
export interface SignalCondition {
  /** 均线多头排列：MA5 > MA10 > MA20 */
  maBullish?: boolean;
  /** 均线空头排列：MA5 < MA10 < MA20 */
  maBearish?: boolean;
  /** MACD 金叉（DIF 上穿 DEA） */
  macdGoldenCross?: boolean;
  /** MACD 死叉（DIF 下穿 DEA） */
  macdDeadCross?: boolean;
  /** MACD 柱由负转正 */
  macdHistTurnPositive?: boolean;
  /** KDJ 金叉（K 上穿 D） */
  kdjGoldenCross?: boolean;
  /** KDJ 超卖（K < 20） */
  kdjOversold?: boolean;
  /** KDJ 超买（K > 80） */
  kdjOverbought?: boolean;
  /** RSI 超卖（RSI14 < 30） */
  rsiOversold?: boolean;
  /** RSI 超买（RSI14 > 70） */
  rsiOverbought?: boolean;
  /** 收盘价站上布林中轨 */
  aboveBollMid?: boolean;
  /** 收盘价跌破布林下轨 */
  belowBollLower?: boolean;
  /** 放量：当日量 > days 日均量 × multiple */
  volumeSurge?: { days: number; multiple: number };
  /**
   * 周线 BBI 多头策略（用户自定义公式）：
   *   周线BBI(3,6,12,24) > 周线MA26  且  周线收盘 > 周线BBI
   * 依赖**周线** K 线。
   */
  weeklyBBIStrategy?: boolean;
  /* —— BBI 分组（按界面规格：周线/日线两组，组内多选）—— */
  /** 周线：收盘 > BBI */
  weeklyCloseGtBBI?: boolean;
  /** 周线：红柱（收 > 开） */
  weeklyBull?: boolean;
  /** 周线：BBI > MA26 */
  weeklyBBIGtMA26?: boolean;
  /** 日线：收盘 > BBI */
  dailyCloseGtBBI?: boolean;
  /** 日线：近4根连续收盘 > BBI */
  daily4CloseGtBBI?: boolean;
  /** 日线：BBI > MA26 */
  dailyBBIGtMA26?: boolean;
}

/** 筛选条件集 */
export interface FilterSet {
  /** 市值分层（多选） */
  capTiers?: MarketCapTier[];
  /** 市值区间（元） */
  marketCapRange?: RangeCondition;
  /** 流通市值区间（元） */
  floatCapRange?: RangeCondition;
  /** 成交额区间（元） */
  amountRange?: RangeCondition;
  /** 市盈率区间 */
  peRange?: RangeCondition;
  /** 涨跌幅区间 % */
  changeRange?: RangeCondition;
  /** 换手率区间 % */
  turnoverRange?: RangeCondition;
  /** 最新价区间 */
  priceRange?: RangeCondition;
  /** 代码 / 名称关键字 */
  keyword?: string;
  /** 排除 ST / *ST */
  excludeST?: boolean;
  /** 排除科创板（688 / 689） */
  excludeKCB?: boolean;
  /** 排除创业板（30 开头） */
  excludeChiNext?: boolean;
  /** 排除北交所（43 / 82 / 83 / 87 / 8 开头） */
  excludeBSE?: boolean;
  /** 排除银行（名称含「银行」） */
  excludeBank?: boolean;
  /** 跳空缺口幅度下限 %（今日开盘 vs 昨日收盘） */
  gapMin?: number;
  /** 仅自选：只在自选范围内筛选 */
  onlyFavorites?: boolean;
  /**
   * 技术指标信号条件（扁平 boolean 形式，旧版）。
   * 注意：信号判定依赖本地 K 线缓存，未缓存的股票会被跳过——
   * 所以一旦设置本项，筛选范围自动收窄为「已缓存 K 线的股票」。
   */
  signals?: SignalCondition;
  /**
   * 技术指标规则列表（结构化，含适用周期）——规格 2.2 B。
   * AND 组合：所有规则都满足才算命中。
   */
  rules?: IndicatorRule[];
}

/** 筛选结果条目 */
export interface FilterResult {
  stock: Stock;
  snapshot?: IndicatorSnapshot;
  /** 命中的信号标签（结果页展示用） */
  hits: string[];
}

/* ------------------------------------------------------------------ *
 * 技术指标规则（结构化，含适用周期）——产品规格 2.2 B
 * ------------------------------------------------------------------ */

/**
 * 技术指标规则类型。
 * 命名直观对应规格的条件形态。
 */
export type IndicatorRuleKind =
  // MA：价格站上/跌破 MA(value)
  | 'ma_above'
  | 'ma_below'
  // BOLL：收盘在 上轨上方/中轨上方/中轨下方/下轨下方
  | 'boll_above_upper'
  | 'boll_above_mid'
  | 'boll_below_mid'
  | 'boll_below_lower'
  // MACD：柱>0/<0、金叉、死叉
  | 'macd_hist_pos'
  | 'macd_hist_neg'
  | 'macd_golden'
  | 'macd_dead'
  // KDJ：J 值 > value / < value
  | 'kdj_gt'
  | 'kdj_lt'
  // RSI：RSI(14) > value / < value
  | 'rsi_gt'
  | 'rsi_lt'
  // BBI（周线/日线定向）：①日收盘>BBI ②日近4根连续收盘>BBI ③日BBI>MA26 ④周收盘>BBI ⑤周BBI>MA26 ⑥周线红柱(收>开)
  | 'bbi_close_gt'
  | 'bbi_4close_gt'
  | 'bbi_gt_ma26'
  | 'bbi_w_close_gt'
  | 'bbi_w_gt_ma26'
  | 'bbi_w_bull';

/** 一条技术指标规则 */
export interface IndicatorRule {
  kind: IndicatorRuleKind;
  /** 参数：MA 周期 / KDJ·RSI 阈值；不需要参数的省略 */
  value?: number;
  /** 适用周期（缺省 = ['daily']）。该周期无本地数据时跳过该周期判定 */
  periods?: KlinePeriod[];
}

/** 规则的中文描述（结果页命中标签 / 面板展示用） */
export function ruleLabel(r: IndicatorRule): string {
  const v = r.value;
  switch (r.kind) {
    case 'ma_above': return `站上MA${v ?? 20}`;
    case 'ma_below': return `跌破MA${v ?? 20}`;
    case 'boll_above_upper': return 'BOLL上轨上方';
    case 'boll_above_mid': return 'BOLL中轨上方';
    case 'boll_below_mid': return 'BOLL中轨下方';
    case 'boll_below_lower': return 'BOLL下轨下方';
    case 'macd_hist_pos': return 'MACD柱>0';
    case 'macd_hist_neg': return 'MACD柱<0';
    case 'macd_golden': return 'MACD金叉';
    case 'macd_dead': return 'MACD死叉';
    case 'kdj_gt': return `KDJ-J>${v ?? 80}`;
    case 'kdj_lt': return `KDJ-J<${v ?? 20}`;
    case 'rsi_gt': return `RSI14>${v ?? 70}`;
    case 'rsi_lt': return `RSI14<${v ?? 30}`;
    case 'bbi_close_gt': return '日:收盘>BBI';
    case 'bbi_4close_gt': return '日:连续4收盘>BBI';
    case 'bbi_gt_ma26': return '日:BBI>MA26';
    case 'bbi_w_close_gt': return '周:收盘>BBI';
    case 'bbi_w_gt_ma26': return '周:BBI>MA26';
    case 'bbi_w_bull': return '周:红柱(收>开)';
  }
}

/** 市值分层阈值（元）——已废弃，分档改为排名制（见 rankToTier） */
export const CAP_TIER_THRESHOLDS: Record<string, RangeCondition> = {
  large: { min: 100_000_000_000 },
  mid: { min: 10_000_000_000, max: 100_000_000_000 },
  small: { max: 10_000_000_000 },
};

/**
 * 按市值排名分档（补充规格 §3.4）：
 *   大盘 = 市值排名 Top 100
 *   中盘 = 101-300
 *   小盘 = 301-500
 * rank 从 1 开始（市值降序第 1 名）。
 */
export function rankToTier(rank: number): MarketCapTier {
  if (rank <= 100) return 'large';
  if (rank <= 300) return 'mid';
  return 'small';
}

/** 市值分层中文名（补充规格 §3.4） */
export const CAP_TIER_LABELS: Record<MarketCapTier, string> = {
  large: '大盘(Top100)',
  mid: '中盘(101-300)',
  small: '小盘(301-500)',
};