import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { indicatorColor } from '@/lib/indicator-palette';

/**
 * 指标速览带（补充规格 v1.2 §4.4）——一条横向条带，非卡片网格。
 * 竖屏两行各 3 项（固定顺序 BBI/MA20/MA26/MACD/KDJ/RSI），横屏单行 6 项横滚。
 * 单项 = 色点（同指标线色）+ 指标名 11pt + 数值 14pt 等宽 + 判定 10pt。
 * 未开启项占位（40% 不透明）显示「未开启」，点按可直接开启。
 */

export interface OverviewItem {
  key: 'bbi' | 'ma20' | 'ma26' | 'macd' | 'kdj' | 'rsi';
  name: string;
  value: string;
  judge: string;
  enabled: boolean;
}

interface Props {
  items: OverviewItem[];
  /** 选中 bar 的日期（长按联动时显示） */
  selectDate?: string | null;
  landscape?: boolean;
  /** 点按未开启项时开启该指标 */
  onToggle?: (key: OverviewItem['key']) => void;
  /** 「完整指标数值」入口 */
  onOpenFull?: () => void;
  isDark?: boolean;
}

export function IndicatorOverviewStrip({ items, selectDate, landscape = false, onToggle, onOpenFull, isDark = true }: Props) {
  const theme = useTheme();

  const renderItem = (it: OverviewItem) => (
    <Pressable
      key={it.key}
      onPress={() => { if (!it.enabled) onToggle?.(it.key); }}
      style={landscape ? styles.itemLand : styles.item}
      accessibilityLabel={`${it.name} ${it.value} ${it.judge}`}>
      <View style={[styles.itemInner, { opacity: it.enabled ? 1 : 0.4 }]}>
        <View style={styles.itemHead}>
          <View style={[styles.dot, { backgroundColor: indicatorColor(it.key, isDark) }]} />
          <Text style={[styles.name, { color: theme.textSecondary }]} numberOfLines={1}>{it.name}</Text>
        </View>
        <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
          {it.enabled ? it.value : '未开启'}
        </Text>
        {it.enabled ? (
          <Text style={[styles.judge, { color: theme.textSecondary }]} numberOfLines={1}>{it.judge}</Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      {landscape ? (
        <View style={styles.landRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.landScroll}>
            {items.map(renderItem)}
          </ScrollView>
          {onOpenFull ? (
            <Pressable onPress={onOpenFull} hitSlop={8} style={styles.moreBtn}>
              <Text style={[styles.moreText, { color: theme.textSecondary }]}>⋯</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.row}>{items.slice(0, 3).map(renderItem)}</View>
          <View style={[styles.row, styles.rowGap]}>{items.slice(3, 6).map(renderItem)}</View>
          {onOpenFull ? (
            <View style={styles.footer}>
              <Text style={[styles.latestTag, { color: theme.textSecondary }]}>
                {selectDate ? selectDate : '最新'}
              </Text>
              <Pressable onPress={onOpenFull} hitSlop={10}>
                <Text style={[styles.fullLink, { color: theme.textSecondary }]}>完整指标数值 ›</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  rowGap: { marginTop: 8 },
  item: { flex: 1, height: 60, justifyContent: 'center' },
  itemLand: { width: 132, height: 52, justifyContent: 'center', marginRight: 10 },
  itemInner: { gap: 2 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 11 },
  value: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  judge: { fontSize: 10 },
  landRow: { flexDirection: 'row', alignItems: 'center' },
  landScroll: { alignItems: 'center' },
  moreBtn: { paddingLeft: 6 },
  moreText: { fontSize: 16, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, height: 28 },
  latestTag: { fontSize: 10 },
  fullLink: { fontSize: 10 },
});