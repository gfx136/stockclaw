import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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

/** 展示的 K 线根数 */
const BAR_COUNT = 120;

export default function StockDetailScreen() {
  const { code, name } = useLocalSearchParams<{ code: string; name?: string }>();
  const theme = useTheme();
  const { width: winW } = useWindowDimensions();

  const [quote, setQuote] = useState<Partial<Stock> | null>(null);
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  const [bars, setBars] = useState<KlineBar[]>([]);
  const [series, setSeries] = useState<IndicatorSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [fav, setFav] = useState(false);
  const [tip, setTip] = useState<string | null>(null);

  const stockName = name ? decodeURIComponent(name) : (code ?? '');

  /** 图表宽度：窗口宽 - 页面左右 padding - 卡片内 padding */
  const chartW = Math.min(winW, 800) - 16 * 2 - 12 * 2;

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

  /** 下载三周期 K 线 */
  const onDownload = useCallback(async () => {
    if (!code) return;
    setDownloading(true);
    setTip(null);
    try {
      const results = await downloadAllPeriods(code, 500);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount === 0) {
        setTip(`下载失败：${results.find((r) => !r.ok)?.error ?? '未知错误'}`);
      } else {
        setTip(`已下载 ${okCount}/${results.length} 个周期`);
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
            <Pressable onPress={handleToggleFav} hitSlop={10}>
              <Text style={{ fontSize: 20, color: fav ? theme.tint : theme.text }}>
                {fav ? '★' : '☆'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {/* 行情卡 */}
        <View style={[styles.quoteCard, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.quoteTop}>
            <Text style={[styles.price, { color: changeColor }]}>
              {fmtPrice(quote?.price)}
            </Text>
            <View style={styles.quoteChangeCol}>
              <Text style={[styles.change, { color: changeColor }]}>
                {fmtChange(quote?.changeAmount)}
              </Text>
              <Text style={[styles.change, { color: changeColor }]}>
                {fmtPercent(quote?.changePercent)}
              </Text>
            </View>
          </View>
          <View style={styles.quoteMeta}>
            <Meta label="代码" value={`${code} · ${marketName(code ?? '')}`} theme={theme} />
            <Meta label="换手率" value={fmtTurnover(quote?.turnover)} theme={theme} />
            <Meta label="市盈率" value={fmtPE(quote?.pe)} theme={theme} />
            <Meta label="总市值" value={fmtMoney(quote?.marketCap)} theme={theme} />
          </View>
        </View>

        {/* 下载按钮 */}
        <Pressable onPress={onDownload} disabled={downloading}>
          <View
            style={[
              styles.downloadBtn,
              { backgroundColor: theme.backgroundElement, opacity: downloading ? 0.6 : 1 },
            ]}>
            {downloading ? (
              <ActivityIndicator size="small" />
            ) : (
              <ThemedText type="smallBold">下载/更新 K 线（日/周/月）</ThemedText>
            )}
          </View>
        </Pressable>

        {tip ? (
          <View style={[styles.tipBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {tip}
            </ThemedText>
          </View>
        ) : null}

        {/* 周期切换 */}
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
                style={[
                  styles.periodText,
                  { color: period === p.key ? theme.background : theme.text },
                ]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
          {bars.length > 0 ? (
            <ThemedText type="code" themeColor="textSecondary" style={styles.barCount}>
              {bars.length} 根
            </ThemedText>
          ) : null}
        </View>

        {/* K 线图（自绘 SVG，含均线叠加与成交量） */}
        <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement }]}>
          {loading && bars.length === 0 ? (
            <View style={styles.chartLoading}>
              <ActivityIndicator />
            </View>
          ) : bars.length === 0 ? (
            <View style={styles.chartLoading}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.noData}>
                本地暂无 {PERIODS.find((p) => p.key === period)?.label} 数据
              </ThemedText>
              <ThemedText type="code" themeColor="textSecondary" style={styles.noDataHint}>
                点上方按钮从东方财富拉取
              </ThemedText>
            </View>
          ) : (
            <InteractiveKline
              bars={bars}
              width={chartW}
              height={280}
              series={series ?? undefined}
              maOverlay={[5, 10, 20]}
              defaultVisible={100}
              gridColor={theme.border}
              axisColor={theme.textSecondary}
              textColor={theme.text}
            />
          )}
        </View>

        {/* 均线图例 */}
        {series ? <MALegend periods={[5, 10, 20, 60]} series={series} /> : null}

        {/* 技术指标 */}
        {snapshot ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">技术指标</ThemedText>
            <View style={styles.indGrid}>
              <IndicatorBar
                label="MACD DIF"
                value={fmtPrice(snapshot.dif)}
                color={upDownColor(snapshot.dif)}
              />
              <IndicatorBar
                label="MACD DEA"
                value={fmtPrice(snapshot.dea)}
                color={upDownColor(snapshot.dea)}
              />
              <IndicatorBar
                label="MACD 柱"
                value={fmtPrice(snapshot.macdHist)}
                color={upDownColor(snapshot.macdHist)}
              />
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

        {/* 行情明细 */}
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
            <IndicatorBar label="市净率" value={fmtPrice(quote?.pb)} />
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
          数据来源：东方财富公开行情接口 · 仅供个人研究，不构成投资建议
        </ThemedText>
      </ScrollView>
    </View>
  );
}

function Meta({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.metaItem}>
      <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14 },
  quoteCard: { borderRadius: 14, padding: 16, gap: 12 },
  quoteTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  price: { fontSize: 36, fontWeight: '600', fontVariant: ['tabular-nums'] },
  quoteChangeCol: { gap: 2 },
  change: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  quoteMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, rowGap: 10 },
  metaItem: { gap: 2, minWidth: 70 },
  metaLabel: { fontSize: 11 },
  metaValue: { fontSize: 14, fontWeight: '500' },
  downloadBtn: { height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tipBox: { padding: 12, borderRadius: 8 },
  periodRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  periodBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  periodText: { fontSize: 13, fontWeight: '600' },
  barCount: { fontSize: 10, minWidth: 42, textAlign: 'right' },
  chartCard: { borderRadius: 14, padding: 12, minHeight: 260, justifyContent: 'center' },
  chartLoading: { height: 256, alignItems: 'center', justifyContent: 'center', gap: 6 },
  noData: { textAlign: 'center' },
  noDataHint: { fontSize: 10 },
  card: { borderRadius: 14, padding: 14, gap: 10 },
  indGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, rowGap: 14 },
  footer: { textAlign: 'center', fontSize: 10, lineHeight: 16, marginTop: 4 },
});