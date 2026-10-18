import { useRouter } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BBIPicker, CapTierPicker, ExclusionPicker, SectionTitle, SignalPicker } from '@/components/filter-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllStocks } from '@/lib/api/failover';
import { filterStocks, type KlineProvider } from '@/lib/filter-engine';
import { getFilterState, setFilter, setFilterOutput, setFilterRunning, subscribeFilter } from '@/lib/filter-store';
import { mapToProvider, multiPeriodProvider, preloadKlineMap } from '@/lib/kline-db';
import type { FilterSet, MarketCapTier, SignalCondition, Stock } from '@/types/stock';

/**
 * 筛选条件弹层（对应界面规格的 filter 页）。
 * 从全部股票页头部「筛选」按钮打开（modal）。
 * 「应用筛选」运行后：结果存 filter-store → 关闭弹层 → 跳转到「选股结果」tab。
 */
export default function FilterScreen() {
  const theme = useTheme();
  const router = useRouter();

  // 条件与全部股票页共享（filter-store）
  const storeState = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const filter = storeState.filter;
  const running = storeState.running;

  const [msg, setMsg] = useState<string | null>(null);
  const [useSignals, setUseSignals] = useState(!!filter.signals);

  const patch = useCallback((p: Partial<FilterSet>) => {
    setFilter({ ...getFilterState().filter, ...p });
  }, []);

  const num = (t: string): number | undefined => {
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : undefined;
  };

  const run = useCallback(async () => {
    setFilterRunning(true);
    setMsg(null);
    try {
      const stocks: Stock[] = await fetchAllStocks(200);
      if (stocks.length === 0) {
        setMsg('未取到行情数据，请检查网络。');
        return;
      }

      let provider: KlineProvider | undefined;
      if (useSignals) {
        const daily = await preloadKlineMap('daily', 500);
        if (filter.signals?.weeklyBBIStrategy || filter.signals?.weeklyCloseGtBBI || filter.signals?.weeklyBull || filter.signals?.weeklyBBIGtMA26) {
          const weekly = await preloadKlineMap('weekly', 200);
          provider = multiPeriodProvider(daily, weekly);
          if (weekly.size === 0) setMsg('本地还没有周线 K 线缓存，请先在个股详情页下载（含周线）。');
        } else {
          provider = mapToProvider(daily);
        }
        if (daily.size === 0 && !filter.signals?.weeklyBBIStrategy) {
          setMsg('本地还没有 K 线缓存，请先到个股详情页下载。');
        }
      }

      const out = filterStocks(stocks, filter, provider, 300);
      setFilterOutput(out);
      // 关闭弹层并跳到选股结果页
      router.back();
      router.navigate('/(tabs)/results');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '筛选失败');
    } finally {
      setFilterRunning(false);
    }
  }, [filter, useSignals, router]);

  const clearAll = () => {
    setFilter({});
    setUseSignals(false);
    setMsg(null);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      {/* 顶部：清空 / 标题 / 应用 */}
      <View style={styles.topBar}>
        <Pressable onPress={clearAll} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary">清空</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">筛选条件</ThemedText>
        <Pressable onPress={run} disabled={running} hitSlop={8}>
          {running ? (
            <ActivityIndicator size="small" />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.tint }}>应用筛选</ThemedText>
          )}
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* 排除条件 */}
        <View style={styles.block}>
          <SectionTitle hint="勾选即排除">排除条件</SectionTitle>
          <ExclusionPicker
            value={{
              excludeST: filter.excludeST,
              excludeKCB: filter.excludeKCB,
              excludeChiNext: filter.excludeChiNext,
              excludeBSE: filter.excludeBSE,
              excludeBank: filter.excludeBank,
            }}
            onChange={(v) => patch({
              excludeST: v?.excludeST,
              excludeKCB: v?.excludeKCB,
              excludeChiNext: v?.excludeChiNext,
              excludeBSE: v?.excludeBSE,
              excludeBank: v?.excludeBank,
            })}
          />
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
          <RangeInput label="市盈率(PE)" min={filter.peRange?.min} max={filter.peRange?.max}
            onMin={(v) => patch({ peRange: { ...filter.peRange, min: num(v) } })}
            onMax={(v) => patch({ peRange: { ...filter.peRange, max: num(v) } })} />
          <RangeInput label="涨跌幅(%)" min={filter.changeRange?.min} max={filter.changeRange?.max}
            onMin={(v) => patch({ changeRange: { ...filter.changeRange, min: num(v) } })}
            onMax={(v) => patch({ changeRange: { ...filter.changeRange, max: num(v) } })} />
          <RangeInput label="换手率(%)" min={filter.turnoverRange?.min} max={filter.turnoverRange?.max}
            onMin={(v) => patch({ turnoverRange: { ...filter.turnoverRange, min: num(v) } })}
            onMax={(v) => patch({ turnoverRange: { ...filter.turnoverRange, max: num(v) } })} />
          <RangeInput label="最新价(元)" min={filter.priceRange?.min} max={filter.priceRange?.max}
            onMin={(v) => patch({ priceRange: { ...filter.priceRange, min: num(v) } })}
            onMax={(v) => patch({ priceRange: { ...filter.priceRange, max: num(v) } })} />
        </View>

        {/* 技术信号 */}
        <View style={styles.block}>
          <SectionTitle hint="需本地 K 线">技术信号</SectionTitle>
          <View style={styles.switchRow}>
            <ThemedText type="small">启用技术指标条件</ThemedText>
            <Switch value={useSignals} onValueChange={(v) => { setUseSignals(v); if (!v) patch({ signals: undefined }); }} />
          </View>
          {useSignals ? (
            <View style={styles.signalsBox}>
              <SignalPicker
                value={filter.signals}
                onChange={(v: SignalCondition | undefined) => patch({ signals: v })}
              />
              <View style={styles.bbiSection}>
                <ThemedText type="smallBold" style={styles.bbiTitle}>BBI（周线/日线定向）</ThemedText>
                <BBIPicker
                  value={filter.signals}
                  onChange={(v: SignalCondition | undefined) => patch({ signals: v })}
                />
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tip}>
                提示：信号判定只对「已下载 K 线」的股票生效。周线条件需要周线缓存。
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.tip}>
              基础条件（排除 / 市值 / PE / 涨跌幅 / 换手率）不依赖 K 线，可直接筛选。
            </ThemedText>
          )}
        </View>

        {msg ? (
          <View style={[styles.msgBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">{msg}</ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 区间输入行 */
function RangeInput({ label, min, max, onMin, onMax }: {
  label: string; min?: number; max?: number;
  onMin: (t: string) => void; onMax: (t: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.rangeRow}>
      <ThemedText type="small" style={styles.rangeLabel}>{label}</ThemedText>
      <TextInput defaultValue={min !== undefined ? String(min) : ''} onChangeText={onMin}
        placeholder="最小" placeholderTextColor={theme.textSecondary} keyboardType="numeric"
        style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]} />
      <ThemedText type="small" themeColor="textSecondary">~</ThemedText>
      <TextInput defaultValue={max !== undefined ? String(max) : ''} onChangeText={onMax}
        placeholder="最大" placeholderTextColor={theme.textSecondary} keyboardType="numeric"
        style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 48, paddingTop: 8 },
  block: { paddingHorizontal: 16, marginBottom: 24 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rangeLabel: { width: 76 },
  rangeInput: { flex: 1, height: 38, borderRadius: 8, paddingHorizontal: 12, fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  signalsBox: { marginTop: 8 },
  bbiSection: { marginTop: 14, gap: 8 },
  bbiTitle: { fontSize: 13 },
  tip: { marginTop: 8, lineHeight: 20 },
  msgBox: { marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 8 },
});