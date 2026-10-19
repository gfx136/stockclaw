/**
 * 指标色板（补充规格 v1.2 §2）——全 App 唯一色源。
 *
 * 硬规则（验收重点 S28/S29）：
 * 1. 每个指标一条独立固定颜色，相邻指标不得同色或近似；
 * 2. 同一指标四处颜色完全一致：① K线曲线 ② 图例 ③ 速览带色点 ④ 十字光标信息条；
 * 3. 颜色不随主题反转色相（深色仅提亮，色相一致）；
 * 4. 按键固定表，与 10 个独立开关一一对应。
 *
 * 线宽：BBI 1.6pt（最粗，主判据）> MA20/MA26 1.2pt > 其余 1.0pt；
 * 叠加顺序：MA20 → MA26 → BBI（BBI 画最上层）。
 */

export type IndicatorKey =
  | 'ma5' | 'ma10' | 'ma20' | 'ma26' | 'ma60'
  | 'boll' | 'bollMid' | 'bollLower'
  | 'macdDif' | 'macdDea'
  | 'kdjK' | 'kdjD' | 'kdjJ'
  | 'rsi' | 'bbi';

interface ColorPair {
  light: string;
  dark: string;
  /** 线宽 pt */
  width: number;
  /** 是否为虚线 */
  dashed?: boolean;
}

/** 色板（§2.2 建议值，互不近似） */
export const INDICATOR_COLORS: Record<IndicatorKey, ColorPair> = {
  // —— BBI 主趋势线：靛蓝，最粗 ——
  bbi: { light: '#3949AB', dark: '#7986CB', width: 1.6 },
  // —— 三条重点线：MA20 琥珀黄 / MA26 品红（冷暖对立，便于比较 BBI>MA26）——
  ma20: { light: '#FFB300', dark: '#FFCA28', width: 1.2 },
  ma26: { light: '#E91E63', dark: '#F06292', width: 1.2 },
  // —— 其余均线 ——
  ma5: { light: '#607D8B', dark: '#90A4AE', width: 1.0 },
  ma10: { light: '#009688', dark: '#4DB6AC', width: 1.0 },
  ma60: { light: '#5E35B1', dark: '#9575CD', width: 1.0 },
  // —— BOLL 三轨 ——
  boll: { light: '#F4511E', dark: '#FF8A65', width: 0.9 },       // 上轨
  bollMid: { light: '#78909C', dark: '#B0BEC5', width: 0.9, dashed: true }, // 中轨（虚线）
  bollLower: { light: '#039BE5', dark: '#4FC3F7', width: 0.9 },  // 下轨
  // —— MACD ——
  macdDif: { light: '#FF8F00', dark: '#FFB74D', width: 1.0 },
  macdDea: { light: '#5D4037', dark: '#A1887F', width: 1.0 },
  // —— KDJ ——
  kdjK: { light: '#26A69A', dark: '#4DB6AC', width: 1.0 },
  kdjD: { light: '#FFA726', dark: '#FFCC80', width: 1.0 },
  kdjJ: { light: '#AB47BC', dark: '#CE93D8', width: 1.0 },
  // —— RSI ——
  rsi: { light: '#7E57C2', dark: '#B39DDB', width: 1.0 },
};

/** 取指标色（主题感知，色相不变仅提亮）—— 速览带/图例用键别名 */
export function indicatorColor(key: string, isDark: boolean): string {
  const alias: Record<string, IndicatorKey> = {
    macd: 'macdDif',
    kdj: 'kdjJ',
    ma5: 'ma5', ma10: 'ma10', ma20: 'ma20', ma26: 'ma26', ma60: 'ma60',
    boll: 'boll', bollMid: 'bollMid', bollLower: 'bollLower',
    macdDif: 'macdDif', macdDea: 'macdDea',
    kdjK: 'kdjK', kdjD: 'kdjD', kdjJ: 'kdjJ',
    rsi: 'rsi', bbi: 'bbi',
  };
  const k = alias[key] ?? 'ma60';
  const c = INDICATOR_COLORS[k];
  return isDark ? c.dark : c.light;
}

/** 取线宽 */
export function indicatorWidth(key: IndicatorKey): number {
  return INDICATOR_COLORS[key].width;
}

/** 是否虚线 */
export function indicatorDashed(key: IndicatorKey): boolean {
  return !!INDICATOR_COLORS[key].dashed;
}

/** 图例/速览带要展示的「主图叠加」指标顺序（叠加顺序 = 绘制顺序，BBI 最后=最上层） */
export const MAIN_OVERLAY_ORDER: IndicatorKey[] = [
  'ma5', 'ma10', 'ma20', 'ma26', 'ma60', 'boll', 'bbi',
];

/** 指标显示名（图例、速览带、Sheet 共用） */
export const INDICATOR_LABELS: Record<string, string> = {
  ma5: 'MA5', ma10: 'MA10', ma20: 'MA20', ma26: 'MA26', ma60: 'MA60',
  boll: 'BOLL', macd: 'MACD', kdj: 'KDJ', rsi: 'RSI', bbi: 'BBI',
};

/** 10 个独立开关的键（§2.4，规格 C13） */
export type IndicatorToggleKey = 'ma5' | 'ma10' | 'ma20' | 'ma26' | 'ma60' | 'boll' | 'bbi' | 'macd' | 'kdj' | 'rsi';

/** 默认开关状态（§4.4：BBI/MA20/MA26 默认开，MACD 默认开，KDJ/RSI 默认关） */
export const DEFAULT_INDICATOR_TOGGLES: Record<IndicatorToggleKey, boolean> = {
  ma5: true, ma10: true, ma20: true, ma26: true, ma60: false,
  boll: false, bbi: true, macd: true, kdj: false, rsi: false,
};