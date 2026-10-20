import type { FinancialBundle } from '@/lib/api/financial';

/**
 * 财务风险体检 + 机构评级参考（方案 A）。
 *
 * 判据来源：通达信「扫雷宝」公开的四类风险规则（财务类 / ST退市类可完整复刻），
 * 加上机构评级（对应通达信「一致预期」）。
 *
 * ⚠️ 重要说明（务必在 UI 上体现）：
 * - 本模块是**独立实现**，判据阈值取自公开资料，**不等于通达信官方评分**。
 *   通达信的综合评分还包含资金面/消息面/主题面（其自有数据库），无法复刻。
 * - 通达信扫雷宝是「100 分扣分制」；本模块同样采用扣分制，但分值与扣分权重是自定义的，
 *   所以分数**不可与通达信直接比较**，只能作为自查参考。
 * - 所有判据都是**几何/财务数字比较**，判不出「雷」不等于没有雷。
 */

/** 风险等级（对齐扫雷宝五档） */
export type RiskLevel = 'high' | 'mediumHigh' | 'medium' | 'mediumLow' | 'low';

/** 单条判据结果 */
export interface RiskItem {
  /** 判据键 */
  key: string;
  /** 分类 */
  category: 'financial' | 'st' | 'market';
  /** 判据名（中文） */
  label: string;
  /** 判定结果 */
  hit: boolean;
  /** 是否数据不足（无法判定） */
  insufficient: boolean;
  /** 扣分（命中时） */
  penalty: number;
  /** 实测值（展示用） */
  actual?: string;
  /** 阈值说明 */
  threshold: string;
  /** 补充说明 */
  note?: string;
}

/** 体检结果 */
export interface RiskReport {
  code: string;
  name?: string;
  /** 安全分（100 起扣，最低 0） */
  score: number;
  /** 风险等级 */
  level: RiskLevel;
  /** 命中的风险项 */
  items: RiskItem[];
  /** 全部判据（含未命中） */
  all: RiskItem[];
  /** 数据缺失的报表 */
  missing: string[];
  /** 报告期 */
  reportDate?: string;
}

/** 机构评级参考（对应通达信「一致预期」） */
export interface RatingReference {
  /** 参与评级的机构数 */
  orgCount: number;
  buyNum: number;
  addNum: number;
  neutralNum: number;
  reduceNum: number;
  saleNum: number;
  /** 综合评级分（买入5 增持4 中性3 减持2 卖出1，加权平均） */
  avgScore: number | null;
  /** 目标价区间 */
  targetMin: number | null;
  targetMax: number | null;
  /** 原始数据库字段 */
  source: 'eastmoney';
}

/* ------------------------------------------------------------------ *
 * 阈值常量（集中定义，便于调整）
 * ------------------------------------------------------------------ */

export const RISK_THRESHOLDS = {
  /** 资产负债率 > 80% */
  debtAssetRatio: 80,
  /** 商誉 / 总资产 > 40% */
  goodwillRatio: 40,
  /** 流动比率 < 1 视为流动性风险 */
  currentRatio: 1,
  /** 应收账款 / 总资产 > 50% */
  receivableRatio: 50,
  /** 毛利率 < 10% 视为盈利质量弱 */
  grossMargin: 10,
  /** ROE < 0（亏损） */
  roe: 0,
  /** 净利同比下滑超过 50% */
  netProfitDrop: -50,
  /** 经营现金流为负 */
  operatingCashflow: 0,
};

