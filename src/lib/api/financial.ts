/**
 * 财务与评级数据接口层（方案 A：自建财务风险体检 + 机构评级参考）。
 *
 * 数据源：东方财富公开数据中心（datacenter-web.eastmoney.com），
 * 免登录、免鉴权。已在开发期实测以下报表名与字段可用：
 *
 * | reportName                  | 用途                     | 实测                       |
 * |-----------------------------|--------------------------|----------------------------|
 * | RPT_DMSK_FN_BALANCE         | 资产负债表               | 负债率/流动比率/货币资金   |
 * | RPT_LICO_FN_CPD             | 财务摘要                 | ROE/EPS/扣非EPS/净利/毛利率|
 * | RPT_DMSK_FN_CASHFLOW        | 现金流量表               | 经营现金流净额             |
 * | RPT_F10_FINANCE_GBALANCE    | 商誉表                   | GOODWILL（不在此表以外）   |
 * | RPT_PUBLIC_OP_NEWPREDICT    | 业绩预告                 | 预告类型/金额区间          |
 * | RPT_WEB_RESPREDICT          | **机构评级/一致预期**     | 机构数/买入数/目标价/EPS预测|
 *
 * ⚠️ 踩坑记录：`RPT_CUSTOM_STOCK_PLEDGE_*` / `RPT_STOCK_PLEDGE_STATISTICS` 等
 *    报表名**不存在**（报 code:9501 报表配置不存在），股权质押要用 `RPT_CSDC_LIST`。
 *    商誉**不在** `RPT_DMSK_FN_BALANCE` 里（该表无 GOODWILL 字段），必须用 F10 商誉表。
 *
 * 拉取策略：**按需拉取**（用户打开个股详情/风险页时才拉这只票）。
 * 接口本身支持批量（`in` 语法 / 按报告期整市场），后续若要做全市场扫描可复用。
 */

const DC = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/** 带超时的 JSON 请求（数据中心接口偶尔较慢，给 20s） */
async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StockClaw/1.0)',
        Referer: 'https://data.eastmoney.com/',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface DcResponse<T> {
  success?: boolean;
  message?: string;
  code?: number;
  result?: { pages?: number; count?: number; data?: T[] } | null;
}

/** 通用数据中心查询 */
async function dcQuery<T>(params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams({
    columns: 'ALL',
    source: 'WEB',
    client: 'WEB',
    ...params,
  }).toString();
  const json = await fetchJson<DcResponse<T>>(`${DC}?${qs}`);
  if (!json?.success || !json.result?.data) return [];
  return json.result.data;
}

