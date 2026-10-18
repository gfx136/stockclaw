import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fmtMoney, fmtPercent, fmtPrice, upDownColor } from '@/lib/format';
import type { Stock } from '@/types/stock';

interface Props {
  stock: Stock;
  onPress?: (s: Stock) => void;
  onLongPress?: (s: Stock) => void;
}

/**
 * 行情列表单行。
 * 布局：左（名称 + 代码） / 中（成交额等次要信息） / 右（价格 + 涨跌幅）
 * ⚠️ 涨跌幅颜色走 A 股口径：涨红跌绿。
 */
export const QuoteRow = memo(function QuoteRow({ stock, onPress, onLongPress }: Props) {
  const color = upDownColor(stock.changePercent);
  const sub = stock.amount
    ? `额 ${fmtMoney(stock.amount)}`
    : stock.turnover !== undefined
      ? `换手 ${stock.turnover.toFixed(2)}%`
      : '';

  return (
    <Pressable
      onPress={() => onPress?.(stock)}
      onLongPress={onLongPress ? () => onLongPress(stock) : undefined}
      delayLongPress={350}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <View style={styles.left}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {stock.name || '—'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {stock.code}
          {sub ? `  ${sub}` : ''}
        </ThemedText>
      </View>

      <View style={styles.right}>
        <ThemedText type="smallBold" style={[styles.price, { color }]}>
          {fmtPrice(stock.price)}
        </ThemedText>
        <View style={[styles.pctBox, { backgroundColor: color }]}>
          <ThemedText type="small" style={styles.pctText}>
            {fmtPercent(stock.changePercent)}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  pressed: { opacity: 0.55 },
  left: { flex: 1, gap: Spacing.half },
  name: { fontSize: 16, lineHeight: 22 },
  right: { alignItems: 'flex-end', gap: Spacing.one, minWidth: 84 },
  price: { fontSize: 16, lineHeight: 22, fontVariant: ['tabular-nums'] },
  pctBox: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    borderRadius: Spacing.one,
    minWidth: 68,
    alignItems: 'center',
  },
  pctText: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
});