/* ------------------------------------------------------------------ *
 * 数值工具
 * ------------------------------------------------------------------ */

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** 安全除法（分母为 0 或缺失返回 null） */
function div(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

function pct(v: number | null, digits = 2): string {
  return v === null ? '—' : `${v.toFixed(digits)}%`;
}

/* ------------------------------------------------------------------ *
 * 判据：财务类（9 项，可完整复刻）
 * ------------------------------------------------------------------ */

function buildFinancialItems(b: FinancialBundle): RiskItem[] {
  const T = RISK_THRESHOLDS;
  const bal = b.balance;
  const sum = b.summary;
  const cf = b.cashflow;
  const gw = b.goodwill;

  const totalAssets = num(bal?.TOTAL_ASSETS);
  const monetary = num(bal?.MONETARYFUNDS);
  const liab = num(bal?.TOTAL_LIABILITIES);
  const currentRatio = num(bal?.CURRENT_RATIO);
  const receivable = num(bal?.ACCOUNTS_RECE);
  const debtRatio = num(bal?.DEBT_ASSET_RATIO);

  const goodwill = num(gw?.GOODWILL);
  const gwAssets = num(gw?.TOTAL_ASSETS) ?? totalAssets;
  const gwRatio = div(goodwill === null ? null : goodwill * 100, gwAssets);

  const netProfit = num(sum?.PARENT_NETPROFIT);
  const opCash = num(cf?.NETCASH_OPERATE);
  const grossMargin = num(sum?.XSMLL);
  const roe = num(sum?.WEIGHTAVG_ROE);
  const netProfitYoY = num(sum?.SJLTZ);

  const items: RiskItem[] = [];

  // ① 高负债率
  items.push({
    key: 'debt_ratio',
    category: 'financial',
    label: '高负债率',
    hit: debtRatio !== null && debtRatio > T.debtAssetRatio,
    insufficient: debtRatio === null,
    penalty: 10,
    actual: pct(debtRatio),
    threshold: `资产负债率 > ${T.debtAssetRatio}%`,
    note: '高杠杆意味着每年有高额还本付息压力',
  });

  // ② 高商誉风险（通达信口径：商誉占总资产 > 40%）
  items.push({
    key: 'goodwill',
    category: 'financial',
    label: '高商誉风险',
    hit: gwRatio !== null && gwRatio > T.goodwillRatio,
    insufficient: gwRatio === null,
    penalty: 15,
    actual: gwRatio === null ? '—' : `${gwRatio.toFixed(2)}%`,
    threshold: `商誉 / 总资产 > ${T.goodwillRatio}%`,
    note: '高商誉一旦减值会直接吞噬利润',
  });

  // ③ 货币资金充足仍举债（康得新/康美药业的典型特征）
  //    判定：账上现金非常多（>总负债的 60%），却仍维持高负债率（>60%）。
  //    ⚠️ 阈值故意收紧：早期用 50%/50% 会把「重资产扩张型企业」（如宁德时代
  //    账上存款多但为产能扩张举债）误判为财务异常。真正的异常是「钱多到能还债却还借」。
  const cashVsLiab = div(monetary, liab);
  items.push({
    key: 'cash_but_debt',
    category: 'financial',
    label: '货币资金充足仍举债',
    hit: cashVsLiab !== null && cashVsLiab > 0.6 && (debtRatio ?? 0) > 60,
    insufficient: cashVsLiab === null,
    penalty: 12,
    actual: cashVsLiab === null ? '—' : `货币资金/总负债 = ${(cashVsLiab * 100).toFixed(1)}%`,
    threshold: '货币资金/总负债 > 60% 且 资产负债率 > 60%',
    note: '账上现金充裕却大额举债，是财务异常的经典信号',
  });

  // ④ 流动性风险
  items.push({
    key: 'current_ratio',
    category: 'financial',
    label: '流动性风险',
    hit: currentRatio !== null && currentRatio < T.currentRatio,
    insufficient: currentRatio === null,
    penalty: 8,
    actual: currentRatio === null ? '—' : currentRatio.toFixed(2),
    threshold: `流动比率 < ${T.currentRatio}`,
    note: '流动比率 < 1 说明短期偿债能力偏弱',
  });

  // ⑤ 高应收账款、低现金流
  const recvRatio = div(receivable === null ? null : receivable * 100, totalAssets);
  items.push({
    key: 'receivable',
    category: 'financial',
    label: '高应收账款',
    hit: recvRatio !== null && recvRatio > T.receivableRatio,
    insufficient: recvRatio === null,
    penalty: 8,
    actual: recvRatio === null ? '—' : `${recvRatio.toFixed(2)}%`,
    threshold: `应收账款 / 总资产 > ${T.receivableRatio}%`,
    note: '应收账款占比过高，回款质量存疑',
  });

  // ⑥ 经营现金流为负
  items.push({
    key: 'op_cashflow',
    category: 'financial',
    label: '经营现金流为负',
    hit: opCash !== null && opCash < T.operatingCashflow,
    insufficient: opCash === null,
    penalty: 10,
    actual: opCash === null ? '—' : `${(opCash / 1e8).toFixed(2)} 亿`,
    threshold: '经营活动现金流净额 < 0',
    note: '赚的是「账面利润」而非真金白银',
  });

  // ⑦ 财报亏损
  items.push({
    key: 'net_profit_neg',
    category: 'financial',
    label: '财报亏损',
    hit: netProfit !== null && netProfit < 0,
    insufficient: netProfit === null,
    penalty: 15,
    actual: netProfit === null ? '—' : `${(netProfit / 1e8).toFixed(2)} 亿`,
    threshold: '最近一期净利润 < 0',
  });

  // ⑧ 业绩大幅下滑
  items.push({
    key: 'profit_drop',
    category: 'financial',
    label: '业绩大幅下滑',
    hit: netProfitYoY !== null && netProfitYoY < T.netProfitDrop,
    insufficient: netProfitYoY === null,
    penalty: 10,
    actual: pct(netProfitYoY, 1),
    threshold: `净利润同比 < ${T.netProfitDrop}%`,
  });

  // ⑨ 盈利质量弱（低毛利率 / 低 ROE）
  const weakProfit =
    (grossMargin !== null && grossMargin < T.grossMargin) ||
    (roe !== null && roe < T.roe);
  items.push({
    key: 'weak_profit',
    category: 'financial',
    label: '盈利能力偏弱',
    hit: weakProfit,
    insufficient: grossMargin === null && roe === null,
    penalty: 6,
    actual: `毛利率 ${pct(grossMargin, 1)} / ROE ${pct(roe, 1)}`,
    threshold: `毛利率 < ${T.grossMargin}% 或 ROE < 0`,
  });

  return items;
}

/* ------------------------------------------------------------------ *
 * 判据：ST 与退市类（规则最明确，可完整复刻）
 * ------------------------------------------------------------------ */

function buildStItems(b: FinancialBundle, stockName?: string): RiskItem[] {
  const name = b.name ?? stockName ?? '';
  const sum = b.summary;
  const netProfit = num(sum?.PARENT_NETPROFIT);
  const bps = num(sum?.BPS);
  const items: RiskItem[] = [];

  const isSt = /\*?ST/i.test(name);
  items.push({
    key: 'is_st',
    category: 'st',
    label: '已是 ST / *ST 股票',
    hit: isSt,
    insufficient: false,
    penalty: 30,
    actual: name || '—',
    threshold: '证券简称含 ST / *ST 前缀',
    note: '已被交易所实施风险警示',
  });

  // 净资产为负（退市风险警示的常见触发条件）
  items.push({
    key: 'negative_equity',
    category: 'st',
    label: '净资产为负（退市风险）',
    hit: bps !== null && bps < 0,
    insufficient: bps === null,
    penalty: 25,
    actual: bps === null ? '—' : `每股净资产 ${bps.toFixed(2)} 元`,
    threshold: '每股净资产 < 0',
    note: '净资产为负是退市风险警示的重要触发条件',
  });

  // 连续亏损（用当期净利 + 同比推断，仅作提示）
  items.push({
    key: 'loss_warning',
    category: 'st',
    label: '亏损且可能触发退市条件',
    hit: netProfit !== null && netProfit < 0 && (bps ?? 1) < 1,
    insufficient: netProfit === null || bps === null,
    penalty: 15,
    actual: netProfit === null ? '—' : `净利 ${(netProfit / 1e8).toFixed(2)} 亿`,
    threshold: '净利润 < 0 且 每股净资产 < 1 元',
    note: '仅作提示，实际是否 ST 以交易所公告为准',
  });

  return items;
}

/* ------------------------------------------------------------------ *
 * 判据：市场类（用业绩预告衡量，可做的部分）
 * ------------------------------------------------------------------ */

function buildMarketItems(b: FinancialBundle): RiskItem[] {
  const p = b.predict;
  const type = (p?.PREDICT_TYPE ?? '').trim();
  const content = p?.PREDICT_CONTENT ?? '';

  /**
   * 负面预告类型白名单（用「精确等于」而非模糊匹配）。
   * ⚠️ 踩坑：不能用 includes 匹配「减」字——「减亏」是**改善**信号（亏损收窄），
   *    早期实现用 /下滑|亏损|预减|略减/ 会把「减亏」误判为风险。
   * ⚠️ 另注：`略减` 表示小幅下滑，属负面但程度轻，单独给较低扣分。
   */
  const SEVERE = ['首亏', '续亏', '预减', '预亏', '亏损'];
  const MILD = ['略减', '减亏'];  // 减亏 = 亏损收窄 → 不算风险

  const isSevere = SEVERE.some((t) => type.includes(t));
  const isMildNegative = type.includes('略减') || /下降|下滑/.test(type);
  const isImproving = MILD.some((t) => type.includes(t)) && !isSevere && !isMildNegative;

  /**
   * 时效性检查：业绩预告讲的是「某个报告期的业绩」。
   * 若公告日期距今年超过 18 个月，说明是旧预告，不应据此判定当期风险。
   */
  const noticeDate = p?.NOTICE_DATE ? new Date(p.NOTICE_DATE).getTime() : 0;
  const stale = !!p && noticeDate > 0 && Date.now() - noticeDate > 18 * 30 * 24 * 3600 * 1000;

  const items: RiskItem[] = [];
  const label = isSevere ? '业绩预告：重大负面' : isMildNegative ? '业绩预告：小幅下滑' : '业绩预告预警';

  items.push({
    key: 'profit_preannounce',
    category: 'market',
    label,
    hit: (isSevere || isMildNegative) && !isImproving && !stale,
    insufficient: !p || stale,
    penalty: isSevere ? 12 : 5,
    actual: p
      ? `${type || '—'}${p.REPORT_DATE ? `（${p.REPORT_DATE.slice(0, 10)}）` : ''}${stale ? ' · 已过期' : ''}`
      : '—',
    threshold: '最新业绩预告为 首亏/续亏/预减/亏损/略减',
    note: !p
      ? '该公司未披露业绩预告（不等于无风险）'
      : stale
        ? `预告发布于 ${p.NOTICE_DATE?.slice(0, 10)}，距现在较久，不作为当期判据`
        : isImproving
          ? '预告类型为「减亏」，属改善信号，不计风险'
          : content.slice(0, 60),
  });

  return items;
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

/** 由总分映射风险等级（对齐扫雷宝五档） */
export function scoreToLevel(score: number): RiskLevel {
  if (score >= 90) return 'low';
  if (score >= 75) return 'mediumLow';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'mediumHigh';
  return 'high';
}

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  low: '低风险',
  mediumLow: '中低风险',
  medium: '中风险',
  mediumHigh: '中高风险',
  high: '高风险',
};

export const LEVEL_LABEL_EN: Record<RiskLevel, string> = {
  low: 'Low',
  mediumLow: 'Medium-low',
  medium: 'Medium',
  mediumHigh: 'Medium-high',
  high: 'High',
};

/** 生成体检报告 */
export function buildRiskReport(b: FinancialBundle, stockName?: string): RiskReport {
  const all = [
    ...buildFinancialItems(b),
    ...buildStItems(b, stockName),
    ...buildMarketItems(b),
  ];
  const items = all.filter((i) => i.hit);
  const penalty = items.reduce((s, i) => s + i.penalty, 0);
  const score = Math.max(0, 100 - penalty);

  return {
    code: b.code,
    name: b.name ?? stockName,
    score,
    level: scoreToLevel(score),
    items,
    all,
    missing: b.missing,
    reportDate: b.balance?.REPORT_DATE?.slice(0, 10) ?? b.summary?.REPORTDATE?.slice(0, 10),
  };
}

/** 组装机构评级参考（对应通达信「一致预期」） */
export function buildRatingReference(b: FinancialBundle): RatingReference | null {
  const r = b.rating;
  if (!r) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const buy = n(r.RATING_BUY_NUM);
  const add = n(r.RATING_ADD_NUM);
  const neu = n(r.RATING_NEUTRAL_NUM);
  const red = n(r.RATING_REDUCE_NUM);
  const sale = n(r.RATING_SALE_NUM);
  const total = buy + add + neu + red + sale;
  // 通达信口径：买入 5 分、增持 4 分、中性 3 分、减持 2 分、卖出 1 分，取加权平均
  const avg = total > 0 ? (buy * 5 + add * 4 + neu * 3 + red * 2 + sale * 1) / total : null;
  return {
    orgCount: n(r.RATING_ORG_NUM),
    buyNum: buy,
    addNum: add,
    neutralNum: neu,
    reduceNum: red,
    saleNum: sale,
    avgScore: avg,
    targetMin: num(r.DEC_AIMPRICEMIN),
    targetMax: num(r.DEC_AIMPRICEMAX),
    source: 'eastmoney',
  };
}