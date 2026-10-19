import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { fmtMoney, fmtPrice, upDownColor } from '@/lib/format';
import type { Stock } from '@/types/stock';

interface Props {
  stock: Stock;
  /** 是否已加入自选 */
  isFav: boolean;
  onPress?: (s: Stock) => void;
  /** 星标切换自选 */
  onToggleFav?: (s: Stock) => void;
  /** 长按（加自选 / 取消自选） */
  onLongPress?: (s: Stock) => void;
}

/**
 * 股票列表行（补充规格 §1.7）。
 * 通栏行，固定行高 56pt，5 列与表头逐列共基线：代码 / 名称 / 最新价 / 涨跌幅 / 成交额，最右星标。
 * 代码前缀（sh/sz/bj）小字弱化；涨跌红涨绿跌带 ▲/▼；成交额万/亿缩写。
 * 点击进详情；点星标切自选；长按 0.5s 加/取消自选。
 */
export const StockTile = memo(function StockTile({ stock, isFav, onPress, onToggleFav, onLongPress }: Props) {
  const theme = useTheme();
  const chgColor = upDownColor(stock.changePercent);
  const flat = !stock.changePercent || stock.changePercent === 0;
  const arrow = flat ? '' : stock.changePercent! > 0 ? '▲' : '▼';
  const hasPrice = stock.price > 0;

  // 代码前缀弱化：sh600000 → sh(小灰) + 600000
  const codePrefix = stock.code.replace(/\d/g, '');
  const codeNum = stock.code.replace(/\D/g, '');

  return (
    <Pressable
      onPress={() => onPress?.(stock)}
      onLongPress={onLongPress ? () => onLongPress(stock) : undefined}
      delayLongPress={500}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {/* 代码 */}
      <View style={[styles.col, { flex: 22 }]}>
        <Text style={[styles.code, { color: theme.textSecondary }]} numberOfLines={1}>
          <Text style={styles.codePrefix}>{codePrefix}</Text>
          {codeNum}
        </Text>
      </View>
      {/* 名称 */}
      <View style={[styles.col, { flex: 26 }]}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
          {stock.name || '—'}
        </Text>
      </View>
      {/* 最新价 */}
      <View style={[styles.col, styles.right, { flex: 16 }]}>
        <Text style={[styles.price, { color: hasPrice ? chgColor : theme.textSecondary }]} numberOfLines={1}>
          {hasPrice ? fmtPrice(stock.price) : '--'}
        </Text>
      </View>
      {/* 涨跌幅 */}
      <View style={[styles.col, styles.right, { flex: 16 }]}>
        {hasPrice && !flat ? (
          <Text style={[styles.chg, { color: chgColor }]} numberOfLines={1}>
            {arrow}{Math.abs(stock.changePercent!).toFixed(2)}%
          </Text>
        ) : (
          <Text style={[styles.chg, { color: theme.textSecondary }]} numberOfLines={1}>--</Text>
        )}
      </View>
      {/* 成交额 */}
      <View style={[styles.col, styles.right, { flex: 20 }]}>
        <Text style={[styles.amount, { color: theme.textSecondary }]} numberOfLines={1}>
          {stock.amount ? fmtMoney(stock.amount) : '--'}
        </Text>
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
    height: 56,
    paddingHorizontal: 16,
  },
  pressed: { opacity: 0.55 },
  col: { justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  code: { fontSize: 13, fontVariant: ['tabular-nums'] },
  codePrefix: { fontSize: 10, opacity: 0.6 },
  name: { fontSize: 15, fontWeight: '600' },
  price: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chg: { fontSize: 12, fontVariant: ['tabular-nums'] },
  amount: { fontSize: 12, fontVariant: ['tabular-nums'] },
  star: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  starText: { fontSize: 20 },
});