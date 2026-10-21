/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    /** 分隔线 */
    border: '#E3E4E8',
    /**
     * 强调色（按钮 / 选中）。
     * UI 评审修正：原 #208AEF 上压白字只有 3.53:1（11–13pt 需 4.5）。
     * #1668BF 作文字 / 白字压其上均为 5.58:1，卡片底 4.90:1。
     */
    tint: '#1668BF',
    /**
     * 压在「实色填充」上的文字色（选中 chip、评分徽章、等级胶囊、涨跌胶囊）。
     * 浅色主题底色深 → 用白字；深色主题底色亮 → 必须用深字，否则直接掉到 2.5:1。
     */
    onAccent: '#FFFFFF',
    /**
     * 图表网格线。不能复用 border：UI 分隔线可以极淡，
     * 但网格线压在卡片上没有 1.5:1 就完全看不见（原值仅 1.12:1）。
     */
    chartGrid: '#B9BEC8',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    border: '#3A3D42',
    tint: '#4DA3F5',
    onAccent: '#0B0F13',
    chartGrid: '#42464D',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * 语义色（补充规格 §5.4 色彩纪律）：成功/警告/错误 专用，不得挪作他用。
 * 涨跌色不在此处——它是 A 股专用语义（涨红跌绿），见 lib/format.ts 的 QuoteColors。
 *
 * UI 评审修正（2026-10-21）：原来只有 3 个角色，风险体检页的「中高 / 中低」两档
 * 在组件里硬编码 #F97316 / #84CC16 —— 后者白字仅 1.98:1、作 44pt 分数文字压卡片仅 1.74:1，
 * 等于那一档的结论读不出来。现在补齐成 5 档并全部纳入主题体系。
 *
 * 取值约束（两套都必须满足，因为同一色既当文字又当填充）：
 *   浅色：白字压其上 ≥4.5，本身作文字压 #fff ≥4.5
 *   深色：本身作文字压 #000 ≥4.5，深字（onAccent）压其上 ≥4.5
 */
export const SemanticColors = {
  light: {
    success: '#0B6E4B',   // 白字 6.28 / 作文字 6.28
    warning: '#A8450A',   // 白字 5.96 / 作文字 5.96 / 卡片 5.24
    danger: '#C1121F',    // 6.22 / 6.22
    mediumHigh: '#C2410C', // 5.18 / 5.18
    mediumLow: '#47730D',  // 5.64 / 5.64 / 卡片 4.96
  },
  dark: {
    success: '#4ADE80',   // on #000 12.05 / 深字 10.4
    warning: '#FBBF24',   // 12.58 / 11.3
    danger: '#FF6B6B',    // 7.57 / 6.6
    mediumHigh: '#FB923C', // 9.28 / 8.1
    mediumLow: '#A3E635',  // 13.93 / 12.4
  },
} as const;

export type SemanticKind = keyof typeof SemanticColors.light;

export function semanticColor(kind: SemanticKind, isDark: boolean): string {
  return isDark ? SemanticColors.dark[kind] : SemanticColors.light[kind];
}

/**
 * K 线周期固定色标（补充规格 §6.3）：便于本地数据管理与图表周期切换对照。
 * 全 App 唯一来源。
 */
export const PeriodColors = {
  '60min': '#4DA3F5',
  daily: '#26A69A',
  weekly: '#FFB300',
  monthly: '#E91E63',
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * 圆角档位（UI 评审：原来散落 12 档 2/3/4/6/8/10/12/14/16/18/20/40）。
 * 按「视觉重量」归位，新代码一律用这里，不要再写裸数字：
 *   chip   小控件（周期按钮、条件 chip、标签）
 *   card   卡片（设置分组、图表卡、风险条目）
 *   sheet  弹层（底部面板、模态面板）
 *   pill   胶囊（圆形徽章、筛选胶囊、进度轨道）
 */
export const Radius = {
  chip: 8,
  card: 12,
  sheet: 16,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
