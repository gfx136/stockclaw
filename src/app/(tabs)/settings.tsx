import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { clearAllKlines, dbStats } from '@/lib/kline-db';

interface Stats {
  totalBars: number;
  codes: number;
  bytes: number;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);

  // 每次进入都刷新缓存统计
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const s = await dbStats();
          if (active) setStats(s);
        } catch {
          if (active) setStats(null);
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const onClear = useCallback(() => {
    Alert.alert('清空 K 线缓存', '将删除本地全部 K 线数据，确定吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await clearAllKlines();
          setStats(await dbStats());
          Alert.alert('已清空', '本地 K 线缓存已删除。');
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle" style={styles.title}>
          设置
        </ThemedText>

        <Section title="数据源" theme={theme}>
          <Row label="当前数据源" value="东方财富" theme={theme} />
          <Row label="故障转移" value="未启用（二期）" theme={theme} />
        </Section>

        <Section title="本地数据" theme={theme}>
          <Row label="已缓存股票" value={stats ? `${stats.codes} 只` : '读取中…'} theme={theme} />
          <Row
            label="K 线总根数"
            value={stats ? `${stats.totalBars} 根` : '读取中…'}
            theme={theme}
          />
          <Row label="数据库体积" value={stats ? fmtBytes(stats.bytes) : '读取中…'} theme={theme} />
          <Pressable onPress={onClear}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: '#E43B3B' }]}>清空 K 线缓存</Text>
              <Text style={[styles.rowValue, { color: theme.textSecondary }]}>›</Text>
            </View>
          </Pressable>
        </Section>

        <Section title="计算能力" theme={theme}>
          <Row label="技术指标" value="MA / MACD / KDJ / RSI / BOLL / BBI" theme={theme} />
          <Row label="筛选条件" value="市值 / PE / 涨跌幅 / 换手率 / 技术信号" theme={theme} />
        </Section>

        <Section title="关于" theme={theme}>
          <Row label="版本" value="1.0.0 (clean-room)" theme={theme} />
          <Row label="技术栈" value="Expo SDK 57 + RN 0.86" theme={theme} />
          <Row label="K 线图" value="自绘 SVG（含均线/成交量）" theme={theme} />
        </Section>

        <ThemedText type="code" themeColor="textSecondary" style={styles.footer}>
          本应用为功能参考实现，仅使用公开行情接口，不包含任何授权校验逻辑。
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

/** 字节 → 可读单位 */
function fmtBytes(b: number): string {
  if (b <= 0) return '0 B';
  if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function Section({
  title,
  theme,
  children,
}: {
  title: string;
  theme: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionBody, { backgroundColor: theme.backgroundElement }]}>
        {children}
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: theme.textSecondary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 20, paddingBottom: 40 },
  title: { marginBottom: 4 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: { borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.1)',
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 13, flexShrink: 1, textAlign: 'right' },
  footer: { textAlign: 'center', fontSize: 10, lineHeight: 16, marginTop: 8 },
});