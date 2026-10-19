import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { IndicatorBar, MALegend } from '@/components/candle-chart';
import { InteractiveKline } from '@/components/interactive-kline';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchQuote } from '@/lib/api/failover';
import { isFavorite, toggleFavorite } from '@/lib/favorites';
import {
  fmtChange,
  fmtMoney,
  fmtPE,
  fmtPercent,
  fmtPrice,
  fmtTurnover,
  fmtVolume,
  marketName,
  QuoteColors,
  upDownColor,
} from '@/lib/format';
import { calcAllIndicators, snapshotAt } from '@/lib/indicators';
import { downloadAllPeriods } from '@/lib/kline-downloader';
import { loadKlines } from '@/lib/kline-db';
import type { IndicatorSeries, KlineBar, KlinePeriod, Stock } from '@/types/stock';

const PERIODS: { key: KlinePeriod; label: string }[] = [
  { key: '60min', label: '60分钟' },
  { key: 'daily', label: '日线' },
  { key: 'weekly', label: '周线' },
  { key: 'monthly', label: '月线' },
];

/** 下载拉取的 K 线根数（足够缩放浏览历史） */
const BAR_COUNT = 500;

export default function StockDetailScreen() {
  const { code, name } = useLocalSearchParams<{ code: string; name?: string }>();
  const theme = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const [quote, setQuote] = useState<Partial<Stock> | null>(null);
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  const [bars, setBars] = useState<KlineBar[]>([]);
  const [series, setSeries] = useState<IndicatorSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [fav, setFav] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  // 叠加指标（指标管理）
  const [maOverlay, setMaOverlay] = useState<number[]>([5, 10, 20]);
  const [showBoll, setShowBoll] = useState(false);
  const [showBbi, setShowBbi] = useState(false);
  const [showIndMgr, setShowIndMgr] = useState(false);

  const stockName = name ? decodeURIComponent(name) : (code ?? '');

  /** K线占屏幕大部分：宽度全屏，高度约一半 */
  const chartW = winW - 16 * 2;
  const chartH = Math.min(Math.round(winH * 0.5), 460);

  // 实时行情 + 收藏状态
  useEffect(() => {
    if (!code) return;
    (async () => {
      setFav(await isFavorite(code));
      try {
        const q = await fetchQuote(code);
        if (q && Object.keys(q).length > 0) setQuote(q);
      } catch {
        /* 行情失败不阻塞 K 线 */
      }
    })();
  }, [code]);

  // 读取本地 K 线并计算指标
  const loadBars = useCallback(
    async (p: KlinePeriod) => {
      if (!code) return;
      setLoading(true);
      try {
        const rows = await loadKlines(code, p, BAR_COUNT);
        setBars(rows);
        setSeries(rows.length >= 30 ? calcAllIndicators(rows) : null);
      } catch {
        setBars([]);
        setSeries(null);
      } finally {
        setLoading(false);
      }
    },
    [code]
  );

  useEffect(() => {
    loadBars(period);
  }, [period, loadBars]);

  /** 下载 K 线（含 60分钟/日/周/月四周期），逐个周期显示结果 */
  const onDownload = useCallback(async () => {
    if (!code) return;
    setDownloading(true);
    setTip(null);
    try {
      const results = await downloadAllPeriods(code, BAR_COUNT);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount === 0) {
        // 把所有失败原因都列出来，便于定位
        const errs = results
          .filter((r) => !r.ok)
          .map((r) => `${r.period}: ${r.error ?? '未知'}`)
          .join('；');
        setTip(`下载失败。${errs}`);
      } else if (okCount < results.length) {
        const failed = results.filter((r) => !r.ok).map((r) => r.period).join('/');
        setTip(`部分成功 ${okCount}/${results.length}（失败：${failed}）`);
        await loadBars(period);
      } else {
        setTip(`已更新 ${results.length} 个周期`);
        await loadBars(period);
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
  }, [code, stockName]);

  /** 系统分享（纯文本卡片） */
  const onShare = useCallback(async () => {
    const text = `${stockName}(${code}) 最新价 ${fmtPrice(quote?.price)} 涨跌幅 ${fmtPercent(quote?.changePercent)} —— StockClaw`;
    try {
      await Share.share({ message: text });
    } catch {
      /* 用户取消不处理 */
    }
  }, [stockName, code, quote]);

  const snapshot = useMemo(
    () => (series && bars.length > 0 ? snapshotAt(series, bars) : null),
    [series, bars]
  );

  const changeColor = upDownColor(quote?.changePercent);
  const latest = bars.length > 0 ? bars[bars.length - 1] : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: stockName || '个股详情',
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Pressable onPress={onShare} hitSlop={10}>
                <Text style={{ fontSize: 18, color: theme.text }}>⤴</Text>
              </Pressable>
              <Pressable onPress={handleToggleFav} hitSlop={10}>
                <Text style={{ fontSize: 20, color: fav ? theme.tint : theme.text }}>
                  {fav ? '★' : '☆'}
                </Text>
              </Pressable>
            </View>
          ),
        }}
      />

      {/* 顶部紧凑行情行 */}
      <View style={styles.quoteBar}>
        <Text style={[styles.price, { color: changeColor }]}>{fmtPrice(quote?.price)}</Text>
        <Text style={[styles.change, { color: changeColor }]}>
          {fmtChange(quote?.changeAmount)}  {fmtPercent(quote?.changePercent)}
        </Text>
        <Text style={[styles.codeMeta, { color: theme.textSecondary }]}>
          {code} · {marketName(code ?? '')}
        </Text>
      </View>

      {/* 周期切换 + 下载 */}
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPeriod(p.key)}
            style={[
              styles.periodBtn,
              { backgroundColor: period === p.key ? theme.text : theme.backgroundElement },
            ]}>
            <Text
              style={[styles.periodText, { color: period === p.key ? theme.background : theme.text }]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
        <Pressable onPress={onDownload} disabled={downloading} hitSlop={6}>
          <View style={[styles.dlBtn, { backgroundColor: theme.backgroundElement, opacity: downloading ? 0.6 : 1 }]}>
            {downloading ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text style={[styles.dlText, { color: theme.tint }]}>下载</Text>
            )}
          </View>
        </Pressable>
      </View>

      {tip ? (
        <View style={[styles.tipBox, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">{tip}</ThemedText>
        </View>
      ) : null}

      {/* 指标管理入口（K线右上） */}
      <View style={styles.indMgrRow}>
        <Pressable onPress={() => setShowIndMgr((v) => !v)} hitSlop={6}>
          <Text style={[styles.indMgrBtn, { color: theme.tint }]}>
            指标 {showIndMgr ? '▲' : '▼'}
          </Text>
        </Pressable>
      </View>
      {showIndMgr ? (
        <View style={[styles.indMgrPanel, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.indMgrLabel, { color: theme.textSecondary }]}>均线</Text>
          <View style={styles.indChips}>
            {[5, 10, 20, 60].map((p) => {
              const on = maOverlay.includes(p);
              return (
                <Pressable
                  key={p}
                  onPress={() =>
                    setMaOverlay((prev) => (on ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b)))
                  }>
                  <View style={[styles.indChip, { backgroundColor: on ? theme.tint : theme.background }]}>
                    <Text style={[styles.indChipText, { color: on ? '#fff' : theme.text }]}>MA{p}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setShowBoll((v) => !v)}>
              <View style={[styles.indChip, { backgroundColor: showBoll ? theme.tint : theme.background }]}>
                <Text style={[styles.indChipText, { color: showBoll ? '#fff' : theme.text }]}>BOLL</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => setShowBbi((v) => !v)}>
              <View style={[styles.indChip, { backgroundColor: showBbi ? theme.tint : theme.background }]}>
                <Text style={[styles.indChipText, { color: showBbi ? '#fff' : theme.text }]}>BBI</Text>
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* K线大屏：占屏幕约一半 */}
      <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement }]}>
        {loading && bars.length === 0 ? (
          <View style={[styles.chartLoading, { height: chartH }]}>
            <ActivityIndicator />
          </View>
        ) : bars.length === 0 ? (
          <View style={[styles.chartLoading, { height: chartH }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.noData}>
              本地暂无 {PERIODS.find((p) => p.key === period)?.label} 数据
            </ThemedText>
            <Pressable onPress={onDownload} disabled={downloading}>
              <Text style={[styles.dlHint, { color: theme.tint }]}>
                {downloading ? '下载中…' : '点上方「下载」拉取 K 线'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <InteractiveKline
            bars={bars}
            width={chartW}
            height={chartH}
            series={series ?? undefined}
            maOverlay={maOverlay}
            showBoll={showBoll}
            showBbi={showBbi}
            defaultVisible={100}
            gridColor={theme.border}
            axisColor={theme.textSecondary}
            textColor={theme.text}
          />
        )}
      </View>

      {/* 均线图例 */}
      {series ? <MALegend periods={[5, 10, 20, 60]} series={series} /> : null}

      {/* 下方明细可滚动 */}
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        {snapshot ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">技术指标</ThemedText>
            <View style={styles.indGrid}>
              <IndicatorBar label="MACD DIF" value={fmtPrice(snapshot.dif)} color={upDownColor(snapshot.dif)} />
              <IndicatorBar label="MACD DEA" value={fmtPrice(snapshot.dea)} color={upDownColor(snapshot.dea)} />
              <IndicatorBar label="MACD 柱" value={fmtPrice(snapshot.macdHist)} color={upDownColor(snapshot.macdHist)} />
              <IndicatorBar label="KDJ K" value={fmtPrice(snapshot.k)} />
              <IndicatorBar label="KDJ D" value={fmtPrice(snapshot.d)} />
              <IndicatorBar label="KDJ J" value={fmtPrice(snapshot.j)} />
              <IndicatorBar label="RSI6" value={fmtPrice(snapshot.rsi6)} />
              <IndicatorBar label="RSI14" value={fmtPrice(snapshot.rsi14)} />
              <IndicatorBar label="BBI" value={fmtPrice(snapshot.bbi)} />
              <IndicatorBar label="布林中轨" value={fmtPrice(snapshot.bollMid)} />
              <IndicatorBar label="布林上轨" value={fmtPrice(snapshot.bollUpper)} />
              <IndicatorBar label="布林下轨" value={fmtPrice(snapshot.bollLower)} />
            </View>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">行情数据</ThemedText>
          <View style={styles.indGrid}>
            <IndicatorBar label="今开" value={fmtPrice(quote?.open)} />
            <IndicatorBar label="最高" value={fmtPrice(quote?.high)} color={theme.tint} />
            <IndicatorBar label="最低" value={fmtPrice(quote?.low)} color={theme.tint} />
            <IndicatorBar label="昨收" value={fmtPrice(quote?.prevClose)} />
            <IndicatorBar label="成交量" value={fmtVolume(quote?.volume)} />
            <IndicatorBar label="成交额" value={fmtMoney(quote?.amount)} />
            <IndicatorBar label="振幅" value={fmtPercent(quote?.amplitude)} />
            <IndicatorBar label="量比" value={fmtPrice(quote?.volumeRatio)} />
            <IndicatorBar label="换手率" value={fmtTurnover(quote?.turnover)} />
            <IndicatorBar label="市盈率" value={fmtPE(quote?.pe)} />
            <IndicatorBar label="市净率" value={fmtPrice(quote?.pb)} />
            <IndicatorBar label="总市值" value={fmtMoney(quote?.marketCap)} />
            <IndicatorBar label="流通市值" value={fmtMoney(quote?.floatCap)} />
            <IndicatorBar label="涨停价" value={fmtPrice(quote?.limitUp)} color={QuoteColors.up} />
            <IndicatorBar label="跌停价" value={fmtPrice(quote?.limitDown)} color={QuoteColors.down} />
            {latest ? (
              <IndicatorBar
                label="最新收盘"
                value={`${fmtPrice(latest.close)}  ${latest.date}`}
                color={upDownColor(latest.changePercent)}
              />
            ) : null}
          </View>
        </View>

        <ThemedText type="code" themeColor="textSecondary" style={styles.footer}>
          数据来源：东方财富 / 腾讯 / 新浪 · 仅供个人研究，不构成投资建议
        </ThemedText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  quoteBar: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  price: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  change: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  codeMeta: { fontSize: 12, marginLeft: 'auto' },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  periodBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  periodText: { fontSize: 13, fontWeight: '600' },
  dlBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  dlText: { fontSize: 13, fontWeight: '600' },
  tipBox: { marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 8 },
  indMgrRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 2 },
  indMgrBtn: { fontSize: 12, fontWeight: '600' },
  indMgrPanel: { marginHorizontal: 16, marginBottom: 6, borderRadius: 10, padding: 10, gap: 6 },
  indMgrLabel: { fontSize: 11 },
  indChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  indChipText: { fontSize: 12, fontWeight: '600' },
  chartCard: { marginHorizontal: 16, borderRadius: 14, padding: 8, justifyContent: 'center' },
  chartLoading: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  noData: { textAlign: 'center' },
  dlHint: { fontSize: 13, fontWeight: '600' },
  detailScroll: { flex: 1 },
  detailContent: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { borderRadius: 14, padding: 14, gap: 10 },
  indGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, rowGap: 14 },
  footer: { textAlign: 'center', fontSize: 10, lineHeight: 16, marginTop: 4 },
});