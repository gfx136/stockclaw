import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { IndicatorOverview } from '@/components/indicator-overview';
import { InteractiveKline, type SubMode } from '@/components/interactive-kline';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchQuote } from '@/lib/api/failover';
import { neighborCode, getDetailName } from '@/lib/detail-nav';
import { isFavorite, toggleFavorite } from '@/lib/favorites';
import {
  fmtChange,
  fmtPercent,
  fmtPrice,
  marketName,
  upDownColor,
} from '@/lib/format';
import { calcAllIndicators, snapshotAt, nthLast } from '@/lib/indicators';
import { downloadAllPeriods } from '@/lib/kline-downloader';
import { loadKlines } from '@/lib/kline-db';
import {
  getDetailLandscape,
  getShowBbi,
  getShowBoll,
  setDetailLandscape,
  setShowBbi,
  setShowBoll,
} from '@/lib/prefs';
import type { IndicatorSeries, KlineBar, KlinePeriod, Stock } from '@/types/stock';

/**
 * 个股详情页（补充规格 §2）。
 * 6 区块：顶栏(返回/上下只/星标/分享) → 标题区(名称+代码+价格常显) → 选项行(周期/指标/复位/横竖屏/星标)
 * → 图表区(K线主图+副图) → 指标速览(6卡) → 数据状态条。
 */

const PERIODS: { key: KlinePeriod; label: string }[] = [
  { key: '60min', label: '60分钟' },
  { key: 'daily', label: '日' },
  { key: 'weekly', label: '周' },
  { key: 'monthly', label: '月' },
];
const BAR_COUNT = 500;

