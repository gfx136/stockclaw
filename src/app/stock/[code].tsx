import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FullIndicatorSheet, type BbiRuleResult } from '@/components/full-indicator-sheet';
import { IndicatorOverviewStrip, type OverviewItem } from '@/components/indicator-overview';
import { InteractiveKline, type SubMode } from '@/components/interactive-kline';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { fetchQuote } from '@/lib/api/failover';
import { getDetailName, neighborCode } from '@/lib/detail-nav';
import { isFavorite, toggleFavorite } from '@/lib/favorites';
import { useT } from '@/lib/i18n';
import { fmtChange, fmtPercent, fmtPrice, monthDayTime, upDownColor } from '@/lib/format';
import { indicatorColor } from '@/lib/indicator-palette';
import { calcAllIndicators, nthLast, snapshotAt } from '@/lib/indicators';
import { downloadAllPeriods, downloadKlines } from '@/lib/kline-downloader';
import { lastUpdateAt, loadKlines } from '@/lib/kline-db';
import {
  getDefaultBars,
  getDetailLandscape,
  getIndicatorToggles,
  getSubIndicator,
  setDetailLandscape,
  setIndicatorToggle,
  setSubIndicator,
  type IndToggleKey,
} from '@/lib/prefs';
import type { IndicatorSeries, KlineBar, KlinePeriod, Stock } from '@/types/stock';

/**
 * 个股详情页（补充规格 v1.2 §1/§3/§4/§5 定稿）。
 * 竖屏 7 区块：标题行56 / 价格区72 / 选项行44 / K线主图262 / 副图78 / 速览带136 / 状态条28。
 * 横屏：标题行56(含价格) / 选项行40 / 主图146 / 副图43 / 速览带64。
 * 比例硬约束：主图:副图 = 3.4:1（两向）。
 */

const PERIODS: { key: KlinePeriod; labelKey: string; shortKey: string }[] = [
  { key: '60min', labelKey: 'detail_period60m', shortKey: 'detail_period60mShort' },
  { key: 'daily', labelKey: 'detail_periodDaily', shortKey: 'detail_periodDailyShort' },
  { key: 'weekly', labelKey: 'detail_periodWeekly', shortKey: 'detail_periodWeeklyShort' },
  { key: 'monthly', labelKey: 'detail_periodMonthly', shortKey: 'detail_periodMonthlyShort' },
];
const BAR_COUNT = 800;