/** 取「最近报告期」的财务数据（按报告期倒序取第一条） */
async function latestByReport<T>(reportName: string, code: string): Promise<T | null> {
  const rows = await dcQuery<T>({
    reportName,
    filter: `(SECURITY_CODE="${code}")`,
    pageSize: '1',
    pageNumber: '1',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  });
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * 各报表的原始行类型（只声明我们用到的字段）
 * ------------------------------------------------------------------ */

/** 资产负债表 */
export interface BalanceRow {
  SECURITY_CODE: string;
  SECURITY_NAME_ABBR: string;
  REPORT_DATE: string;
  TOTAL_ASSETS: number | null;
  TOTAL_LIABILITIES: number | null;
  MONETARYFUNDS: number | null;
  ACCOUNTS_RECE: number | null;
  INVENTORY: number | null;
  TOTAL_EQUITY: number | null;
  /** 资产负债率 % */
  DEBT_ASSET_RATIO: number | null;
  /** 流动比率 */
  CURRENT_RATIO: number | null;
  ACCOUNTS_PAYABLE: number | null;
}

/** 财务摘要 */
export interface SummaryRow {
  SECURITY_CODE: string;
  SECURITY_NAME_ABBR: string;
  REPORTDATE: string;
  BASIC_EPS: number | null;
  DEDUCT_BASIC_EPS: number | null;
  TOTAL_OPERATE_INCOME: number | null;
  PARENT_NETPROFIT: number | null;
  WEIGHTAVG_ROE: number | null;
  BPS: number | null;
  XSMLL: number | null;
  /** 营收同比增长 % */
  YSTZ: number | null;
  /** 净利同比增长 % */
  SJLTZ: number | null;
}

/** 现金流量表 */
export interface CashflowRow {
  SECURITY_CODE: string;
  REPORT_DATE: string;
  /** 经营活动现金流净额 */
  NETCASH_OPERATE: number | null;
}

/** 商誉表（F10） */
export interface GoodwillRow {
  SECURITY_CODE: string;
  SECURITY_NAME_ABBR: string;
  REPORT_DATE: string;
  GOODWILL: number | null;
  TOTAL_ASSETS: number | null;
  TOTAL_LIABILITIES: number | null;
  MONETARYFUNDS: number | null;
}

/** 业绩预告 */
export interface PredictRow {
  SECURITY_CODE: string;
  SECURITY_NAME_ABBR: string;
  NOTICE_DATE: string;
  REPORT_DATE: string;
  PREDICT_FINANCE: string | null;
  PREDICT_TYPE: string | null;
  PREDICT_AMT_LOWER: number | null;
  PREDICT_AMT_UPPER: number | null;
  PREDICT_CONTENT: string | null;
}

/** 机构评级 / 一致预期 */
export interface RatingRow {
  SECURITY_CODE: string;
  SECURITY_NAME_ABBR: string;
  /** 参与评级的机构总数 */
  RATING_ORG_NUM: number | null;
  RATING_BUY_NUM: number | null;
  RATING_ADD_NUM: number | null;
  RATING_NEUTRAL_NUM: number | null;
  RATING_REDUCE_NUM: number | null;
  RATING_SALE_NUM: number | null;
  /** 目标价上限 / 下限 */
  DEC_AIMPRICEMAX: number | null;
  DEC_AIMPRICEMIN: number | null;
  /** 未来 EPS 预测（用当前价反推目标价合理性时可用） */
  YEAR1: number | null;
  EPS1: number | null;
  YEAR2: number | null;
  EPS2: number | null;
  YEAR3: number | null;
  EPS3: number | null;
  INDUSTRY_BOARD: string | null;
}

/* ------------------------------------------------------------------ *
 * 对外接口
 * ------------------------------------------------------------------ */

/** 一次性拉齐某只股票的全部财务与评级数据（并行 5 个请求） */
export interface FinancialBundle {
  code: string;
  name?: string;
  balance: BalanceRow | null;
  summary: SummaryRow | null;
  cashflow: CashflowRow | null;
  goodwill: GoodwillRow | null;
  predict: PredictRow | null;
  rating: RatingRow | null;
  /** 拉取失败的报表名（用于 UI 提示「部分数据缺失」） */
  missing: string[];
}

async function safe<T>(p: Promise<T | null>): Promise<{ v: T | null; failed: boolean }> {
  try {
    return { v: await p, failed: false };
  } catch {
    return { v: null, failed: true };
  }
}

/** 按需拉取单只股票的财务+评级数据 */
export async function fetchFinancialBundle(code: string): Promise<FinancialBundle> {
  const [balance, summary, cashflow, goodwill, predict, rating] = await Promise.all([
    safe(latestByReport<BalanceRow>('RPT_DMSK_FN_BALANCE', code)),
    safe(latestByReport<SummaryRow>('RPT_LICO_FN_CPD', code)),
    safe(latestByReport<CashflowRow>('RPT_DMSK_FN_CASHFLOW', code)),
    safe(latestByReport<GoodwillRow>('RPT_F10_FINANCE_GBALANCE', code)),
    safe(latestByReport<PredictRow>('RPT_PUBLIC_OP_NEWPREDICT', code)),
    safe(
      dcQuery<RatingRow>({
        reportName: 'RPT_WEB_RESPREDICT',
        filter: `(SECURITY_CODE="${code}")`,
        pageSize: '1',
        pageNumber: '1',
      }).then((rows) => rows[0] ?? null)
    ),
  ]);

  const missing: string[] = [];
  if (balance.failed) missing.push('balance');
  if (summary.failed) missing.push('summary');
  if (cashflow.failed) missing.push('cashflow');
  if (goodwill.failed) missing.push('goodwill');
  if (predict.failed) missing.push('predict');
  if (rating.failed) missing.push('rating');

  return {
    code,
    name:
      summary.v?.SECURITY_NAME_ABBR ??
      balance.v?.SECURITY_NAME_ABBR ??
      rating.v?.SECURITY_NAME_ABBR,
    balance: balance.v,
    summary: summary.v,
    cashflow: cashflow.v,
    goodwill: goodwill.v,
    predict: predict.v,
    rating: rating.v,
    missing,
  };
}

/* ------------------------------------------------------------------ *
 * 批量能力（供后续「全市场扫描」复用，当前按需拉取用不到）
 * ------------------------------------------------------------------ */

/**
 * 按报告期批量拉全市场某张报表（一页 5000 条上限内）。
 * 实测：资产负债表 5582 只 / 1117 页（pageSize=5 时）。
 * 若启用全市场扫描，建议 pageSize=500、按报告期循环，约 12 页拉完一张表。
 */
export async function fetchStatementByPeriod<T>(
  reportName: string,
  reportDate: string,
  pageSize = 500,
  pageNumber = 1
): Promise<T[]> {
  return dcQuery<T>({
    reportName,
    filter: `(REPORT_DATE='${reportDate}')`,
    pageSize: String(pageSize),
    pageNumber: String(pageNumber),
    sortColumns: 'SECURITY_CODE',
    sortTypes: '1',
  });
}

/**
 * 按代码列表批量拉（`in` 语法，实测可用）。
 * 适合「自选/结果页几十只票一次拉完」的场景，比逐只请求快得多。
 */
export async function fetchFinancialByCodes<T>(
  reportName: string,
  codes: string[],
  pageSize = 500
): Promise<T[]> {
  if (codes.length === 0) return [];
  const list = codes.map((c) => `"${c}"`).join(',');
  return dcQuery<T>({
    reportName,
    filter: `(SECURITY_CODE in (${list}))`,
    pageSize: String(pageSize),
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  });
}