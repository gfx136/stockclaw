import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fmtMoney, fmtPercent, fmtPrice, fmtTurnover, upDownColor } from '@/lib/format';
import type { Stock } from '@/types/stock';

interface Props {
  stock: Stock;
  /** 是否已加入自选 */
  isFav: boolean;
  onPress?: (s: Stock) => void;
  /** 星标切换自选 */
  onToggleFav?: (s: Stock) => void;
  /** 长按（自选页删除用） */
  onLongPress?: (s: Stock) => void;
}

/**
 * 全部股票列表行（按产品规格 2.1）。
 * 行结构：名称+代码 / 最新价 / 涨跌幅(红涨绿跌) / 换手率 / 市值(万亿缩写) / 右侧星标。
 * 点击行进详情；点星标切换自选；长按（自选页删除）。
 */
export const StockTile = memo(function StockTile({ stock, isFav, onPress, onToggleFav, onLongPress }: Props) {
  const theme = useTheme();
  const chgColor = upDownColor(stock.changePercent);

  return (
    <Pressable
      onPress={() => onPress?.(stock)}
      onLongPress={onLongPress ? () => onLongPress(stock) : undefined}
      delayLongPress={400}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {/* 左：名称 + 代码 */}
      <View style={styles.left}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {stock.name || '—'}
        </Text>
        <Text style={[styles.code, { color: theme.textSecondary }]} numberOfLines={1}>
          {stock.code}
          {stock.turnover !== undefined ? `  换手${fmtTurnover(stock.turnover)}` : ''}
          {stock.marketCap ? `  市值${fmtMoney(stock.marketCap)}` : ''}
        </Text>
      </View>

      {/* 右：最新价 + 涨跌幅 */}
      <View style={styles.right}>
        <Text style={[styles.price, { color: theme.text }]}>{fmtPrice(stock.price)}</Text>
        <Text style={[styles.chg, { color: chgColor }]}>{fmtPercent(stock.changePercent)}</Text>
      </View>

      {/* 星标 */}
      <Pressable
        onPress={() => onToggleFav?.(stock)}
        hitSlop={10}
        style={styles.star}
        accessibilityLabel="自选">
        <Text style={[styles.starText, { color: isFav ? theme.tint : theme.textSecondary }]}>
          {isFav ? '★' : '☆'}
        </Text>
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
  left: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  code: { fontSize: 11, fontVariant: ['tabular-nums'] },
  right: { alignItems: 'flex-end', minWidth: 76 },
  price: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chg: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  star: { paddingLeft: 6, paddingVertical: 4 },
  starText: { fontSize: 20 },
});