import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { semanticColor } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { clearAllKlines, deleteByPeriod, dbStats, lastUpdateAt, perPeriodStats, type PeriodStat } from '@/lib/kline-db';
import type { KlinePeriod } from '@/types/stock';

/**
 * 本地数据管理明细页（补充规格 §4.3）。
 * 总览卡 + 分周期表（按周期删除）+ 清空全部（均二次确认）。
 * 删除不影响自选/筛选结果/排序偏好（那些存偏好存储，与 K 线库分离）。
 */

const PERIOD_LABEL: Record<KlinePeriod, string> = {
  '60min': '60分钟',
  daily: '日线',
  weekly: '周线',
  monthly: '月线',
};

/** 周期固定色标（§6.3：便于与图表周期切换对照） */
const PERIOD_COLOR: Record<KlinePeriod, string> = {
  '60min': '#4DA3F5',
  daily: '#26A69A',
  weekly: '#FFB300',
  monthly: '#E91E63',
};

function fmtBytes(b: number): string {
  if (b <= 0) return '0 B';
  if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}
function fmtTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function DataManageScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const [stats, setStats] = useState<{ totalBars: number; codes: number; bytes: number } | null>(null);
  const [periods, setPeriods] = useState<PeriodStat[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setStats(await dbStats());
    setPeriods(await perPeriodStats());
    setLastUpdate(await lastUpdateAt());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDeletePeriod = (p: PeriodStat) => {
    Alert.alert(
      `删除本地${PERIOD_LABEL[p.period]}数据`,
      `将删除本地${PERIOD_LABEL[p.period]}数据（${p.codes} 只股票）。删除后下次下载会重新补齐；联网模式不受影响。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await deleteByPeriod(p.period);
            await refresh();
          },
        },
      ]
    );
  };

  const onClearAll = () => {
    Alert.alert(
      '清空全部',
      `将移除此页全部 ${stats?.codes ?? 0} 只股票的本地 K 线数据。删除后下次下载会重新补齐；联网模式不受影响。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除全部',
          style: 'destructive',
          onPress: async () => {
            await clearAllKlines();
            await refresh();
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: '本地数据管理', headerBackTitle: '返回' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* 总览卡 */}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>总览</Text>
          <Row label="数据库" value="klines.db（App 私有目录）" theme={theme} />
          <Row label="总占用" value={stats ? fmtBytes(stats.bytes) : '—'} theme={theme} />
          <Row label="股票只数" value={stats ? `${stats.codes}` : '—'} theme={theme} />
          <Row label="总 K 线根数" value={stats ? stats.totalBars.toLocaleString() : '—'} theme={theme} />
          <Row label="最后更新" value={fmtTime(lastUpdate)} theme={theme} />
        </View>

        {/* 分周期表 */}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>分周期</Text>
          {periods.map((p) => (
            <View key={p.period} style={[styles.periodRow, { borderBottomColor: theme.border }]}>
              <View style={styles.periodInfo}>
                <View style={styles.periodNameRow}>
                  <View style={[styles.periodSwatch, { backgroundColor: PERIOD_COLOR[p.period] }]} />
                  <Text style={[styles.periodName, { color: theme.text }]}>{PERIOD_LABEL[p.period]}</Text>
                </View>
                <Text style={[styles.periodMeta, { color: theme.textSecondary }]}>
                  {p.codes} 只 · {p.bars.toLocaleString()} 根 · {fmtTime(p.lastUpdate)}
                </Text>
              </View>
              <Pressable onPress={() => onDeletePeriod(p)} hitSlop={6} disabled={p.codes === 0}>
                <Text style={[styles.deleteText, { color: p.codes === 0 ? theme.textSecondary : semanticColor('danger', isDark) }]}>删除</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* 清空全部 */}
        <Pressable onPress={onClearAll}>
          <View style={[styles.clearBtn, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.clearText, { color: semanticColor('danger', isDark) }]}>清空全部</Text>
          </View>
        </Pressable>

        <ThemedText type="code" themeColor="textSecondary" style={styles.note}>
          删除不可撤销，但不影响自选、筛选结果与排序偏好（这些与 K 线库分离存储）。
        </ThemedText>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { borderRadius: 12, padding: 14, gap: 4 },
  cardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { fontSize: 13 },
  rowValue: { fontSize: 13, fontVariant: ['tabular-nums'] },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  periodInfo: { flex: 1, gap: 2 },
  periodNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  periodSwatch: { width: 10, height: 10, borderRadius: 2 },
  periodName: { fontSize: 14, fontWeight: '600' },
  periodMeta: { fontSize: 11 },
  deleteText: { fontSize: 13, fontWeight: '600' },
  clearBtn: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 15, fontWeight: '700' },
  note: { fontSize: 11, textAlign: 'center', lineHeight: 16 },
});