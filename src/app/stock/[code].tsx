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
import { Icon } from '@/components/icon';
import { TouchTarget } from '@/components/touch-target';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { fetchQuote } from '@/lib/api/failover';
import { getDetailName, neighborCode } from '@/lib/detail-nav';
import { isFavorite, toggleFavorite } from '@/lib/favorites';
import { useT } from '@/lib/i18n';
import { fmtChange, fmtPercent, fmtPrice, monthDayTime, upDownColor } from '@/lib/format';
import { indicatorColor } from '@/lib/indicator-palette';
import { calcAllIndicators, nthLast, snapshotAt } from '@/lib/indicators';
import { downloadAllPeriods, refreshStockKlines } from '@/lib/kline-downloader';
import { getLastUpdate, loadKlines } from '@/lib/kline-db';
import {
  getDefaultBars,
  getIndicatorToggles,
  getSubIndicator,
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
/** 本地至少有这么几根就先画图（不足 30 根只是没有指标，不该当成"没数据"） */
const MIN_RENDER_BARS = 5;

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
  /**
   * 横屏判定（用户反馈4修复）：直接**跟随设备实际方向**。
   * 之前用 state + 手动按钮，会在进页面时 lockAsync(PORTRAIT_UP)，
   * 导致手机转横屏不再自动旋转（"旋转屏幕功能不见了"）。
   * 现在默认解锁方向（见下方 effect），横屏与否由窗口尺寸决定。
   */
  const landscape = winW > winH;
  const [defaultBars, setDefaultBarsState] = useState(60);
  const [dataAt, setDataAt] = useState<number | null>(null);
  const [weeklyBars, setWeeklyBars] = useState<KlineBar[]>([]);
  /** 滚动区实测视口高度（问题1修复：不再靠屏高硬算，避免零碎间距累积误差） */
  const [viewportH, setViewportH] = useState(0);

  const stockName = name || getDetailName(code) || code;

  // 载入偏好
  useEffect(() => {
    (async () => {
      setToggles(await getIndicatorToggles());
      setDefaultBarsState(await getDefaultBars());
      const sub = await getSubIndicator();
      if (sub) setSubInd(sub as SubMode);
    })();
  }, []);

  /**
   * 屏幕方向（用户反馈4修复）。
   * 进详情页时**解锁**方向 → 手机转横屏自动生效（恢复原来的转屏习惯）；
   * 离开详情页再锁回竖屏，其它页面不受影响。
   */
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
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
   * 数据加载（问题2 + 问题3 一起解决）。
   *
   * ❗问题2 的真相不止一个：除了下载侧「接口返回空仍被标记完成」导致本地其实没数据，
   *   原来的读取逻辑本身也会误报——它要求 `rows.length >= 30` 才算「有数据」，
   *   否则走联网回退，**回退失败就把已有的那几根本地数据也丢掉**，于是显示"需要下载"。
   *   现在只要本地有 ≥ MIN_RENDER_BARS 根就先画出来。
   *
   * ❗问题3：点开个股即静默后台更新该股全部周期（不弹窗、不阻塞界面）。
   *   刷新确实带回了新数据才重绘，避免打断用户正在看的十字光标。
   */
  const applyRows = useCallback((rows: KlineBar[], at: number | null) => {
    setBars(rows);
    setSeries(rows.length >= 30 ? calcAllIndicators(rows, [3, 5, 6, 10, 12, 20, 24, 26, 60]) : null);
    setDataAt(at);
  }, []);

  const loadSeq = useRef(0);
  useEffect(() => {
    if (!code) return;
    const seq = ++loadSeq.current;
    const alive = () => loadSeq.current === seq;

    (async () => {
      setLoading(true);
      // ① 先把本地已有的立刻画出来（含只有几根的残缺情况，不再一律当没有）
      const local = await loadKlines(code, period, BAR_COUNT).catch(() => [] as KlineBar[]);
      if (!alive()) return;
      applyRows(local, await getLastUpdate(code, period).catch(() => null));
      if (local.length >= MIN_RENDER_BARS) setLoading(false);

      // ② 后台补齐/更新该股全部周期（本地已是最新时几乎零开销）
      const changed = await refreshStockKlines(code, BAR_COUNT).catch(() => false);
      if (!alive()) return;

      // ③ 有新数据、或本地本来就不够 → 重读当前周期并重绘
      if (changed || local.length < MIN_RENDER_BARS) {
        const rows = await loadKlines(code, period, BAR_COUNT).catch(() => [] as KlineBar[]);
        if (!alive()) return;
        applyRows(rows, await getLastUpdate(code, period).catch(() => null));
      }

      // ④ 周线（BBI 六条规则需要）
      const w = await loadKlines(code, 'weekly', 300).catch(() => [] as KlineBar[]);
      if (alive()) setWeeklyBars(w);
      if (alive()) setLoading(false);
    })();

    return () => { /* 由 seq 作废过期结果 */ };
  }, [code, period, applyRows]);

  /** 手动「下载」按钮：强制补该股 4 个周期，再重读当前周期 */
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
        const rows = await loadKlines(code, period, BAR_COUNT).catch(() => [] as KlineBar[]);
        applyRows(rows, await getLastUpdate(code, period).catch(() => null));
        setWeeklyBars(await loadKlines(code, 'weekly', 300).catch(() => []));
      }
    } catch (e) {
      setTip(e instanceof Error ? e.message : t('detail_downloadError'));
    } finally {
      setDownloading(false);
    }
  }, [code, period, applyRows, t, tf]);

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

  /** 手动切横/竖屏（设备本身旋转也能生效，这个按钮只是不想转手机时的快捷方式） */
  const toggleLandscape = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ScreenOrientation.lockAsync(
      landscape
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.LANDSCAPE
    ).catch(() => {});
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

  const PRICE_H = landscape ? 0 : 60;
  const OPT_H = 44;   // UI 评审：选项行按钮需 44pt 命中区，行高同步提到 44
  const STRIP_H = landscape ? 56 : 118;
  const STATUS_H = landscape ? 0 : 22;

  /**
   * 屏占比（问题1修复：底部被遮挡且无法下滑）。
   *
   * 旧实现的两个硬伤：
   *   ① 图表高度用 `availH`（屏高−安全区）减固定块算出来，但没算卡片内边距(16)、
   *      速览带 marginTop(12)、状态条 marginTop+height(30)、contentContainer paddingBottom
   *      这些零碎 —— 内容高度恒定比视口多 **38pt**，最后一截永远被切掉。
   *   ② `scrollEnabled` 绑在 `availH < 660` 这个硬阈值上，常规机型一律禁用滚动，
   *      于是被切掉的部分**既看不到也滑不到**。
   *
   * 新实现：用 onLayout 实测滚动视口高度，把「除图表外的所有高度」显式累加成 CHROME_H，
   * 图表吃满剩余空间；只有当剩余空间小于 MIN_CHART_H（小屏/横屏）时才启用滚动兜底。
   * 这样常规机型是**精确一屏、不滚动**（不干扰图表手势），小屏才滚动。
   */
  const MIN_CHART_H = landscape ? 200 : 300;
  // 除图表外的固定高度（与下面 JSX 里实际用的间距/高度一一对应，改布局要同步改这里）
  const CHROME_H =
    PRICE_H +                                    // 价格区
    OPT_H +                                      // 选项行
    16 +                                         // chartCard 上下 padding 8+8
    (landscape ? 0 : 12) +                       // stripWrap marginTop
    STRIP_H +                                    // 指标速览带
    (landscape ? 0 : 8 + STATUS_H) +             // 状态条 marginTop + 高度
    16 +                                         // contentContainer paddingBottom 基础值
    insets.bottom;                               // 底部安全区
  // viewportH 首帧为 0，用估算值兜底（标题行实测约 44pt），避免闪一下错误高度。
  // 注意：滚动区一直延伸到底边，底部安全区是靠 contentContainer 的 paddingBottom 留的，
  // 所以估算里**不能**再减 insets.bottom，否则首帧会矮一截。
  const vh = viewportH || Math.max(240, winH - insets.top - 44);
  const fittedChartH = vh - CHROME_H;
  const chartTotalH = Math.max(MIN_CHART_H, Math.round(fittedChartH));
  // 只有「塞不下」才允许滚动；塞得下时禁用，避免与图表横滑手势抢事件
  const needScroll = fittedChartH < MIN_CHART_H;
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
        <TouchTarget onPress={() => router.back()} accessibilityLabel={t('common_back')} style={styles.backBtn}>
          <Icon name="chevron.left" size={19} color={theme.tint} weight="semibold" fallbackGlyph="‹" />
        </TouchTarget>

        {/* 中段：◀ 名称+代码 ▶（整体居中，长名省略不挤压箭头） */}
        <View style={styles.midSeg}>
          <Pressable
            onPress={() => goNeighbor(-1)}
            onLongPress={() => startFast(-1)}
            onPressOut={stopFast}
            hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
            style={styles.arrowBtn}
            accessibilityLabel={t('detail_prev')}>
            <Icon name="chevron.left" size={13} color={theme.textSecondary} weight="semibold" fallbackGlyph="◀" />
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
            <Icon name="chevron.right" size={13} color={theme.textSecondary} weight="semibold" fallbackGlyph="▶" />
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

        {/* 右段：风险体检 + 星标 + 分享（32pt 图标） */}
        <View style={styles.rightSeg}>
          <Pressable
            onPress={() => router.push(`/risk/${code}?name=${encodeURIComponent(stockName)}` as never)}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityLabel={t('risk_entry')}>
            <Icon name="shield.lefthalf.filled" size={19} color={theme.tint} weight="regular" fallbackGlyph="🛡" />
          </Pressable>
          <Pressable onPress={handleToggleFav} hitSlop={8} style={styles.iconBtn} accessibilityLabel={t('detail_addFav')} accessibilityState={{ selected: fav }}>
            <Icon name={fav ? 'star.fill' : 'star'} size={19} color={fav ? theme.tint : theme.text} weight="regular" fallbackGlyph={fav ? '★' : '☆'} />
          </Pressable>
          <Pressable onPress={onShare} hitSlop={8} style={styles.iconBtn} accessibilityLabel={t('common_share')}>
            <Icon name="square.and.arrow.up" size={19} color={theme.text} weight="regular" fallbackGlyph="⤴" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 16 + insets.bottom }]}
        scrollEnabled={needScroll}
        showsVerticalScrollIndicator={needScroll}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setViewportH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
        }}
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
                <TouchTarget
                  key={p.key}
                  onPress={() => { setPeriod(p.key); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  accessibilityLabel={t(p.labelKey as never)}
                  selected={on}>
                  <View style={[styles.periodBtn, { backgroundColor: on ? theme.tint : 'transparent' }]}>
                    <Text
                      numberOfLines={1}
                      style={[styles.periodText, { color: on ? theme.onAccent : theme.text }]}>
                      {landscape ? t(p.shortKey as never) : t(p.labelKey as never)}
                    </Text>
                  </View>
                </TouchTarget>
              );
            })}
          </View>
          <View style={styles.optSpacer} />
          <TouchTarget onPress={() => setIndOpen(true)} accessibilityLabel={t('detail_indicators')}>
            <View style={styles.indBtnInner}>
              <Text style={[styles.optBtn, { color: theme.tint }]}>{t('detail_indicators')}</Text>
              <Icon name="chevron.down" size={9} color={theme.tint} weight="semibold" fallbackGlyph="▾" />
            </View>
          </TouchTarget>
          <TouchTarget
            onPress={() => { setResetToken((t) => t + 1); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            accessibilityLabel={t('detail_reset')}>
            <Text style={[styles.optBtn, { color: theme.text }]}>{t('detail_reset')}</Text>
          </TouchTarget>
          <TouchTarget
            onPress={toggleLandscape}
            accessibilityLabel={landscape ? t('detail_portrait') : t('detail_landscape')}>
            {/* 原来只有一个 ⤢ 字形，系统字体缺字时会变成看不见的空白，
                用户就以为"旋转功能不见了"。保留文字标签，任何字体都能显示。 */}
            <Text style={[styles.optBtn, { color: theme.text }]}>
              {landscape ? t('detail_portrait') : t('detail_landscape')}
            </Text>
          </TouchTarget>
          <TouchTarget onPress={onDownload} disabled={downloading} accessibilityLabel={t('detail_download')}>
            {downloading ? <ActivityIndicator size="small" /> : <Text style={[styles.optBtn, { color: theme.tint }]}>{t('detail_download')}</Text>}
          </TouchTarget>
        </View>

        {tip ? (
          <View style={[styles.tipBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">{tip}</ThemedText>
          </View>
        ) : null}

        {/* ④ 图表区（K线主图 + 副图，比例 3.4:1） */}
        <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement, marginHorizontal: 16, borderColor: theme.border }]}>
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
              period={period}
              resetToken={resetToken}
              onSelectBar={setSelIdx}
              defaultVisible={defaultBars}
              isDark={isDark}
              labelBg={isDark ? '#FFFFFF' : theme.text}
              labelFg={isDark ? '#000000' : theme.background}
              gridColor={theme.chartGrid}
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
    // 全 App 左右边距都是 16；这里原来写 8，返回箭头比下方价格区更贴边。
    // 改回 4 并让返回按钮自带 12 内边距，图标光学重心落回 16 网格。
    paddingHorizontal: 4, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 34, paddingHorizontal: 12 },
  backText: { fontSize: 26, lineHeight: 30, fontWeight: '300' },
  midSeg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  arrowBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 14 },
  nameBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 8, maxWidth: 190 },
  stockName: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  stockCode: { fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 0 },
  landPrice: { alignItems: 'flex-end', marginRight: 12, gap: 1 },
  landPriceVal: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  landPriceChg: { fontSize: 11, fontVariant: ['tabular-nums'] },
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
  optionBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6 },
  // flexShrink 让 4 个周期按钮在极窄屏上先压缩、而不是把右边按钮挤出屏幕
  periodSeg: { flexDirection: 'row', gap: 2, flexShrink: 1 },
  periodBtn: { paddingHorizontal: 5, paddingVertical: 5, borderRadius: 8 },
  periodText: { fontSize: 13, fontWeight: '600' },
  optSpacer: { flex: 1 },
  optBtn: { fontSize: 13, fontWeight: '600' },
  indBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tipBox: { marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 8 },
  chartCard: { borderRadius: 12, padding: 8, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  chartLoading: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  noData: { textAlign: 'center' },
  dlHint: { fontSize: 13, fontWeight: '600' },
  stripWrap: { marginTop: 12 },
  statusBar: { height: 28, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  statusText: { fontSize: 11 },
  indMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  indPanel: { borderRadius: 14, padding: 16, gap: 10 },
  indPanelTitle: { fontSize: 13, fontWeight: '600' },
  indRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  indDot: { width: 8, height: 8, borderRadius: 4 },
  indChipText: { fontSize: 13 },
});