export default function StockDetailScreen() {
  const params = useLocalSearchParams<{ code: string; name?: string }>();
  const theme = useTheme();
  const scheme = useColorScheme();
  const { t, tf } = useT();
  const isDark = scheme === 'dark';
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [subInd, setSubInd] = useState<SubMode>('macd');
  const [toggles, setToggles] = useState<Record<IndToggleKey, boolean>>({
    ma5: true, ma10: true, ma20: true, ma26: true, ma60: false,
    boll: false, bbi: true, macd: true, kdj: false, rsi: false,
  });
  const [indOpen, setIndOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [landscape, setLandscape] = useState(false);
  const [defaultBars, setDefaultBarsState] = useState(60);
  const [dataAt, setDataAt] = useState<number | null>(null);
  const [weeklyBars, setWeeklyBars] = useState<KlineBar[]>([]);

  const stockName = name || getDetailName(code) || code;

  // 载入偏好
  useEffect(() => {
    (async () => {
      setToggles(await getIndicatorToggles());
      setLandscape(await getDetailLandscape());
      setDefaultBarsState(await getDefaultBars());
      const sub = await getSubIndicator();
      if (sub) setSubInd(sub as SubMode);
    })();
  }, []);

  // 横竖屏切换（§4.6）
  useEffect(() => {
    ScreenOrientation.lockAsync(
      landscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP
    ).catch(() => {});
  }, [landscape]);
  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // 行情 + 收藏
  useEffect(() => {
    if (!code) return;
    (async () => {
      setFav(await isFavorite(code));
      try {
        const q = await fetchQuote(code);
        if (q && Object.keys(q).length > 0) setQuote(q);
      } catch { /* 不阻塞 K 线 */ }
    })();
  }, [code]);

  /**
   * 读 K 线（问题2修复）：**本地优先 → 本地不足时自动联网回退 → 成功即落库**。
   * 规格「本地化数据模式」明确：K 线优先读本地，缺失的股票自动走网络。
   * 之前只读本地、缺失就显示"尚未下载"，导致已下载全量数据仍误报。
   */
  const loadBars = useCallback(async (c: string, p: KlinePeriod) => {
    if (!c) return;
    setLoading(true);
    try {
      // ① 本地
      let rows = await loadKlines(c, p, BAR_COUNT);
      if (rows.length >= 30) {
        setBars(rows);
        setSeries(calcAllIndicators(rows, [3, 5, 6, 10, 12, 20, 24, 26, 60]));
        setDataAt(await lastUpdateAt());
        return;
      }
      // ② 本地不足 → 联网回退，并落库（下次即命中本地）
      try {
        const r = await downloadKlines(c, p, BAR_COUNT, false);
        if (r.ok) {
          rows = await loadKlines(c, p, BAR_COUNT);
          setBars(rows);
          setSeries(rows.length >= 30 ? calcAllIndicators(rows, [3, 5, 6, 10, 12, 20, 24, 26, 60]) : null);
          setDataAt(await lastUpdateAt());
          return;
        }
      } catch { /* 回退失败则保持空态 */ }
      setBars([]);
      setSeries(null);
    } catch {
      setBars([]);
      setSeries(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadBars(code, period); }, [code, period, loadBars]);

  // 周线（BBI 组规则判定用）：同样本地优先 + 联网回退
  useEffect(() => {
    if (!code) return;
    (async () => {
      try {
        let w = await loadKlines(code, 'weekly', 300);
        if (w.length < 27) {
          const r = await downloadKlines(code, 'weekly', 300, false).catch(() => null);
          if (r?.ok) w = await loadKlines(code, 'weekly', 300);
        }
        setWeeklyBars(w);
      } catch { setWeeklyBars([]); }
    })();
  }, [code]);

  const onDownload = useCallback(async () => {
    if (!code) return;
    setDownloading(true);
    setTip(null);
    try {
      const results = await downloadAllPeriods(code, BAR_COUNT);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount === 0) {
        setTip(t('detail_downloadHint'));
      } else {
        setTip(tf('detail_downloadOk', { ok: okCount, total: results.length }));
        await loadBars(code, period);
        setWeeklyBars(await loadKlines(code, 'weekly', 300).catch(() => []));
      }
    } catch (e) {
      setTip(e instanceof Error ? e.message : t('detail_downloadError'));
    } finally {
      setDownloading(false);
    }
  }, [code, period, loadBars]);

  const handleToggleFav = useCallback(async () => {
    if (!code) return;
    setFav(await toggleFavorite(code, stockName));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [code, stockName]);

  /** 切换股票（保留周期/指标/根数/方向；§1.3） */
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

  // 长按箭头连续快切（0.4s/只；§1.3）
  const fastTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startFast = useCallback((dir: 1 | -1) => {
    fastTimer.current = setInterval(() => goNeighbor(dir), 400);
  }, [goNeighbor]);
  const stopFast = useCallback(() => {
    if (fastTimer.current) { clearInterval(fastTimer.current); fastTimer.current = null; }
  }, []);
  useEffect(() => () => stopFast(), [stopFast]);

  const onShare = useCallback(async () => {
    try {
      await Share.share({
        message: `${stockName} ${code}  ${fmtPrice(quote?.price)}  ${fmtPercent(quote?.changePercent)}`,
      });
    } catch { /* 取消 */ }
  }, [stockName, code, quote]);

  const toggleLandscape = useCallback(() => {
    const next = !landscape;
    setLandscape(next);
    setDetailLandscape(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [landscape]);

  const onToggleIndicator = useCallback((k: IndToggleKey) => {
    setToggles((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      setIndicatorToggle(k, next[k]);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // 快照（选中 bar 优先，否则最新）
  const snapshot = useMemo(() => {
    if (!series || bars.length === 0) return null;
    if (selIdx !== null && selIdx >= 0 && selIdx < bars.length) {
      const sub = bars.slice(0, selIdx + 1);
      const subSeries = calcAllIndicators(sub, [3, 5, 6, 10, 12, 20, 24, 26, 60]);
      return snapshotAt(subSeries, sub) as unknown as Record<string, number | undefined>;
    }
    return snapshotAt(series, bars) as unknown as Record<string, number | undefined>;
  }, [series, bars, selIdx]);

  const latestClose = selIdx !== null && bars[selIdx] ? bars[selIdx].close : (bars[bars.length - 1]?.close ?? 0);

  const macdCross = useMemo(() => {
    if (!series) return null;
    const d0 = nthLast(series.macd.dif, 0), e0 = nthLast(series.macd.dea, 0);
    const d1 = nthLast(series.macd.dif, 1), e1 = nthLast(series.macd.dea, 1);
    if (d0 === undefined || e0 === undefined || d1 === undefined || e1 === undefined) return null;
    if (d1 <= e1 && d0 > e0) return 'golden' as const;
    if (d1 >= e1 && d0 < e0) return 'dead' as const;
    return null;
  }, [series]);

  // 速览带 6 项（固定顺序，§4.4）
  const overviewItems: OverviewItem[] = useMemo(() => {
    const s = snapshot ?? {};
    const rel = (v?: number) => (v === undefined ? '—' : latestClose >= v ? t('detail_above') : t('detail_below'));
    return [
      { key: 'bbi', name: 'BBI', value: fmtPrice(s.bbi), judge: rel(s.bbi), enabled: toggles.bbi },
      { key: 'ma20', name: 'MA20', value: fmtPrice(s.ma20), judge: rel(s.ma20), enabled: toggles.ma20 },
      { key: 'ma26', name: 'MA26', value: fmtPrice(s.ma26), judge: rel(s.ma26), enabled: toggles.ma26 },
      {
        key: 'macd', name: 'MACD', value: fmtPrice(s.macdHist),
        judge: macdCross === 'golden' ? t('detail_goldenCross') : macdCross === 'dead' ? t('detail_deadCross') : (s.macdHist ?? 0) >= 0 ? t('detail_histPositive') : t('detail_histNegative'),
        enabled: toggles.macd,
      },
      { key: 'kdj', name: 'KDJ', value: `J=${fmtPrice(s.j)}`, judge: (s.j ?? 50) > 100 ? t('detail_overbought') : (s.j ?? 50) < 0 ? t('detail_oversold') : t('detail_neutral'), enabled: toggles.kdj },
      { key: 'rsi', name: 'RSI', value: fmtPrice(s.rsi14), judge: (s.rsi14 ?? 50) > 70 ? t('detail_overbought') : (s.rsi14 ?? 50) < 30 ? t('detail_oversold') : t('detail_neutral'), enabled: toggles.rsi },
    ];
  }, [snapshot, toggles, macdCross, latestClose]);

  // BBI 六条规则判定（§5.3）
  const bbiRules: BbiRuleResult[] = useMemo(() => {
    const mk = (label: string, pass: boolean | null, needBars?: number): BbiRuleResult =>
      pass === null ? { label, status: 'nodata', needBars } : { label, status: pass ? 'ok' : 'no' };
    const dOk = bars.length >= 25;
    const wOk = weeklyBars.length >= 27;
    const dSeries = dOk ? calcAllIndicators(bars, [20, 26]) : null;
    const wSeries = wOk ? calcAllIndicators(weeklyBars, [26]) : null;
    const dClose = bars[bars.length - 1]?.close ?? 0;
    const dBbi = dSeries ? nthLast(dSeries.bbi, 0) : undefined;
    const dMa26 = dSeries ? nthLast(dSeries.ma[26], 0) : undefined;
    const wClose = weeklyBars[weeklyBars.length - 1]?.close ?? 0;
    const wOpen = weeklyBars[weeklyBars.length - 1]?.open ?? 0;
    const wBbi = wSeries ? nthLast(wSeries.bbi, 0) : undefined;
    const wMa26 = wSeries ? nthLast(wSeries.ma[26], 0) : undefined;
    // 连续 4 根收盘 > BBI
    let fourOk: boolean | null = dOk ? true : null;
    if (dSeries && bars.length >= 25) {
      for (let k = 0; k < 4; k++) {
        const bi = bars.length - 1 - k;
        const bbiV = dSeries.bbi[bi];
        if (bbiV === undefined || bars[bi].close <= bbiV) { fourOk = false; break; }
      }
    }
    return [
      mk(t('detail_ruleDailyCloseAboveBbi'), dBbi !== undefined ? dClose > dBbi : null, 25),
      mk(t('detail_ruleDaily4AboveBbi'), fourOk, 25),
      mk(t('detail_ruleDailyBbiAboveMa26'), dBbi !== undefined && dMa26 !== undefined ? dBbi > dMa26 : null, 27),
      mk(t('detail_ruleWeeklyCloseAboveBbi'), wBbi !== undefined ? wClose > wBbi : null, 27),
      mk(t('detail_ruleWeeklyBbiAboveMa26'), wBbi !== undefined && wMa26 !== undefined ? wBbi > wMa26 : null, 27),
      mk(t('detail_ruleWeeklyRed'), wOk ? wClose > wOpen : null, 27),
    ];
  }, [bars, weeklyBars]);

  /**
   * 屏占比（用户反馈调整：K 线占比要更大）。
   * 可用高度 = 屏幕高 − 顶部安全区 − 底部安全区（规格 §4.1 口径）。
   * 竖屏分配：标题行 48 + 价格区 60 + 选项行 40 + 图表区(剩余最大) + 速览带 118 + 状态条 22。
   * K 线主图 : 副图 维持 3.4 : 1（规格硬约束 S37）。
   */
  const availH = winH - insets.top - insets.bottom;
  const TITLE_H = landscape ? 40 : 48;
  const PRICE_H = landscape ? 0 : 60;
  const OPT_H = landscape ? 36 : 40;
  const STRIP_H = landscape ? 56 : 118;
  const STATUS_H = landscape ? 0 : 22;
  const chartTotalH = Math.max(
    landscape ? 180 : 300,
    availH - TITLE_H - PRICE_H - OPT_H - STRIP_H - STATUS_H - 16
  );
  // 小屏（可用高度 <660pt）内容可能溢出，此时允许滚动兜底；
  // 常规机型内容刚好一屏，禁用滚动以免干扰图表手势（问题3）
  const needScroll = availH < 660;
  // 主图:副图 = 3.4:1（规格 S37 硬约束）
  const subH = Math.round(chartTotalH / 4.4);
  const chartW = winW - 16 * 2 - 8;
  const changeColor = upDownColor(quote?.changePercent);
  const hasPrice = (quote?.price ?? 0) > 0;
  const isFlat = !quote?.changePercent;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* ① 标题行（紧贴灵动岛下方，无冗余留白；问题6）
          左段仅一个返回箭头（去掉"返回"二字，避免与系统返回重复感） */}
      <View style={[styles.titleRow, { paddingTop: insets.top, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} accessibilityLabel={t('common_back')}>
          <Text style={[styles.backText, { color: theme.tint }]}>‹</Text>
        </Pressable>

        {/* 中段：◀ 名称+代码 ▶（整体居中，长名省略不挤压箭头） */}
        <View style={styles.midSeg}>
          <Pressable
            onPress={() => goNeighbor(-1)}
            onLongPress={() => startFast(-1)}
            onPressOut={stopFast}
            hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
            style={styles.arrowBtn}
            accessibilityLabel={t('detail_prev')}>
            <Text style={[styles.arrow, { color: theme.text }]}>◀</Text>
          </Pressable>
          <View style={styles.nameBlock}>
            <Text style={[styles.stockName, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
              {stockName.slice(0, 8)}
            </Text>
            <Text style={[styles.stockCode, { color: theme.textSecondary }]} numberOfLines={1}>
              {code}
            </Text>
          </View>
          <Pressable
            onPress={() => goNeighbor(1)}
            onLongPress={() => startFast(1)}
            onPressOut={stopFast}
            hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
            style={styles.arrowBtn}
            accessibilityLabel={t('detail_next')}>
            <Text style={[styles.arrow, { color: theme.text }]}>▶</Text>
          </Pressable>
        </View>

        {/* 横屏：价格并入标题行（§4.3） */}
        {landscape ? (
          <View style={styles.landPrice}>
            <Text style={[styles.landPriceVal, { color: hasPrice ? changeColor : theme.textSecondary }]}>
              {hasPrice ? fmtPrice(quote?.price) : '--'}
            </Text>
            <Text style={[styles.landPriceChg, { color: changeColor }]}>
              {hasPrice && !isFlat ? `${fmtChange(quote?.changeAmount)} ${fmtPercent(quote?.changePercent)}` : ''}
            </Text>
          </View>
        ) : null}

        {/* 右段：星标 + 分享（32pt 图标，距右 12pt） */}
        <View style={styles.rightSeg}>
          <Pressable onPress={handleToggleFav} hitSlop={8} style={styles.iconBtn} accessibilityLabel={t('detail_addFav')}>
            <Text style={[styles.icon, { color: fav ? theme.tint : theme.text }]}>{fav ? '★' : '☆'}</Text>
          </Pressable>
          <Pressable onPress={onShare} hitSlop={8} style={styles.iconBtn} accessibilityLabel={t('common_share')}>
            <Text style={[styles.icon, { color: theme.text }]}>⤴</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={needScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ② 价格区（横屏已并入标题行） */}
        {!landscape ? (
          <View style={[styles.priceBlock, { height: PRICE_H }]}>
            <View style={styles.priceLeft}>
              <Text style={[styles.bigPrice, { color: hasPrice ? changeColor : theme.textSecondary }]}>
                {hasPrice ? fmtPrice(quote?.price) : '--'}
              </Text>
              <Text style={[styles.priceChg, { color: hasPrice && !isFlat ? changeColor : theme.textSecondary }]}>
                {hasPrice && !isFlat ? `${fmtChange(quote?.changeAmount)}  ${fmtPercent(quote?.changePercent)}` : '--'}
              </Text>
            </View>
            <View style={styles.priceRight}>
              <View style={styles.ohlcRow}>
                <Text style={[styles.ohlcLabel, { color: theme.textSecondary }]}>{t('detail_open')}</Text>
                <Text style={[styles.ohlcVal, { color: theme.text }]}>{fmtPrice(quote?.open)}</Text>
                <Text style={[styles.ohlcLabel, { color: theme.textSecondary }]}>{t('detail_prevClose')}</Text>
                <Text style={[styles.ohlcVal, { color: theme.text }]}>{fmtPrice(quote?.prevClose)}</Text>
              </View>
              <View style={styles.ohlcRow}>
                <Text style={[styles.ohlcLabel, { color: theme.textSecondary }]}>{t('detail_high')}</Text>
                <Text style={[styles.ohlcVal, { color: theme.text }]}>{fmtPrice(quote?.high)}</Text>
                <Text style={[styles.ohlcLabel, { color: theme.textSecondary }]}>{t('detail_low')}</Text>
                <Text style={[styles.ohlcVal, { color: theme.text }]}>{fmtPrice(quote?.low)}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ③ 选项行 */}
        <View style={[styles.optionBar, { height: OPT_H }]}>
          <View style={styles.periodSeg}>
            {PERIODS.map((p) => {
              const on = p.key === period;
              return (
                <Pressable key={p.key} onPress={() => { setPeriod(p.key); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} hitSlop={4}>
                  <View style={[styles.periodBtn, { backgroundColor: on ? theme.tint : 'transparent' }]}>
                    <Text style={[styles.periodText, { color: on ? '#fff' : theme.text }]}>
                      {landscape ? t(p.shortKey as never) : t(p.labelKey as never)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.optSpacer} />
          <Pressable onPress={() => setIndOpen(true)} hitSlop={8}>
            <Text style={[styles.optBtn, { color: theme.tint }]}>{t('detail_indicators')} ▾</Text>
          </Pressable>
          <Pressable onPress={() => { setResetToken((t) => t + 1); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} hitSlop={8}>
            <Text style={[styles.optBtn, { color: theme.text }]}>{t('detail_reset')}</Text>
          </Pressable>
          <Pressable onPress={toggleLandscape} hitSlop={8}>
            <Text style={[styles.optBtn, { color: theme.text }]}>⤢</Text>
          </Pressable>
          <Pressable onPress={onDownload} disabled={downloading} hitSlop={8}>
            {downloading ? <ActivityIndicator size="small" /> : <Text style={[styles.optBtn, { color: theme.tint }]}>{t('detail_download')}</Text>}
          </Pressable>
        </View>

        {tip ? (
          <View style={[styles.tipBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">{tip}</ThemedText>
          </View>
        ) : null}

        {/* ④ 图表区（K线主图 + 副图，比例 3.4:1） */}
        <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement, marginHorizontal: 16 }]}>
          {loading && bars.length === 0 ? (
            <View style={[styles.chartLoading, { height: chartTotalH }]}><ActivityIndicator /></View>
          ) : bars.length === 0 ? (
            <View style={[styles.chartLoading, { height: chartTotalH }]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.noData}>
                {t('detail_noKline')}
              </ThemedText>
              <Pressable onPress={onDownload} disabled={downloading}>
                <Text style={[styles.dlHint, { color: theme.tint }]}>{downloading ? t('detail_downloading') : t('detail_retryDownload')}</Text>
              </Pressable>
            </View>
          ) : (
            <InteractiveKline
              bars={bars}
              width={chartW}
              height={chartTotalH}
              subHeight={subH}
              series={series ?? undefined}
              maOverlay={[5, 10, 20, 26, 60].filter((p) => (toggles[`ma${p}` as IndToggleKey]))}
              showBoll={toggles.boll}
              showBbi={toggles.bbi}
              subMode={subInd}
              resetToken={resetToken}
              onSelectBar={setSelIdx}
              defaultVisible={defaultBars}
              isDark={isDark}
              labelBg={isDark ? '#FFFFFF' : theme.text}
              labelFg={isDark ? '#000000' : theme.background}
              gridColor={theme.border}
              axisColor={theme.textSecondary}
              textColor={theme.text}
            />
          )}
        </View>

        {/* ⑤ 指标速览带（136pt / 横屏 64pt，条带非卡片） */}
        {snapshot ? (
          <View style={[styles.stripWrap, { marginHorizontal: 16 }]}>
            <IndicatorOverviewStrip
              items={overviewItems}
              selectDate={selIdx !== null && bars[selIdx] ? bars[selIdx].date : null}
              landscape={landscape}
              isDark={isDark}
              onToggle={(k) => onToggleIndicator(k as IndToggleKey)}
              onOpenFull={() => setSheetOpen(true)}
            />
          </View>
        ) : null}

        {/* ⑦ 数据状态条（横屏并入标题行） */}
        {!landscape ? (
          <View style={styles.statusBar}>
            <ThemedText type="code" themeColor="textSecondary" style={styles.statusText}>
              {tf('detail_dataSource', { time: dataAt ? monthDayTime(dataAt) : (bars[bars.length - 1]?.date ?? '—') })}
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>

      {/* 指标开关浮层（§3.6：主图多选 + 副图单选） */}
      <Modal visible={indOpen} transparent animationType="fade" onRequestClose={() => setIndOpen(false)}>
        <Pressable style={styles.indMask} onPress={() => setIndOpen(false)}>
          <View style={[styles.indPanel, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.indPanelTitle, { color: theme.text }]}>{t('detail_mainOverlay')}</Text>
            <View style={styles.indRow}>
              {(['ma5', 'ma10', 'ma20', 'ma26', 'ma60', 'boll', 'bbi'] as IndToggleKey[]).map((k) => (
                <Pressable key={k} onPress={() => onToggleIndicator(k)}>
                  <View style={[styles.indChip, { backgroundColor: toggles[k] ? theme.backgroundSelected : theme.background }]}>
                    <View style={[styles.indDot, { backgroundColor: indicatorColor(k === 'boll' ? 'boll' : k as never, isDark) }]} />
                    <Text style={[styles.indChipText, { color: theme.text, fontWeight: toggles[k] ? '700' : '400' }]}>
                      {k === 'boll' ? 'BOLL' : k.toUpperCase()}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.indPanelTitle, { color: theme.text }]}>{t('detail_subIndicator')}</Text>
            <View style={styles.indRow}>
              {(['macd', 'kdj', 'rsi', 'volume', 'amount'] as SubMode[]).map((m) => (
                <Pressable key={m} onPress={() => { setSubInd(m); setSubIndicator(m); }}>
                  <View style={[styles.indChip, { backgroundColor: subInd === m ? theme.tint : theme.background }]}>
                    <Text style={[styles.indChipText, { color: subInd === m ? '#fff' : theme.text }]}>
                      {{ macd: 'MACD', kdj: 'KDJ', rsi: 'RSI', volume: t('detail_vol'), amount: t('detail_amt') }[m]}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ⑤ 完整指标数值 Sheet（§5） */}
      <FullIndicatorSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        stockName={stockName}
        code={code}
        period={period}
        bars={bars}
        selIdx={selIdx}
        series={series}
        snapshot={snapshot}
        bbiRules={bbiRules}
        isDark={isDark}
        onPeriodChange={(p) => setPeriod(p)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  titleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 34, height: 40, justifyContent: 'center', alignItems: 'center' },
  backText: { fontSize: 26, lineHeight: 30, fontWeight: '300' },
  midSeg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  arrowBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 14 },
  nameBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 8, maxWidth: 190 },
  stockName: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  stockCode: { fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 0 },
  landPrice: { alignItems: 'flex-end', marginRight: 12, gap: 1 },
  landPriceVal: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  landPriceChg: { fontSize: 10, fontVariant: ['tabular-nums'] },
  rightSeg: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 18 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  priceBlock: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  priceLeft: { flex: 0.6, gap: 4 },
  bigPrice: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  priceChg: { fontSize: 13, fontVariant: ['tabular-nums'] },
  priceRight: { flex: 0.4, gap: 4 },
  ohlcRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ohlcLabel: { fontSize: 11, width: 26 },
  ohlcVal: { fontSize: 11, fontVariant: ['tabular-nums'], width: 46 },
  optionBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 14 },
  periodSeg: { flexDirection: 'row', gap: 4 },
  periodBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  periodText: { fontSize: 13, fontWeight: '600' },
  optSpacer: { flex: 1 },
  optBtn: { fontSize: 13, fontWeight: '600' },
  tipBox: { marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 8 },
  chartCard: { borderRadius: 14, padding: 8, justifyContent: 'center' },
  chartLoading: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  noData: { textAlign: 'center' },
  dlHint: { fontSize: 13, fontWeight: '600' },
  stripWrap: { marginTop: 12 },
  statusBar: { height: 28, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  statusText: { fontSize: 10 },
  indMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  indPanel: { borderRadius: 14, padding: 16, gap: 10 },
  indPanelTitle: { fontSize: 13, fontWeight: '600' },
  indRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  indDot: { width: 8, height: 8, borderRadius: 4 },
  indChipText: { fontSize: 13 },
});