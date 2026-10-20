import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { semanticColor } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { fetchAllStocks } from '@/lib/api/failover';
import {
  beginPreparing,
  endPreparing,
  getDownloadedCount,
  getDownloadState,
  hasLocalData,
  pauseDownload,
  resumeDownload,
  startFullDownload,
  stopDownload,
  subscribeDownload,
} from '@/lib/download-manager';
import { clearAllKlines, dbStats } from '@/lib/kline-db';
import {
  getSourceMode,
  listSources,
  setSourceMode,
  speedTestSources,
  type SourceMode,
  type SpeedTestResult,
} from '@/lib/api/failover';
import {
  getBackgroundDownload,
  getDefaultBars,
  getIncrementalUpdate,
  getLanguage,
  getLocalDataMode,
  getThemePref,
  setBackgroundDownload,
  setDefaultBars,
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
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { t, tf, lang } = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [defaultBars, setDefaultBarsState] = useState(60);
  const dlState = useSyncExternalStore(subscribeDownload, getDownloadState, getDownloadState);
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
        setDownloadedCount(await getDownloadedCount());
        setDefaultBarsState(await getDefaultBars());
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const onSelectSource = useCallback(async (mode: SourceMode) => {
    await setSourceMode(mode);
    setSourceModeState(mode);
  }, []);

  /** 下载/更新本地 K 线（补充规格 §6.1 四状态文案） */
  const onDownloadAll = useCallback(async () => {
    // 状态1：正在准备（取列表 / 统计）
    if (dlState.preparing) {
      Alert.alert(t('settings_dlNotice'), t('settings_dlPreparing'));
      return;
    }
    // 状态2：上一次仍在进行
    if (dlState.running) {
      Alert.alert(t('settings_dlRunningTitle'), tf('settings_downloadProgress', { done: dlState.done, total: dlState.total }), [
        dlState.paused
          ? { text: t('settings_dlResume'), onPress: () => resumeDownload() }
          : { text: t('settings_dlPause'), onPress: () => pauseDownload() },
        { text: t('settings_dlStop'), style: 'destructive', onPress: () => stopDownload() },
        { text: t('common_cancel'), style: 'cancel' },
      ]);
      return;
    }
    try {
      // 问题1修复：先置「准备中」，让进度条立刻出现（取列表可能要几秒）
      beginPreparing();
      const stocks = await fetchAllStocks(200);
      if (stocks.length === 0) {
        endPreparing();
        Alert.alert(t('settings_dlNotice'), t('settings_noStockList'));
        return;
      }
      const hasData = await hasLocalData();
      if (!hasData) {
        // 状态3：首次全量 —— 开始前确认
        endPreparing();
        Alert.alert(
          t('settings_dlFirstTitle'),
          t('settings_dlFirstDesc'),
          [
            { text: t('common_cancel'), style: 'cancel' },
            { text: t('settings_dlStart'), onPress: () => { startFullDownload(stocks); } },
          ]
        );
      } else {
        // 状态4：日常增量 —— 直接启动（beginPreparing 已置位，startFullDownload 会接管）
        startFullDownload(stocks);
      }
    } catch (e) {
      endPreparing();
      Alert.alert(t('settings_dlFail'), e instanceof Error ? e.message : t('settings_checkNetwork'));
    }
  }, [dlState, t, tf]);

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
        <ThemedText type="subtitle" style={styles.title}>{t('settings_title')}</ThemedText>

        {/* 数据源 */}
        <Section title={t('settings_dataSource')} theme={theme}>
          {listSources().map((s) => {
            const active = sourceMode === s.id;
            const capText = (k: string) =>
              k === 'list' ? (lang === 'en' ? 'List' : '列表')
                : k === 'kline' ? (lang === 'en' ? 'K-line' : 'K线')
                  : (lang === 'en' ? 'Quote' : '实时');
            const desc = s.id === 'auto'
              ? (lang === 'en' ? 'Auto-switch by priority (recommended)' : '按优先级自动切换，推荐')
              : s.caps.map(capText).join(' / ');
            return (
              <Pressable key={s.id} onPress={() => onSelectSource(s.id)}>
                <View style={styles.row}>
                  <View style={styles.sourceLeft}>
                    <Text style={[styles.rowLabel, { color: theme.text }]}>{t(s.nameKey as never)}</Text>
                    <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>{desc}</Text>
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
              {t('settings_sourceNote')}
            </Text>
          </View>
          <Pressable onPress={onSpeedTest} disabled={testing}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: theme.tint }]}>{t('settings_speedTest')}</Text>
              {testing ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={[styles.rowValue, { color: theme.textSecondary }]}>{t('settings_speedTestDesc')}</Text>
              )}
            </View>
          </Pressable>
          {speedResults ? (
            <View style={styles.speedBox}>
              {speedResults.map((r) => (
                <View key={r.id} style={styles.speedRow}>
                  <Text style={[styles.speedName, { color: theme.text }]}>{r.name}</Text>
                  <Text style={[styles.speedVal, { color: r.ok ? semanticColor('success', isDark) : semanticColor('danger', isDark) }]}>
                    {r.ok ? `${r.latencyMs}ms` : t('common_unavailable')} · {t('settings_successRate').replace('{n}', String(r.successRate))}
                  </Text>
                  {r.ok ? (
                    <Pressable onPress={() => onSelectSource(r.id)} hitSlop={6}>
                      <Text style={[styles.speedSet, { color: theme.tint }]}>{t('settings_setAsSource')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <Text style={[styles.speedNote, { color: theme.textSecondary }]}>
                {t('settings_speedNote')}
              </Text>
            </View>
          ) : null}
        </Section>

        {/* 本地化数据 */}
        <Section title={t('settings_localData')} theme={theme}>
          {/* 下载/更新本地 K 线数据 */}
          <Pressable onPress={onDownloadAll}>
            <View style={styles.row}>
              <View style={styles.sourceLeft}>
                <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings_downloadKline')}</Text>
                <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>
                  {dlState.running
                    ? tf('settings_downloadProgress', { done: dlState.done, total: dlState.total }) + (dlState.paused ? t('settings_paused') : '')
                    : dlState.preparing
                      ? t('settings_dlPreparing')
                      : dlState.lastResult === 'up-to-date'
                        ? tf('settings_dlUpToDate', { n: downloadedCount })
                        : dlState.lastResult === 'done'
                          ? tf('settings_dlDone', {
                            n: dlState.done,
                            failed: dlState.failed > 0
                              ? tf('settings_dlDoneFailed', { failed: dlState.failed })
                              : '',
                          })
                          : dlState.lastResult === 'stopped'
                            ? t('settings_dlStopped')
                            : downloadedCount > 0
                              ? tf('settings_syncedStocks', { n: downloadedCount })
                              : t('settings_noLocalData')}
                </Text>

                {/* 进度条（问题1修复）：running / preparing 时都显示，给用户明确反馈 */}
                {dlState.running || dlState.preparing ? (
                  <View style={[styles.progressTrack, { backgroundColor: theme.background }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          backgroundColor: dlState.preparing ? theme.textSecondary : theme.tint,
                          width: `${dlState.preparing
                            ? 100
                            : dlState.total ? Math.max(2, (dlState.done / dlState.total) * 100) : 0}%`,
                        },
                      ]}
                    />
                  </View>
                ) : null}

                {/* 进度明细：百分比 + 当前股票 + 预计剩余 */}
                {dlState.running && dlState.total > 0 ? (
                  <Text style={[styles.dlDetail, { color: theme.textSecondary }]}>
                    {Math.round((dlState.done / dlState.total) * 100)}%
                    {dlState.current ? `　·　${dlState.current}` : ''}
                    {dlState.etaSec !== null && dlState.etaSec > 0
                      ? `　·　${t('settings_dlEta')} ${fmtEta(dlState.etaSec)}`
                      : ''}
                    {dlState.failed > 0 ? `　·　${t('settings_dlFailedN')} ${dlState.failed}` : ''}
                  </Text>
                ) : null}

                {dlState.running ? (
                  <Text style={[styles.dlNote, { color: theme.textSecondary }]}>
                    {t('settings_continueBg')}
                  </Text>
                ) : null}
              </View>
              {dlState.running || dlState.preparing
                ? <ActivityIndicator size="small" />
                : <Text style={[styles.rowValue, { color: theme.textSecondary }]}>›</Text>}
            </View>
          </Pressable>

          {/* 本地数据管理入口 */}
          <Pressable onPress={() => router.push('/data-manage')}>
            <View style={styles.row}>
              <View style={styles.sourceLeft}>
                <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings_localDataManage')}</Text>
                <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>{t('settings_localDataManageDesc')}</Text>
              </View>
              <Text style={[styles.rowValue, { color: theme.textSecondary }]}>›</Text>
            </View>
          </Pressable>

          {/* 本地化数据模式 */}
          <SwitchRow
            label={t('settings_localMode')}
            desc={t('settings_localModeDesc')}
            value={localMode}
            onChange={async (v) => { setLocalMode(v); await setLocalDataMode(v); }}
            theme={theme}
          />
          <SwitchRow
            label={t('settings_incremental')}
            desc={t('settings_incrementalDesc')}
            value={incremental}
            onChange={async (v) => { setIncremental(v); await setIncrementalUpdate(v); }}
            theme={theme}
          />
        </Section>

        {/* 图表 */}
        <Section title={t('settings_chart')} theme={theme}>
          <View style={styles.row}>
            <View style={styles.sourceLeft}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>{t('settings_defaultBars')}</Text>
              <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>
                {tf('settings_defaultBarsDesc', { n: defaultBars })}
              </Text>
            </View>
          </View>
          <View style={styles.sliderRow}>
            {[40, 60, 90, 120, 160, 200].map((n) => (
              <Pressable key={n} onPress={async () => { setDefaultBarsState(n); await setDefaultBars(n); }} style={styles.sliderItem}>
                <View style={[styles.sliderChip, { backgroundColor: defaultBars === n ? theme.tint : theme.backgroundElement }]}>
                  <Text style={[styles.sliderText, { color: defaultBars === n ? '#fff' : theme.text }]}>{n}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* 后台下载 */}
        <Section title={t('settings_bgDownload')} theme={theme}>
          <SwitchRow
            label={t('settings_bgDownload')}
            desc={t('settings_bgDownloadDesc')}
            value={bgDownload}
            onChange={async (v) => { setBgDownload(v); await setBackgroundDownload(v); }}
            theme={theme}
          />
        </Section>

        {/* 语言 */}
        <Section title={t('settings_language')} theme={theme}>
          <SegmentRow
            options={[
              { key: 'system', label: t('settings_themeSystem') },
              { key: 'zh', label: t('settings_langZh') },
              { key: 'en', label: t('settings_langEn') },
            ]}
            value={language}
            onChange={async (v) => { setLanguageState(v); await setLanguage(v); }}
            theme={theme}
          />
        </Section>

        {/* 外观 */}
        <Section title={t('settings_appearance')} theme={theme}>
          <SegmentRow
            options={[
              { key: 'system', label: t('settings_themeSystem') },
              { key: 'light', label: t('settings_themeLight') },
              { key: 'dark', label: t('settings_themeDark') },
            ]}
            value={themePref}
            onChange={async (v) => { setThemePrefState(v); await setThemePref(v); }}
            theme={theme}
          />
        </Section>

        {/* 关于 */}
        <Section title={t('settings_about')} theme={theme}>
          <Row label={t('settings_version')} value="1.0.0" theme={theme} />
          <Row label={t('settings_dataSource')} value={t('settings_sourceNote')} theme={theme} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 }]}>
              {t('riskWarning')}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 }]}>
              {lang === 'en'
                ? 'Privacy: no personal information is collected, uploaded or sold. Quotes are read from public APIs only.'
                : '隐私：不收集、不上传、不出售任何个人信息；行情数据仅从公开接口读取。'}
            </Text>
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/** 剩余时间格式化（问题1：进度条旁的 ETA） */
function fmtEta(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m${s}s` : `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
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
    // 整行可点（iOS 惯例：Switch 行整行切换，减少误触）
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.sourceLeft}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
          {desc ? <Text style={[styles.sourceDesc, { color: theme.textSecondary }]}>{desc}</Text> : null}
        </View>
        <Switch value={value} onValueChange={onChange} />
      </View>
    </Pressable>
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
  speedSet: { fontSize: 12, fontWeight: '600', marginLeft: 8 },
  speedNote: { fontSize: 10, marginTop: 6 },
  segRow: { flexDirection: 'row', padding: 6, gap: 6 },
  segBtnWrap: { flex: 1 },
  segBtn: { paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segText: { fontSize: 13, fontWeight: '600' },
  progressTrack: { height: 4, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  dlDetail: { fontSize: 11, marginTop: 4, fontVariant: ['tabular-nums'] },
  progressFill: { height: 4, borderRadius: 2 },
  dlNote: { fontSize: 10, marginTop: 4, lineHeight: 14 },
  sliderRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
  sliderItem: { flex: 1 },
  sliderChip: { height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sliderText: { fontSize: 13, fontWeight: '600' },
});