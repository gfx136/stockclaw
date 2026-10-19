import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CapTierPicker, ExclusionPicker, SectionTitle } from '@/components/filter-controls';
import { RulePicker } from '@/components/rule-picker';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllStocks } from '@/lib/api/failover';
import { loadFavorites } from '@/lib/favorites';
import { filterStocks, hasAnyRules, type KlineProvider } from '@/lib/filter-engine';
import { loadFilterSets, saveFilterSet, type SavedFilterSet } from '@/lib/filter-sets';
import { getFilterState, setFilter, setFilterOutput, setFilterRunning, subscribeFilter } from '@/lib/filter-store';
import { multiPeriodProvider, preloadKlineMap } from '@/lib/kline-db';
import type { FilterSet, KlinePeriod, MarketCapTier } from '@/types/stock';

/**
 * 选股条件面板（产品规格 2.2，底部弹出 Sheet）。
 * 基础面（区间/市值档位/缺口）+ 排除条件 + 技术指标规则（含适用周期）。
 * 运行后结果写 filter-store → 关弹层 → 跳「筛选结果」页。
 */
export default function FilterScreen() {
  const theme = useTheme();
  const router = useRouter();

  const storeState = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const filter = storeState.filter;
  const running = storeState.running;

  const [msg, setMsg] = useState<string | null>(null);
  const [savedSets, setSavedSets] = useState<SavedFilterSet[]>([]);

  useEffect(() => {
    (async () => setSavedSets(await loadFilterSets()))();
  }, []);

  const patch = useCallback((p: Partial<FilterSet>) => {
    setFilter({ ...getFilterState().filter, ...p });
  }, []);

  const num = (t: string): number | undefined => {
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : undefined;
  };

  /** 收集本次筛选需要的 K 线周期 */
  const neededPeriods = (): Set<KlinePeriod> => {
    const s = new Set<KlinePeriod>();
    if (filter.gapMin !== undefined) s.add('daily');
    for (const r of filter.rules ?? []) {
      for (const p of r.periods ?? ['daily']) s.add(p);
    }
    return s;
  };

  const run = useCallback(async () => {
    setFilterRunning(true);
    setMsg('正在筛选股票…');
    try {
      const stocks = await fetchAllStocks(200);
      if (stocks.length === 0) {
        setMsg('未取到行情数据，请检查网络。');
        return;
      }
      // 仅自选时需要自选集合
      const favCodes = filter.onlyFavorites
        ? new Set((await loadFavorites()).map((f) => f.code))
        : undefined;

      let provider: KlineProvider | undefined;
      const periods = neededPeriods();
      if (periods.size > 0) {
        const maps: Partial<Record<KlinePeriod, Awaited<ReturnType<typeof preloadKlineMap>>>> = {};
        for (const p of periods) {
          maps[p] = await preloadKlineMap(p, p === 'daily' ? 500 : 260);
        }
        provider = multiPeriodProvider(maps);
        const missing = [...periods].filter((p) => (maps[p]?.size ?? 0) === 0);
        if (missing.length > 0) {
          const label = missing.map((p) => ({ '60min': '60分钟', daily: '日线', weekly: '周线', monthly: '月线' }[p])).join('/');
          setMsg(`本地还没有${label} K 线缓存。请先到个股详情页下载对应周期。`);
        }
      }

      const out = filterStocks(stocks, filter, provider, 300, favCodes, (scanned, total) => {
        setMsg(`正在筛选股票… ${scanned}/${total}`);
      });
      setFilterOutput(out);
      router.back();
      router.navigate('/(tabs)/results');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '筛选失败');
    } finally {
      setFilterRunning(false);
    }
  }, [filter, router]);

  const clearAll = () => {
    setFilter({});
    setMsg(null);
  };

  /** 保存为常用条件 */
  const onSaveSet = () => {
    Alert.prompt?.('保存为常用条件', '输入条件名称', async (name) => {
      if (!name?.trim()) return;
      setSavedSets(await saveFilterSet(name.trim(), filter));
    }) ??
      // Android 无 Alert.prompt，用固定名
      (async () => {
        const name = `条件${savedSets.length + 1}`;
        setSavedSets(await saveFilterSet(name, filter));
      })();
  };

  const applySet = (s: SavedFilterSet) => {
    setFilter(s.filter);
    setMsg(null);
  };

  const hasKlineConds = hasAnyRules(filter) || filter.gapMin !== undefined;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      {/* 顶部：清空 / 标题 / 运行 */}
      <View style={styles.topBar}>
        <Pressable onPress={clearAll} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary">清除条件</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">筛选条件</ThemedText>
        <Pressable onPress={run} disabled={running} hitSlop={8}>
          {running ? (
            <ActivityIndicator size="small" />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.tint }}>运行筛选</ThemedText>
          )}
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* 常用条件 */}
        {savedSets.length > 0 ? (
          <View style={styles.block}>
            <SectionTitle>常用条件</SectionTitle>
            <View style={styles.chipRow}>
              {savedSets.map((s) => (
                <Pressable key={s.name} onPress={() => applySet(s)} hitSlop={4}>
                  <View style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                    <Text style={[styles.chipText, { color: theme.text }]}>{s.name}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

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

        {/* 市值档位 */}
        <View style={styles.block}>
          <SectionTitle hint="按市值排名分档">市值档位</SectionTitle>
          <CapTierPicker
            value={filter.capTiers}
            onChange={(v) => patch({ capTiers: v as MarketCapTier[] | undefined })}
          />
        </View>

        {/* 基础面区间 */}
        <View style={styles.block}>
          <SectionTitle hint="留空表示不限">行情区间</SectionTitle>
          <RangeInput label="价格(元)" min={filter.priceRange?.min} max={filter.priceRange?.max}
            onMin={(v) => patch({ priceRange: { ...filter.priceRange, min: num(v) } })}
            onMax={(v) => patch({ priceRange: { ...filter.priceRange, max: num(v) } })} />
          <RangeInput label="涨跌幅(%)" min={filter.changeRange?.min} max={filter.changeRange?.max}
            onMin={(v) => patch({ changeRange: { ...filter.changeRange, min: num(v) } })}
            onMax={(v) => patch({ changeRange: { ...filter.changeRange, max: num(v) } })} />
          <RangeInput label="换手率(%)" min={filter.turnoverRange?.min} max={filter.turnoverRange?.max}
            onMin={(v) => patch({ turnoverRange: { ...filter.turnoverRange, min: num(v) } })}
            onMax={(v) => patch({ turnoverRange: { ...filter.turnoverRange, max: num(v) } })} />
          <RangeInput label="总市值(万元)" min={filter.marketCapRange?.min !== undefined ? filter.marketCapRange.min / 1e4 : undefined} max={filter.marketCapRange?.max !== undefined ? filter.marketCapRange.max / 1e4 : undefined}
            onMin={(v) => patch({ marketCapRange: { ...filter.marketCapRange, min: num(v) ? num(v)! * 1e4 : undefined } })}
            onMax={(v) => patch({ marketCapRange: { ...filter.marketCapRange, max: num(v) ? num(v)! * 1e4 : undefined } })} />
          <RangeInput label="流通市值(万元)" min={filter.floatCapRange?.min !== undefined ? filter.floatCapRange.min / 1e4 : undefined} max={filter.floatCapRange?.max !== undefined ? filter.floatCapRange.max / 1e4 : undefined}
            onMin={(v) => patch({ floatCapRange: { ...filter.floatCapRange, min: num(v) ? num(v)! * 1e4 : undefined } })}
            onMax={(v) => patch({ floatCapRange: { ...filter.floatCapRange, max: num(v) ? num(v)! * 1e4 : undefined } })} />
          <RangeInput label="成交额(万元)" min={filter.amountRange?.min !== undefined ? filter.amountRange.min / 1e4 : undefined} max={filter.amountRange?.max !== undefined ? filter.amountRange.max / 1e4 : undefined}
            onMin={(v) => patch({ amountRange: { ...filter.amountRange, min: num(v) ? num(v)! * 1e4 : undefined } })}
            onMax={(v) => patch({ amountRange: { ...filter.amountRange, max: num(v) ? num(v)! * 1e4 : undefined } })} />
          <RangeInput label="跳空缺口≥(%)" min={filter.gapMin}
            onMin={(v) => patch({ gapMin: num(v) })}
            onMax={() => {}} single />
          {/* 仅自选 */}
          <View style={styles.switchRow}>
            <ThemedText type="small" style={styles.switchLabel}>仅看自选</ThemedText>
            <Switch
              value={filter.onlyFavorites ?? false}
              onValueChange={(v) => patch({ onlyFavorites: v || undefined })}
            />
          </View>
        </View>

        {/* 技术指标 */}
        <View style={styles.block}>
          <SectionTitle hint="AND 组合，可指定周期">技术指标</SectionTitle>
          <RulePicker
            rules={filter.rules ?? []}
            onChange={(rules) => patch({ rules: rules.length > 0 ? rules : undefined })}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.tip}>
            技术指标判定依赖本地已下载的 K 线；周期上无数据的股票会被跳过并计数。
          </ThemedText>
        </View>

        {/* 保存条件 */}
        <View style={styles.block}>
          <Pressable onPress={onSaveSet}>
            <View style={[styles.saveBtn, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.saveBtnText, { color: theme.tint }]}>保存为常用条件</Text>
            </View>
          </Pressable>
        </View>

        {msg ? (
          <View style={[styles.msgBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">{msg}</ThemedText>
          </View>
        ) : null}

        {hasKlineConds ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.klineNote}>
            含技术指标条件，将对已下载 K 线的股票判定。
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 区间输入行（single=只有最小值） */
function RangeInput({ label, min, max, onMin, onMax, single }: {
  label: string; min?: number; max?: number;
  onMin: (t: string) => void; onMax: (t: string) => void; single?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.rangeRow}>
      <ThemedText type="small" style={styles.rangeLabel}>{label}</ThemedText>
      <TextInput defaultValue={min !== undefined ? String(min) : ''} onChangeText={onMin}
        placeholder="最小" placeholderTextColor={theme.textSecondary} keyboardType="numeric"
        style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]} />
      {!single ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">~</ThemedText>
          <TextInput defaultValue={max !== undefined ? String(max) : ''} onChangeText={onMax}
            placeholder="最大" placeholderTextColor={theme.textSecondary} keyboardType="numeric"
            style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]} />
        </>
      ) : null}
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
  block: { paddingHorizontal: 16, marginBottom: 22 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  chipText: { fontSize: 13 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rangeLabel: { width: 96 },
  rangeInput: { flex: 1, height: 44, borderRadius: 8, paddingHorizontal: 12, fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: {},
  tip: { marginTop: 8, lineHeight: 20 },
  saveBtn: { height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 14, fontWeight: '600' },
  msgBox: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 8 },
  klineNote: { paddingHorizontal: 16, lineHeight: 18 },
});