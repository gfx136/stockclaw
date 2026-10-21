import { SymbolView, type SFSymbol, type SymbolWeight } from 'expo-symbols';
import { Platform, Text, View, type ColorValue } from 'react-native';

interface Props {
  /** SF Symbols 名称（iOS 12+ 通用图标，避免用新系统才有的） */
  name: SFSymbol;
  size?: number;
  color?: ColorValue;
  weight?: SymbolWeight;
  /**
   * 非 iOS 平台的兜底（web / Android）。iOS 上永远不会走到这里。
   * 传旧的字形文本即可，保证 web 预览不出现空白图标。
   */
  fallbackGlyph?: string;
}

/**
 * 统一图标组件（SF Symbols）。
 *
 * UI 评审修正背景：原来全 App 混用三套图标来源 ——
 *   ① emoji（📈📋⭐⚙️🔍）—— 自带彩色、不响应 tintColor，Tab 选中态在图标上完全看不出；
 *   ② 标点/数学字形（⧩ ▾ ⟳ ✕ ⋮ ‹ ★ ☆ ⤴ ◀ ▶）—— 粗细与基线各自为政，
 *      其中 ⧩(U+29E9) 属数学符号 Misc-B 区冷门码位，iOS 系统字体大概率缺字，
 *      会渲染成豆腐块或空白（与此前 ⤢ 变空白同类事故）；
 *   ③ 图表 SVG。
 *
 * 统一走 SF Symbols 后：单一视觉语言 + 自动跟随 tintColor（选中态可用同一个图标换色）。
 * 非 iOS 平台用 fallbackGlyph 回退到原来的字形，行为不变。
 */
export function Icon({ name, size = 18, color, weight = 'semibold', fallbackGlyph }: Props) {
  if (Platform.OS !== 'ios') {
    if (fallbackGlyph) {
      return (
        <Text style={{ fontSize: size, color, lineHeight: size * 1.2, textAlign: 'center' }}>
          {fallbackGlyph}
        </Text>
      );
    }
    return <View style={{ width: size, height: size }} />;
  }

  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      // 宽度固定，避免不同符号的固有宽度把相邻元素挤来挤去
      style={{ width: size * 1.15, height: size * 1.15 }}
    />
  );
}
