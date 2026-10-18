import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import {
  getSourceMode,
  listSources,
  setSourceMode,
  speedTestSources,
  type SourceMode,
  type SpeedTestResult,
} from '@/lib/api/failover';
import { clearAllKlines, dbStats } from '@/lib/kline-db';
import { getLocalDataMode, setLocalDataMode } from '@/lib/prefs';

interface Stats {
  totalBars: number;
  codes: number;
  bytes: number;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [sourceMode, setSourceModeState] = useState<SourceMode>('auto');
  const [localMode, setLocalMode] = useState(true);
  const [speedResults, setSpeedResults] = useState<SpeedTestResult[] | null>(null);
  const [testing, setTesting] = useState(false);

  // 每次进入都刷新缓存统计与数据源模式
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
        const mode = await getSourceMode();
        if (active) setSourceModeState(mode);
        const lm = await getLocalDataMode();
        if (active) setLocalMode(lm);
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

  const onSelectSource = useCallback(async (mode: SourceMode) => {
    await setSourceMode(mode);
    setSourceModeState(mode);
  }, []);

  const onSpeedTest = useCallback(async () => {
    setTesting(true);
    setSpeedResults(null);
    try {
      const r = await speedTestSources();
      setSpeedResults(r);
    } catch {
      setSpeedResults([]);
    } finally {
      setTesting(false);
    }
  }, []);

  const onToggleLocalMode = useCallback(async (v: boolean) => {
    setLocalMode(v);
    await setLocalDataMode(v);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle" style={styles.title}>
          设置
        </ThemedText>

        <Section title="数据源" theme={theme}>
          {listSources().map((s) => {
            const active = sourceMode === s.id;
            return (
              <Pressable key={s.id} onPress={() => onSelectSource(s.id)}>
                <View style={styles.row}>
                  <View style={styles.sourceLeft}>
                    <Text style={[styles.rowLabel, { color: theme.text }]}>{s.name}</Text>
                    <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>
                      {s.desc}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: active ? theme.tint : theme.textSecondary,
                        backgroundColor: active ? theme.tint : 'transparent',
                      },
                    ]}>
                    {active ? <View style={styles.radioDot} /> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary, fontSize: 12 }]}>
              自动模式下源不可用时自动切换下一个
            </Text>
          </View>
          {/* 连接测速 */}
          <Pressable onPress={onSpeedTest} disabled={testing}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: theme.tint }]}>连接测速</Text>
              {testing ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={[styles.rowValue, { color: theme.textSecondary }]}>检测各源延迟 ›</Text>
              )}
            </View>
          </Pressable>
          {speedResults ? (
            <View style={styles.speedBox}>
              {speedResults.map((r) => (
                <View key={r.id} style={styles.speedRow}>
                  <Text style={[styles.speedName, { color: theme.text }]}>{r.name}</Text>
                  <Text
                    style={[
                      styles.speedVal,
                      { color: r.ok ? '#0AA869' : '#E43B3B' },
                    ]}>
                    {r.ok ? `${r.latencyMs}ms` : '不可用'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Section>

        <Section title="本地化数据" theme={theme}>
          <View style={styles.row}>
            <View style={styles.sourceLeft}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>本地化数据模式</Text>
              <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>
                选股与K线优先读本机已下载数据，没下载到的自动回退联网
              </Text>
            </View>
            <Switch value={localMode} onValueChange={onToggleLocalMode} />
          </View>
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
  sourceLeft: { flex: 1, gap: 2 },
  sourceDesc: { fontSize: 12 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  speedBox: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  speedRow: { flexDirection: 'row', justifyContent: 'space-between' },
  speedName: { fontSize: 13 },
  speedVal: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});