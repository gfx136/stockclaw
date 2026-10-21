import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TouchTarget } from '@/components/touch-target';
import { PeriodColors, semanticColor } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { clearAllKlines, deleteByPeriod, dbStats, lastUpdateAt, perPeriodStats, type PeriodStat } from '@/lib/kline-db';
import type { KlinePeriod } from '@/types/stock';

/**
 * 本地数据管理明细页（补充规格 §4.3）。
 * 总览卡 + 分周期表（按周期删除）+ 清空全部（均二次确认）。
 * 删除不影响自选/筛选结果/排序偏好（那些存偏好存储，与 K 线库分离）。
 */

const PERIOD_LABEL_KEY: Record<KlinePeriod, string> = {
  '60min': 'dm_period60m',
  daily: 'dm_periodDaily',
  weekly: 'dm_periodWeekly',
  monthly: 'dm_periodMonthly',
};

/** 周期固定色标（§6.3：便于与图表周期切换对照），取自全局 PeriodColors */
const PERIOD_COLOR = PeriodColors;

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
  const { t, tf, lang } = useT();
  const insets = useSafeAreaInsets();
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
      tf('dm_deleteConfirmTitle', { period: t(PERIOD_LABEL_KEY[p.period] as never) }),
      tf('dm_deleteConfirmDesc', { period: t(PERIOD_LABEL_KEY[p.period] as never), n: p.codes }),
      [
        { text: t('common_cancel'), style: 'cancel' },
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
      t('dm_clearConfirmTitle'),
      tf('dm_clearConfirmDesc', { n: stats?.codes ?? 0 }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('dm_clearConfirmBtn'),
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
      <Stack.Screen options={{ title: t('dm_title'), headerBackTitle: t('common_back') }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}>
        {/* 总览卡 */}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{t('dm_overview')}</Text>
          <Row label={t('dm_database')} value={t('dm_databasePath')} theme={theme} />
          <Row label={t('dm_totalSize')} value={stats ? fmtBytes(stats.bytes) : '—'} theme={theme} />
          <Row label={t('dm_stockCount')} value={stats ? `${stats.codes}` : '—'} theme={theme} />
          <Row label={t('dm_totalBars')} value={stats ? stats.totalBars.toLocaleString() : '—'} theme={theme} />
          <Row label={t('dm_lastUpdate')} value={fmtTime(lastUpdate)} theme={theme} />
        </View>

        {/* 分周期表 */}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{t('dm_byPeriod')}</Text>
          {periods.map((p) => (
            <View key={p.period} style={[styles.periodRow, { borderBottomColor: theme.border }]}>
              <View style={styles.periodInfo}>
                <View style={styles.periodNameRow}>
                  <View style={[styles.periodSwatch, { backgroundColor: PERIOD_COLOR[p.period] }]} />
                  <Text style={[styles.periodName, { color: theme.text }]}>{t(PERIOD_LABEL_KEY[p.period] as never)}</Text>
                </View>
                <Text style={[styles.periodMeta, { color: theme.textSecondary }]}>
                  {lang === 'en' ? `${p.codes} stocks · ${p.bars.toLocaleString()} bars` : `${p.codes} 只 · ${p.bars.toLocaleString()} 根`} · {fmtTime(p.lastUpdate)}
                </Text>
              </View>
              <TouchTarget onPress={() => onDeletePeriod(p)} disabled={p.codes === 0}>
                <Text style={[styles.deleteText, { color: p.codes === 0 ? theme.textSecondary : semanticColor('danger', isDark) }]}>
                  {t('dm_delete')}
                </Text>
              </TouchTarget>
            </View>
          ))}
        </View>

        {/* 清空全部 */}
        <Pressable onPress={onClearAll}>
          <View style={[styles.clearBtn, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.clearText, { color: semanticColor('danger', isDark) }]}>{t('dm_clearAll')}</Text>
          </View>
        </Pressable>

        <ThemedText type="code" themeColor="textSecondary" style={styles.note}>
          {t('dm_note')}
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
  content: { padding: 16, gap: 14 },
  card: { borderRadius: 12, padding: 14, gap: 4, borderWidth: StyleSheet.hairlineWidth },
  cardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { fontSize: 13 },
  rowValue: { fontSize: 13, fontVariant: ['tabular-nums'] },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2, borderBottomWidth: StyleSheet.hairlineWidth },
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