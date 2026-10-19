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
import {
  getBackgroundDownload,
  getIncrementalUpdate,
  getLanguage,
  getLocalDataMode,
  getThemePref,
  setBackgroundDownload,
  setIncrementalUpdate,
  setLanguage,
  setLocalDataMode,
  setThemePref,
  type LanguagePref,
  type ThemePref,
} from '@/lib/prefs';

interface Stats {
  totalBars: number;
  codes: number;
  bytes: number;
}

/**
 * 设置页（补充规格 §4）。
 * 数据源 / 本地数据管理 / 后台下载 / 语言与外观 / 关于。
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [sourceMode, setSourceModeState] = useState<SourceMode>('auto');
  const [localMode, setLocalMode] = useState(true);
  const [incremental, setIncremental] = useState(true);
  const [bgDownload, setBgDownload] = useState(false);
  const [language, setLanguageState] = useState<LanguagePref>('system');
  const [themePref, setThemePrefState] = useState<ThemePref>('system');
  const [speedResults, setSpeedResults] = useState<SpeedTestResult[] | null>(null);
  const [testing, setTesting] = useState(false);

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
        if (!active) return;
        setSourceModeState(await getSourceMode());
        setLocalMode(await getLocalDataMode());
        setIncremental(await getIncrementalUpdate());
        setBgDownload(await getBackgroundDownload());
        setLanguageState(await getLanguage());
        setThemePrefState(await getThemePref());
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const onClear = useCallback(() => {
    Alert.alert('全部清除本地数据', '将删除本地全部 K 线数据；在线模式不受影响，下次更新自动重新下载。确定吗？', [
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
      setSpeedResults(await speedTestSources());
    } catch {
      setSpeedResults([]);
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle" style={styles.title}>设置</ThemedText>

        {/* 数据源 */}
        <Section title="行情数据源" theme={theme}>
          {listSources().map((s) => {
            const active = sourceMode === s.id;
            return (
              <Pressable key={s.id} onPress={() => onSelectSource(s.id)}>
                <View style={styles.row}>
                  <View style={styles.sourceLeft}>
                    <Text style={[styles.rowLabel, { color: theme.text }]}>{s.name}</Text>
                    <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>{s.desc}</Text>
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
              主数据源不可用时自动切换备用源，也可手动指定。
            </Text>
          </View>
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
                  <Text style={[styles.speedVal, { color: r.ok ? '#0AA869' : '#E43B3B' }]}>
                    {r.ok ? `${r.latencyMs}ms` : '不可用'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Section>

        {/* 本地数据管理 */}
        <Section title="本地 K 线数据" theme={theme}>
          <Row label="已缓存股票" value={stats ? `${stats.codes} 只` : '读取中…'} theme={theme} />
          <Row label="K 线总根数" value={stats ? `${stats.totalBars} 根` : '读取中…'} theme={theme} />
          <Row label="数据库体积" value={stats ? fmtBytes(stats.bytes) : '读取中…'} theme={theme} />
          <SwitchRow
            label="本地化数据模式"
            desc="选股与K线优先读本机已下载数据，没下载到的自动回退联网"
            value={localMode}
            onChange={async (v) => { setLocalMode(v); await setLocalDataMode(v); }}
            theme={theme}
          />
          <SwitchRow
            label="增量更新"
            desc="开启后只补缺失的 K 线"
            value={incremental}
            onChange={async (v) => { setIncremental(v); await setIncrementalUpdate(v); }}
            theme={theme}
          />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary, fontSize: 12 }]}>
              日线约 2 年、周线约 10 年、月线约 25 年；周/月线按周/月刷新，日常更新只补日线。
            </Text>
          </View>
          <Pressable onPress={onClear}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: '#E43B3B' }]}>全部清除本地数据</Text>
              <Text style={[styles.rowValue, { color: theme.textSecondary }]}>›</Text>
            </View>
          </Pressable>
        </Section>

        {/* 后台下载 */}
        <Section title="后台下载" theme={theme}>
          <SwitchRow
            label="后台下载"
            desc="系统空闲时自动补全数据（时机由系统决定）"
            value={bgDownload}
            onChange={async (v) => { setBgDownload(v); await setBackgroundDownload(v); }}
            theme={theme}
          />
        </Section>

        {/* 语言 */}
        <Section title="语言" theme={theme}>
          <SegmentRow
            options={[
              { key: 'system', label: '跟随系统' },
              { key: 'zh', label: '中文' },
              { key: 'en', label: 'English' },
            ]}
            value={language}
            onChange={async (v) => { setLanguageState(v); await setLanguage(v); }}
            theme={theme}
          />
        </Section>

        {/* 外观 */}
        <Section title="外观" theme={theme}>
          <SegmentRow
            options={[
              { key: 'system', label: '跟随系统' },
              { key: 'light', label: '浅色' },
              { key: 'dark', label: '深色' },
            ]}
            value={themePref}
            onChange={async (v) => { setThemePrefState(v); await setThemePref(v); }}
            theme={theme}
          />
        </Section>

        {/* 关于 */}
        <Section title="关于" theme={theme}>
          <Row label="版本" value="1.0.0" theme={theme} />
          <Row label="数据来源" value="新浪 / 腾讯 / 东方财富 公开行情接口" theme={theme} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 }]}>
              行情数据来源于公开网络接口，仅供参考，延迟与准确性以交易所为准。本应用仅提供行情数据与技术指标展示，不构成任何投资建议；投资有风险，入市需谨慎。
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 }]}>
              隐私：不收集、不上传、不出售任何个人信息；行情数据仅从公开接口读取；设备码仅用于本地激活验证。
            </Text>
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function fmtBytes(b: number): string {
  if (b <= 0) return '0 B';
  if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function Section({ title, theme, children }: {
  title: string; theme: ReturnType<typeof useTheme>; children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionBody, { backgroundColor: theme.backgroundElement }]}>{children}</View>
    </View>
  );
}

function Row({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: theme.textSecondary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SwitchRow({ label, desc, value, onChange, theme }: {
  label: string; desc?: string; value: boolean; onChange: (v: boolean) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.sourceLeft}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        {desc ? <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>{desc}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function SegmentRow<T extends string>({ options, value, onChange, theme }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[styles.segRow]}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={styles.segBtnWrap}>
            <View style={[styles.segBtn, { backgroundColor: active ? theme.tint : 'transparent' }]}>
              <Text style={[styles.segText, { color: active ? '#fff' : theme.text }]}>{o.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 20, paddingBottom: 40 },
  title: { marginBottom: 4 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionBody: { borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 13, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.1)',
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 13, flexShrink: 1, textAlign: 'right' },
  sourceLeft: { flex: 1, gap: 2 },
  sourceDesc: { fontSize: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  speedBox: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  speedRow: { flexDirection: 'row', justifyContent: 'space-between' },
  speedName: { fontSize: 13 },
  speedVal: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  segRow: { flexDirection: 'row', padding: 6, gap: 6 },
  segBtnWrap: { flex: 1 },
  segBtn: { paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segText: { fontSize: 13, fontWeight: '600' },
});