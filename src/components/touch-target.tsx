import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

interface Props {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** 选中态（用于分段控件 / chip），会同时同步给无障碍 */
  selected?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** 视觉外观（背景 / 圆角等），尺寸由组件保证 */
  style?: StyleProp<ViewStyle>;
  /** 额外的命中区扩展。组件自身已保证 44×44，通常不需要再传 */
  hitSlop?: number;
  children: ReactNode;
}

/**
 * 44pt 触控目标包装器。
 *
 * UI 评审修正背景：全 App 有 9 处把 `Pressable` 直接包在 13–14pt 文本上，
 * 靠 `hitSlop` 补到 29–39pt，仍低于 iOS 建议的 44×44pt（详情页选项行只有 33pt，
 * 且「复位」与「横屏」相邻仅 10pt，误触会把用户调好的缩放重置掉）。
 *
 * 用法：把裸 `Pressable` 换成它，内部文本样式不用动。
 * 视觉上很小的文字按钮也能获得合规命中区，不必为了撑大而破坏排版。
 *
 * ⚠️ 若父容器高度小于 44（如固定 40 的行），请先把父容器改到 ≥44，
 *    否则子元素会溢出而不是被裁切（RN 默认 overflow visible）。
 */
export function TouchTarget({
  onPress,
  onLongPress,
  disabled,
  selected,
  accessibilityLabel,
  accessibilityHint,
  style,
  hitSlop,
  children,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, selected }}
      hitSlop={hitSlop}
      style={({ pressed }) => [styles.base, style, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // 44×44 是 iOS HIG 的触控目标下限；minWidth 让纯文字按钮也能达标
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.55 },
});
