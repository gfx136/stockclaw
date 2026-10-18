import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fmtMoney, fmtPercent, fmtPrice, upDownColor } from '@/lib/format';
import type { Stock } from '@/types/stock';

interface Props {
  stock: Stock;
  /** 评分徽章数值（0-1000）。算法未确认时的占位值 */
  score?: number;
  onPress?: (s: Stock) => void;
  onLongPress?: (s: Stock) => void;
  onMenu?: (s: Stock) => void;
}

/**
 * 全部股票列表单行（按界面规格）。
 * 布局：评分徽章(蓝圆) | 名称+代码 | 成交额+涨跌幅+现价 | 更多菜单(⋮)
 * ⚠️ 涨跌幅颜色：A 股口径涨红跌绿。
 */
export const StockListItem = memo(function StockListItem({
  stock,
  score,
  onPress,
  onLongPress,
  onMenu,
}: Props) {
  const theme = useTheme();
  const color = upDownColor(stock.changePercent);

  return (
    <Pressable
      onPress={() => onPress?.(stock)}
      onLongPress={() => onLongPress?.(stock)}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {/* 评分徽章（蓝色圆）。算法待确认，先占位 */}
      <View style={styles.scoreBadge}>
        <Text style={styles.scoreText}>{score !== undefined ? score : '—'}</Text>
      </View>

      {/* 名称 + 代码 */}
      <View style={styles.mid}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {stock.name || '—'}
        </Text>
        <Text style={[styles.code, { color: theme.textSecondary }]} numberOfLines={1}>
          {stock.code}
        </Text>
      </View>

      {/* 成交额 + 涨跌幅 + 现价 */}
      <View style={styles.right}>
        <Text style={[styles.amount, { color: theme.textSecondary }]}>
          {stock.amount ? fmtMoney(stock.amount) : '—'}
        </Text>
        <View style={styles.priceRow}>
          <Text style={[styles.pct, { color }]}>{fmtPercent(stock.changePercent)}</Text>
          <Text style={[styles.price, { color: theme.text }]}>{fmtPrice(stock.price)}</Text>
        </View>
      </View>

      {/* 更多菜单 */}
      <Pressable onPress={() => onMenu?.(stock)} hitSlop={8} style={styles.menu}>
        <Text style={[styles.menuText, { color: theme.textSecondary }]}>⋮</Text>
      </Pressable>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  pressed: { opacity: 0.55 },
  scoreBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  mid: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  code: { fontSize: 12, fontVariant: ['tabular-nums'] },
  right: { alignItems: 'flex-end', gap: 2, minWidth: 96 },
  amount: { fontSize: 11, fontVariant: ['tabular-nums'] },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  pct: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  price: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  menu: { paddingLeft: 4 },
  menuText: { fontSize: 18 },
});