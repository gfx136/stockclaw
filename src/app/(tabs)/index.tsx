import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StockTile } from '@/components/stock-tile';
import { ExclusionPicker } from '@/components/filter-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useOnline } from '@/hooks/use-online';
import { fetchAllStocks } from '@/lib/api/failover';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import { getFilterState, setFilter, subscribeFilter } from '@/lib/filter-store';
import { buildPinyinMap } from '@/lib/pinyin-search';
import type { Stock } from '@/types/stock';

/**
 * 全部股票页（产品规格 2.1）。
 * - 搜索：代码精确 / 名称全字 / 拼音首字母
 * - 排序栏：代码/名称/最新价/涨跌幅/换手率/总市值，默认代码升序，点击切换方向
 * - 行：StockTile（含星标切换自选）
 * - 头部：刷新 / 筛选（打开选股条件面板）
 */

type SortKey = 'code' | 'name' | 'price' | 'changePercent' | 'turnover' | 'marketCap';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'code', label: '代码' },
  { key: 'name', label: '名称' },
  { key: 'price', label: '最新价' },
  { key: 'changePercent', label: '涨跌幅' },
  { key: 'turnover', label: '换手率' },
  { key: 'marketCap', label: '总市值' },
];

export default function AllStocksScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [desc, setDesc] = useState(false); // 默认代码升序
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const online = useOnline();

  // 快捷排除（与筛选器共享 filter-store）
  const filterState = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const filter = filterState.filter;

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const list = await fetchAllStocks(200);
      setStocks(list);
      setLastLoadedAt(Date.now());
      if (list.length === 0) setError('未取到行情数据，请检查网络或稍后重试。');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const favs = await loadFavorites();
      setFavSet(new Set(favs.map((f) => f.code)));
    })();
  }, [load]);

  // 拼音首字母映射（一次性预算，搜索时直接查表）
  const pyMap = useMemo(() => buildPinyinMap(stocks), [stocks]);

  const handleToggleFav = useCallback(async (s: Stock) => {
    const nowFav = await toggleFavorite(s.code, s.name);
    setFavSet((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(s.code);
      else next.delete(s.code);
      return next;
    });
  }, []);

  /** 快捷排除过滤 */
  const applyExclusions = useCallback(
    (list: Stock[]): Stock[] =>
      list.filter((s) => {
        const code = s.code.replace(/\D/g, '');
        if (filter.excludeST && s.name.includes('ST')) return false;
        if (filter.excludeBank && s.name.includes('银行')) return false;
        if (filter.excludeKCB && (code.startsWith('688') || code.startsWith('689'))) return false;
        if (filter.excludeChiNext && code.startsWith('30')) return false;
        if (
          filter.excludeBSE &&
          (code.startsWith('43') || code.startsWith('82') || code.startsWith('83') ||
            code.startsWith('87') || code.startsWith('8'))
        ) {
          return false;
        }
        return true;
      }),
    [filter]
  );

  /** 搜索 + 排除 + 排序 */
  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = applyExclusions(stocks);
    if (q) {
      list = list.filter((s) => {
        if (s.code.toLowerCase().includes(q)) return true;
        if (s.name.toLowerCase().includes(q)) return true;
        return (pyMap.get(s.code) ?? '').includes(q);
      });
    }
    const dir = desc ? -1 : 1;
    return [...list].sort((a, b) => {
      if (sortKey === 'code') return a.code.localeCompare(b.code) * dir;
      if (sortKey === 'name') {
        const pa = pyMap.get(a.code) ?? a.name;
        const pb = pyMap.get(b.code) ?? b.name;
        return pa.localeCompare(pb) * dir;
      }
      const av = (a[sortKey] ?? Number.NEGATIVE_INFINITY) as number;
      const bv = (b[sortKey] ?? Number.NEGATIVE_INFINITY) as number;
      return (av - bv) * dir;
    });
  }, [stocks, query, sortKey, desc, applyExclusions, pyMap]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setDesc((d) => !d);
      else {
        setSortKey(key);
        // 代码/名称默认升序，数值默认降序
        setDesc(key === 'code' || key === 'name' ? false : true);
      }
    },
    [sortKey]
  );

  const openDetail = useCallback(
    (s: Stock) => router.push(`/stock/${s.code}?name=${encodeURIComponent(s.name)}`),
    [router]
  );

  if (loading && stocks.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" />
        <ThemedText type="small" themeColor="textSecondary" style={styles.loadingText}>
          正在拉取 A 股列表…
        </ThemedText>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* 头部：标题 + 操作 */}
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.headerTitle}>全部股票</ThemedText>
        <View style={styles.headerActions}>
          <Pressable onPress={() => load(true)} hitSlop={8} style={styles.headerBtn}>
            <ThemedText type="small">⟳</ThemedText>
          </Pressable>
          <Pressable onPress={() => router.push('/filter')} hitSlop={8} style={styles.headerBtn}>
            <ThemedText type="small" style={{ color: theme.tint }}>筛选</ThemedText>
          </Pressable>
        </View>
      </View>

      {/* 搜索框 */}
      <View style={styles.searchWrap}>
        <TextInput
          style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          placeholder="搜索代码 / 名称 / 拼音"
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* 离线横幅 */}
      {!online ? (
        <View style={[styles.offlineBanner, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.offlineText, { color: theme.textSecondary }]}>
            离线 · 数据截至 {lastLoadedAt ? new Date(lastLoadedAt).toISOString().slice(0, 10) : '—'}
          </Text>
        </View>
      ) : null}

      {/* 快捷排除 */}
      <View style={styles.excludeWrap}>
        <ExclusionPicker
          value={{
            excludeST: filter.excludeST,
            excludeKCB: filter.excludeKCB,
            excludeChiNext: filter.excludeChiNext,
            excludeBSE: filter.excludeBSE,
            excludeBank: filter.excludeBank,
          }}
          onChange={(v) =>
            setFilter({
              ...filter,
              excludeST: v?.excludeST,
              excludeKCB: v?.excludeKCB,
              excludeChiNext: v?.excludeChiNext,
              excludeBSE: v?.excludeBSE,
              excludeBank: v?.excludeBank,
            })
          }
        />
      </View>

      {/* 排序栏 */}
      <View style={styles.sortBar}>
        <ThemedText type="small" themeColor="textSecondary">共 {view.length} 只</ThemedText>
        <View style={styles.sortChips}>
          {SORTS.map((s) => {
            const active = s.key === sortKey;
            return (
              <Pressable key={s.key} onPress={() => handleSort(s.key)} hitSlop={4}>
                <Text
                  style={[
                    styles.sortChip,
                    { color: active ? theme.tint : theme.textSecondary, fontWeight: active ? '700' : '400' },
                  ]}>
                  {s.label}
                  {active ? (desc ? '↓' : '↑') : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error && stocks.length === 0 ? (
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.errText}>
            {error}
          </ThemedText>
          <Pressable onPress={() => load()}>
            <View style={[styles.retryBtn, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">重试</ThemedText>
            </View>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={view}
          keyExtractor={(item) => item.code}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          removeClippedSubviews
          renderItem={({ item }) => (
            <StockTile
              stock={item}
              isFav={favSet.has(item.code)}
              onPress={openDetail}
              onToggleFav={handleToggleFav}
            />
          )}
          ItemSeparatorComponent={() => (
            <View style={[styles.sep, { backgroundColor: theme.border }]} />
          )}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              暂无数据
            </ThemedText>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { marginTop: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4,
  },
  headerTitle: { fontSize: 22 },
  headerActions: { flexDirection: 'row', gap: 16 },
  headerBtn: { padding: 4 },
  excludeWrap: { paddingHorizontal: 16, paddingBottom: 4 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  search: { height: 40, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  offlineBanner: { marginHorizontal: 16, marginBottom: 6, borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
  offlineText: { fontSize: 12 },
  sortBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 6,
  },
  sortChips: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  sortChip: { fontSize: 12 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: 'center', marginTop: 40 },
  errText: { textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 8, borderRadius: 12 },
});