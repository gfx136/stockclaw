import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CapTierPicker, SectionTitle, SignalPicker } from '@/components/filter-controls';
import { QuoteRow } from '@/components/quote-row';
import { ThemedText } from '@/components/themed-text';
import { WeeklyBBIPanel } from '@/components/weekly-bbi-panel';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllStocks } from '@/lib/eastmoney';
import { filterStocks, type FilterOutput, type KlineProvider } from '@/lib/filter-engine';
import { mapToProvider, preloadKlineMap } from '@/lib/kline-db';
import type { FilterSet, MarketCapTier, SignalCondition, Stock } from '@/types/stock';

/**
 * 选股页。对应 StockClaw 的筛选器功能。
 *
 * 基础条件（市值 / PE / 涨跌幅 / 换手率 / 价格）不需要 K 线，直接筛全市场；
 * 技术信号需要本地已缓存 K 线，由用户显式开启（预载 K 线进内存再筛）。
 */

/** 常用筛选预设 */
const PRESETS: { name: string; build: () => FilterSet }[] = [
  {
    name: '小盘活跃',
    build: () => ({ capTiers: ['small'], turnoverRange: { min: 3 }, changeRange: { min: 0 } }),
  },
  {
    name: '大盘蓝筹',
    build: () => ({ capTiers: ['large'], peRange: { min: 0, max: 30 } }),
  },
  {
    name: '低估值',
    build: () => ({ peRange: { min: 0, max: 20 }, capTiers: ['large', 'mid'] }),
  },
  {
    name: '强势上涨',
    build: () => ({ changeRange: { min: 3 }, turnoverRange: { min: 2 } }),
  },
];