export default function StockDetailScreen() {
  const params = useLocalSearchParams<{ code: string; name?: string }>();
  const theme = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const [code, setCode] = useState(params.code ?? '');
  const [name, setName] = useState(params.name ? decodeURIComponent(params.name) : '');
  const [quote, setQuote] = useState<Partial<Stock> | null>(null);
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  const [bars, setBars] = useState<KlineBar[]>([]);
  const [series, setSeries] = useState<IndicatorSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [fav, setFav] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const [showBoll, setShowBollState] = useState(false);
  const [showBbi, setShowBbiState] = useState(true);
  const [subMode, setSubMode] = useState<SubMode>('macd');
  const [indOpen, setIndOpen] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [landscape, setLandscape] = useState(false);

  const stockName = name || getDetailName(code) || code;

  // 载入偏好
  useEffect(() => {
    (async () => {
      setShowBollState(await getShowBoll());
      setShowBbiState(await getShowBbi());
      const land = await getDetailLandscape();
      setLandscape(land);
    })();
  }, []);

  // 横竖屏切换
  useEffect(() => {
    (async () => {
      await ScreenOrientation.lockAsync(
        landscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {});
    })();
  }, [landscape]);

  // 离开详情页恢复竖屏
  useEffect(() => {
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // 加载行情 + 收藏（随 code 变化）
  useEffect(() => {
    if (!code) return;
    (async () => {
      setFav(await isFavorite(code));
      try {
        const q = await fetchQuote(code);
        if (q && Object.keys(q).length > 0) setQuote(q);
      } catch { /* 行情失败不阻塞 K 线 */ }
    })();
  }, [code]);

  // 读本地 K 线（随 code/period 变化）
  const loadBars = useCallback(async (c: string, p: KlinePeriod) => {
    if (!c) return;
    setLoading(true);
    try {
      const rows = await loadKlines(c, p, BAR_COUNT);
      setBars(rows);
      setSeries(rows.length >= 30 ? calcAllIndicators(rows, [5, 10, 20, 26, 60]) : null);
    } catch {
      setBars([]);
      setSeries(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadBars(code, period); }, [code, period, loadBars]);

  // 下载
  const onDownload = useCallback(async () => {
    if (!code) return;
    setDownloading(true);
    setTip(null);
    try {
      const results = await downloadAllPeriods(code, BAR_COUNT);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount === 0) {
        const errs = results.filter((r) => !r.ok).map((r) => `${r.period}:${r.error ?? '未知'}`).join('；');
        setTip(`下载失败。${errs}`);
      } else {
        setTip(`已更新 ${okCount}/${results.length} 个周期`);
        await loadBars(code, period);
      }
    } catch (e) {
      setTip(e instanceof Error ? e.message : '下载异常');
    } finally {
      setDownloading(false);
    }
  }, [code, period, loadBars]);

  const handleToggleFav = useCallback(async () => {
    if (!code) return;
    setFav(await toggleFavorite(code, stockName));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [code, stockName]);

  // 切换股票（上一只/下一只，循环，保留周期/指标/根数）
  const goNeighbor = useCallback((dir: 1 | -1) => {
    const next = neighborCode(code, dir);
    if (!next) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCode(next);
    setName(getDetailName(next));
    setQuote(null);
    setBars([]);
    setSeries(null);
    setSelIdx(null);
  }, [code]);

  const onShare = useCallback(async () => {
    try {
      await Share.share({
        message: `${stockName} ${code} 最新价 ${fmtPrice(quote?.price)} 涨跌幅 ${fmtPercent(quote?.changePercent)} —— 选股助手`,
      });
    } catch { /* 用户取消 */ }
  }, [stockName, code, quote]);

  const toggleLandscape = useCallback(() => {
    const next = !landscape;
    setLandscape(next);
    setDetailLandscape(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [landscape]);

  const snapshot = useMemo(() => (series && bars.length > 0 ? snapshotAt(series, bars) : null), [series, bars]);

  // 选中 bar 的速览联动（规格 §2.6）：选中时显示该 bar 的指标
  const selSnapshot = useMemo(() => {
    if (selIdx === null || !series || selIdx < 0 || selIdx >= bars.length) return null;
    const sub = bars.slice(0, selIdx + 1);
    const subSeries = calcAllIndicators(sub, [5, 10, 20, 26, 60]);
    return snapshotAt(subSeries, sub);
  }, [selIdx, series, bars]);
  const displaySnapshot = selSnapshot ?? snapshot;

  // MACD 金叉/死叉（最新两根）
  const macdCross = useMemo(() => {
    if (!series) return null;
    const d0 = nthLast(series.macd.dif, 0), e0 = nthLast(series.macd.dea, 0);
    const d1 = nthLast(series.macd.dif, 1), e1 = nthLast(series.macd.dea, 1);
    if (d0 === undefined || e0 === undefined || d1 === undefined || e1 === undefined) return null;
    if (d1 <= e1 && d0 > e0) return 'golden';
    if (d1 >= e1 && d0 < e0) return 'dead';
    return null;
  }, [series]);

  const changeColor = upDownColor(quote?.changePercent);
  const hasPrice = (quote?.price ?? 0) > 0;
  const chartW = winW - 16 * 2;
  // 屏占比（规格 §2.3）：竖屏图表区约 330pt；横屏约 180pt
  const chartH = landscape ? Math.round(Math.min(winH * 0.55, 220)) : Math.round(Math.min(winH * 0.42, 340));

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: '',
          headerBackTitle: '返回',
          headerRight: () => (
            <View style={styles.headerRight}>
              <Pressable onPress={() => goNeighbor(-1)} hitSlop={10} accessibilityLabel="上一只">
                <Text style={[styles.headerBtn, { color: theme.text }]}>◀</Text>
              </Pressable>
              <Pressable onPress={() => goNeighbor(1)} hitSlop={10} accessibilityLabel="下一只">
                <Text style={[styles.headerBtn, { color: theme.text }]}>▶</Text>
              </Pressable>
              <Pressable onPress={handleToggleFav} hitSlop={10} accessibilityLabel="自选">
                <Text style={[styles.headerBtn, { color: fav ? theme.tint : theme.text }]}>{fav ? '★' : '☆'}</Text>
              </Pressable>
              <Pressable onPress={onShare} hitSlop={10} accessibilityLabel="分享">
                <Text style={[styles.headerBtn, { color: theme.text }]}>⤴</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* ② 标题区：名称 + 代码 + 最新价 + 涨跌额幅（常显） */}
        <View style={[styles.titleBlock, landscape && styles.titleBlockLand]}>
          <View style={styles.titleLeft}>
            <Text style={[styles.stockName, { color: theme.text }]} numberOfLines={1}>{stockName}</Text>
            <Text style={[styles.stockCode, { color: theme.textSecondary }]} numberOfLines={1}>
              {code} · {marketName(code)}
            </Text>
          </View>
          <Text style={[styles.bigPrice, { color: hasPrice ? changeColor : theme.textSecondary }]}>
            {hasPrice ? fmtPrice(quote?.price) : '--'}
          </Text>
          <View style={styles.titleRight}>
            <Text style={[styles.changeAmt, { color: changeColor }]}>{fmtChange(quote?.changeAmount)}</Text>
            <Text style={[styles.changePct, { color: changeColor }]}>{fmtPercent(quote?.changePercent)}</Text>
          </View>
        </View>

        {/* ③ 选项行：周期 / 指标 / 复位 / 横竖屏 / 星标 */}
        <View style={styles.optionBar}>
          <View style={styles.periodSeg}>
            {PERIODS.map((p) => {
              const on = p.key === period;
              return (
                <Pressable key={p.key} onPress={() => { setPeriod(p.key); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
                  <View style={[styles.periodBtn, { backgroundColor: on ? theme.tint : 'transparent' }]}>
                    <Text style={[styles.periodText, { color: on ? '#fff' : theme.text }]}>{p.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => setIndOpen(true)} hitSlop={6}>
            <Text style={[styles.optBtn, { color: theme.tint }]}>指标 ▾</Text>
          </Pressable>
          <Pressable onPress={() => { setResetToken((t) => t + 1); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} hitSlop={6}>
            <Text style={[styles.optBtn, { color: theme.text }]}>复位</Text>
          </Pressable>
          <Pressable onPress={toggleLandscape} hitSlop={6}>
            <Text style={[styles.optBtn, { color: theme.text }]}>{landscape ? '竖屏' : '横屏'}</Text>
          </Pressable>
          <Pressable onPress={onDownload} disabled={downloading} hitSlop={6}>
            {downloading ? <ActivityIndicator size="small" /> : <Text style={[styles.optBtn, { color: theme.tint }]}>下载</Text>}
          </Pressable>
        </View>

        {/* 指标工具提示条（图区左上小字） */}
        <Text style={[styles.indHint, { color: theme.textSecondary }]}>
          MA5/10/20/60{showBoll ? ' · BOLL' : ''}{showBbi ? ' · BBI' : ''} · 副图 {subMode.toUpperCase()}
        </Text>

        {tip ? (
          <View style={[styles.tipBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">{tip}</ThemedText>
          </View>
        ) : null}

        {/* ④ 图表区 */}
        <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement }]}>
          {loading && bars.length === 0 ? (
            <View style={[styles.chartLoading, { height: chartH }]}><ActivityIndicator /></View>
          ) : bars.length === 0 ? (
            <View style={[styles.chartLoading, { height: chartH }]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.noData}>尚未下载 · 点击开始下载</ThemedText>
              <Pressable onPress={onDownload} disabled={downloading}>
                <Text style={[styles.dlHint, { color: theme.tint }]}>{downloading ? '下载中…' : '点击下载 K 线'}</Text>
              </Pressable>
            </View>
          ) : (
            <InteractiveKline
              bars={bars}
              width={chartW}
              height={chartH}
              series={series ?? undefined}
              maOverlay={[5, 10, 20, 60]}
              showBoll={showBoll}
              showBbi={showBbi}
              subMode={subMode}
              resetToken={resetToken}
              onSelectBar={setSelIdx}
              defaultVisible={100}
              gridColor={theme.border}
              axisColor={theme.textSecondary}
              textColor={theme.text}
            />
          )}
        </View>

        {/* ⑤ 指标速览（与图表同源联动） */}
        {displaySnapshot ? (
          <View style={styles.overviewWrap}>
            <ThemedText type="smallBold" style={styles.overviewTitle}>
              指标速览{selIdx !== null && bars[selIdx] ? ` · ${bars[selIdx].date}` : ''}
            </ThemedText>
            <IndicatorOverview
              snapshot={displaySnapshot}
              latestClose={selIdx !== null && bars[selIdx] ? bars[selIdx].close : (bars[bars.length - 1]?.close ?? 0)}
              macdCross={macdCross}
              enabled={{ ma: true, boll: showBoll, macd: subMode === 'macd', kdj: subMode === 'kdj', rsi: subMode === 'rsi', bbi: showBbi }}
              onOpenIndicators={() => setIndOpen(true)}
            />
          </View>
        ) : null}

        {/* ⑥ 数据状态条 */}
        <View style={styles.statusBar}>
          <ThemedText type="code" themeColor="textSecondary" style={styles.statusText}>
            {bars.length > 0 ? `数据截至 ${bars[bars.length - 1].date} · ${bars.length} 根` : '本地无数据'} · 数据源自动
          </ThemedText>
        </View>
      </ScrollView>

      {/* 指标开关浮层（主图叠加 + 副图选择） */}
      <Modal visible={indOpen} transparent animationType="fade" onRequestClose={() => setIndOpen(false)}>
        <Pressable style={styles.indMask} onPress={() => setIndOpen(false)}>
          <View style={[styles.indPanel, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.indPanelTitle, { color: theme.text }]}>主图叠加</Text>
            <View style={styles.indRow}>
              <Pressable onPress={() => { const v = !showBoll; setShowBollState(v); setShowBoll(v); }}>
                <View style={[styles.indChip, { backgroundColor: showBoll ? theme.tint : theme.background }]}>
                  <Text style={[styles.indChipText, { color: showBoll ? '#fff' : theme.text }]}>BOLL</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => { const v = !showBbi; setShowBbiState(v); setShowBbi(v); }}>
                <View style={[styles.indChip, { backgroundColor: showBbi ? theme.tint : theme.background }]}>
                  <Text style={[styles.indChipText, { color: showBbi ? '#fff' : theme.text }]}>BBI</Text>
                </View>
              </Pressable>
            </View>
            <Text style={[styles.indPanelTitle, { color: theme.text }]}>副图指标</Text>
            <View style={styles.indRow}>
              {(['macd', 'kdj', 'rsi', 'volume', 'amount'] as SubMode[]).map((m) => (
                <Pressable key={m} onPress={() => setSubMode(m)}>
                  <View style={[styles.indChip, { backgroundColor: subMode === m ? theme.tint : theme.background }]}>
                    <Text style={[styles.indChipText, { color: subMode === m ? '#fff' : theme.text }]}>
                      {{ macd: 'MACD', kdj: 'KDJ', rsi: 'RSI', volume: '量', amount: '额' }[m]}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerBtn: { fontSize: 18 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  titleBlock: {
    height: 88, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 12,
  },
  titleBlockLand: { height: 56 },
  titleLeft: { flex: 1, gap: 4 },
  stockName: { fontSize: 20, fontWeight: '700' },
  stockCode: { fontSize: 13, fontVariant: ['tabular-nums'] },
  bigPrice: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  titleRight: { alignItems: 'flex-end', gap: 4 },
  changeAmt: { fontSize: 13, fontVariant: ['tabular-nums'] },
  changePct: { fontSize: 13, fontVariant: ['tabular-nums'] },
  optionBar: {
    height: 44, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 14,
  },
  periodSeg: { flexDirection: 'row', gap: 4 },
  periodBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  periodText: { fontSize: 13, fontWeight: '600' },
  optBtn: { fontSize: 13, fontWeight: '600' },
  indHint: { fontSize: 10, paddingHorizontal: 16, paddingBottom: 2 },
  tipBox: { marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 8 },
  chartCard: { marginHorizontal: 16, borderRadius: 14, padding: 8, justifyContent: 'center' },
  chartLoading: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  noData: { textAlign: 'center' },
  dlHint: { fontSize: 13, fontWeight: '600' },
  overviewWrap: { paddingHorizontal: 16, marginTop: 12, gap: 8 },
  overviewTitle: { fontSize: 13 },
  statusBar: { height: 28, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  statusText: { fontSize: 10 },
  indMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  indPanel: { borderRadius: 14, padding: 16, gap: 10 },
  indPanelTitle: { fontSize: 13, fontWeight: '600' },
  indRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  indChipText: { fontSize: 13, fontWeight: '600' },
});