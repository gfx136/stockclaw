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
    /** 强调色（按钮 / 选中） */
    tint: '#208AEF',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    border: '#3A3D42',
    tint: '#4DA3F5',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * 语义色（补充规格 §5.4 色彩纪律）：成功/警告/错误 专用，不得挪作他用。
 * 涨跌色不在此处——它是 A 股专用语义（涨红跌绿），见 lib/format.ts 的 QuoteColors。
 */
export const SemanticColors = {
  light: { success: '#0F9B6C', warning: '#B26A00', danger: '#D63030' },
  dark: { success: '#26A69A', warning: '#FFB300', danger: '#FF5252' },
} as const;

export function semanticColor(kind: 'success' | 'warning' | 'danger', isDark: boolean): string {
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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