export default function ScreenerScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [filter, setFilter] = useState<FilterSet>({});
  const [allStocks, setAllStocks] = useState<Stock[] | null>(null);
  const [output, setOutput] = useState<FilterOutput | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [useSignals, setUseSignals] = useState(false);

  const patch = useCallback((p: Partial<FilterSet>) => {
    setFilter((f) => ({ ...f, ...p }));
  }, []);

  const num = (t: string): number | undefined => {
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : undefined;
  };

  const run = useCallback(async () => {
    setRunning(true);
    setMsg(null);
    try {
      let stocks = allStocks;
      if (!stocks || stocks.length === 0) {
        stocks = await fetchAllStocks(200);
        setAllStocks(stocks);
      }
      if (stocks.length === 0) {
        setMsg('未取到行情数据，请检查网络。');
        setOutput(null);
        return;
      }

      let provider: KlineProvider | undefined;
      if (useSignals) {
        const map = await preloadKlineMap('daily', 500);
        provider = mapToProvider(map);
        if (map.size === 0) {
          setMsg('本地还没有 K 线缓存。请先到个股详情页下载 K 线，再使用技术指标条件。');
        }
      }

      const out = filterStocks(stocks, filter, provider, 300);
      setOutput(out);
      if (out.warning) setMsg(out.warning);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '筛选失败');
      setOutput(null);
    } finally {
      setRunning(false);
    }
  }, [allStocks, filter, useSignals]);

  const reset = () => {
    setFilter({});
    setOutput(null);
    setMsg(null);
    setUseSignals(false);
  };

  const activeCount = useMemo(() => {
    let n = 0;
    if (filter.capTiers?.length) n++;
    if (filter.peRange) n++;
    if (filter.changeRange) n++;
    if (filter.turnoverRange) n++;
    if (filter.priceRange) n++;
    if (filter.signals && Object.keys(filter.signals).length) n++;
    return n;
  }, [filter]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.title}>
          选股
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          已选 {activeCount} 个条件
        </ThemedText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        {/* 我的周线 BBI 策略 */}
        <WeeklyBBIPanel allStocks={allStocks} setAllStocks={setAllStocks} />

        {/* 预设 */}
        <View style={styles.block}>
          <SectionTitle hint="一键套用">快速预设</SectionTitle>
          <View style={styles.presetRow}>
            {PRESETS.map((p) => (
              <Pressable
                key={p.name}
                onPress={() => {
                  setFilter(p.build());
                  setOutput(null);
                  setMsg(null);
                }}
                hitSlop={4}>
                <View style={[styles.presetChip, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small">{p.name}</ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 市值分层 */}
        <View style={styles.block}>
          <SectionTitle>市值分层</SectionTitle>
          <CapTierPicker
            value={filter.capTiers}
            onChange={(v) => patch({ capTiers: v as MarketCapTier[] | undefined })}
          />
        </View>

        {/* 指标区间 */}
        <View style={styles.block}>
          <SectionTitle hint="留空表示不限">指标区间</SectionTitle>
          <RangeInput
            label="市盈率(PE)"
            min={filter.peRange?.min}
            max={filter.peRange?.max}
            onMin={(v) => patch({ peRange: { ...filter.peRange, min: num(v) } })}
            onMax={(v) => patch({ peRange: { ...filter.peRange, max: num(v) } })}
          />
          <RangeInput
            label="涨跌幅(%)"
            min={filter.changeRange?.min}
            max={filter.changeRange?.max}
            onMin={(v) => patch({ changeRange: { ...filter.changeRange, min: num(v) } })}
            onMax={(v) => patch({ changeRange: { ...filter.changeRange, max: num(v) } })}
          />
          <RangeInput
            label="换手率(%)"
            min={filter.turnoverRange?.min}
            max={filter.turnoverRange?.max}
            onMin={(v) => patch({ turnoverRange: { ...filter.turnoverRange, min: num(v) } })}
            onMax={(v) => patch({ turnoverRange: { ...filter.turnoverRange, max: num(v) } })}
          />
          <RangeInput
            label="最新价(元)"
            min={filter.priceRange?.min}
            max={filter.priceRange?.max}
            onMin={(v) => patch({ priceRange: { ...filter.priceRange, min: num(v) } })}
            onMax={(v) => patch({ priceRange: { ...filter.priceRange, max: num(v) } })}
          />
        </View>

        {/* 技术信号 */}
        <View style={styles.block}>
          <SectionTitle hint="需本地 K 线">技术信号</SectionTitle>
          <View style={styles.switchRow}>
            <ThemedText type="small">启用技术指标条件</ThemedText>
            <Switch
              value={useSignals}
              onValueChange={(v) => {
                setUseSignals(v);
                if (!v) patch({ signals: undefined });
              }}
            />
          </View>
          {useSignals ? (
            <View style={styles.signalsBox}>
              <SignalPicker
                value={filter.signals}
                onChange={(v: SignalCondition | undefined) => patch({ signals: v })}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.tip}>
                提示：信号判定只对「已下载 K 线」的股票生效，未缓存的会被跳过。
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.tip}>
              基础条件（市值 / PE / 涨跌幅 / 换手率）不依赖 K 线，可直接筛选全市场。
            </ThemedText>
          )}
        </View>

        {/* 操作 */}
        <View style={styles.actionRow}>
          <Pressable onPress={run} disabled={running} style={styles.flex}>
            <View
              style={[styles.runBtn, { backgroundColor: theme.tint, opacity: running ? 0.6 : 1 }]}>
              {running ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText type="smallBold" style={styles.runText}>
                  开始筛选
                </ThemedText>
              )}
            </View>
          </Pressable>
          <Pressable onPress={reset}>
            <View style={[styles.resetBtn, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">重置</ThemedText>
            </View>
          </Pressable>
        </View>

        {msg ? (
          <View style={[styles.msgBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {msg}
            </ThemedText>
          </View>
        ) : null}

        {output ? (
          <View style={[styles.msgBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small">
              命中 <ThemedText type="smallBold">{output.stats.matched}</ThemedText> 只（基础通过{' '}
              {output.stats.passedBase} / 全市场 {output.stats.total}
              {output.stats.skippedNoKline > 0 ? `，跳过无K线 ${output.stats.skippedNoKline}` : ''}）
            </ThemedText>
          </View>
        ) : null}

        {/* 结果 */}
        {output && output.results.length > 0
          ? output.results.map((r) => (
              <View
                key={r.stock.code}
                style={[styles.resultCard, { backgroundColor: theme.backgroundElement }]}>
                <QuoteRow
                  stock={r.stock}
                  onPress={() =>
                    router.push(
                      `/stock/${r.stock.code}?name=${encodeURIComponent(r.stock.name)}`
                    )
                  }
                />
                {r.hits.length > 0 ? (
                  <View style={styles.hitRow}>
                    {r.hits.map((h) => (
                      <View key={h} style={[styles.hitChip, { backgroundColor: theme.tint }]}>
                        <ThemedText type="small" style={styles.hitText}>
                          {h}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          : null}

        {output && output.results.length === 0 ? (
          <View style={styles.emptyBox}>
            <ThemedText type="small" themeColor="textSecondary">
              没有符合条件的股票，试试放宽条件。
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 区间输入行 */
function RangeInput({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min?: number;
  max?: number;
  onMin: (t: string) => void;
  onMax: (t: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.rangeRow}>
      <ThemedText type="small" style={styles.rangeLabel}>
        {label}
      </ThemedText>
      <TextInput
        defaultValue={min !== undefined ? String(min) : ''}
        onChangeText={onMin}
        placeholder="最小"
        placeholderTextColor={theme.textSecondary}
        keyboardType="numeric"
        style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
      />
      <ThemedText type="small" themeColor="textSecondary">
        ~
      </ThemedText>
      <TextInput
        defaultValue={max !== undefined ? String(max) : ''}
        onChangeText={onMax}
        placeholder="最大"
        placeholderTextColor={theme.textSecondary}
        keyboardType="numeric"
        style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  title: { fontSize: 28, lineHeight: 36 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 48, paddingTop: 8 },
  block: { paddingHorizontal: 16, marginBottom: 24 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rangeLabel: { width: 76 },
  rangeInput: { flex: 1, height: 38, borderRadius: 8, paddingHorizontal: 12, fontSize: 15 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  signalsBox: { marginTop: 8 },
  tip: { marginTop: 8, lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  flex: { flex: 1 },
  runBtn: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  runText: { color: '#ffffff', fontSize: 16 },
  resetBtn: {
    height: 46,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgBox: { marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 8 },
  resultCard: { marginHorizontal: 16, marginTop: 8, borderRadius: 12, overflow: 'hidden', paddingBottom: 8 },
  hitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 16, paddingTop: 4 },
  hitChip: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 4 },
  hitText: { color: '#ffffff', fontSize: 11, lineHeight: 16 },
  emptyBox: { paddingHorizontal: 16, paddingVertical: 32, alignItems: 'center' },
});