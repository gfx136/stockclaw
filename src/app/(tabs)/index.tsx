import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuoteRow } from '@/components/quote-row';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllStocks } from '@/lib/eastmoney';
import { toggleFavorite } from '@/lib/favorites';
import { upDownColor } from '@/lib/format';
import type { Stock } from '@/types/stock';

/**
 * 所有股票页（行情主页）。对应 StockClaw 的主页。
 * - 拉东财全量 A 股列表（分页）
 * - 支持关键字搜索、多维度排序
 * - 点行进详情，长按加/取消收藏
 */

type SortKey = 'changePercent' | 'turnover' | 'amount' | 'marketCap' | 'price' | 'pe';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'changePercent', label: '涨跌幅' },
  { key: 'turnover', label: '换手率' },
  { key: 'amount', label: '成交额' },
  { key: 'marketCap', label: '市值' },
  { key: 'price', label: '价格' },
];

export default function AllStocksScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('changePercent');
  const [desc, setDesc] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const list = await fetchAllStocks(200);
      if (!mounted.current) return;
      setStocks(list);
      if (list.length === 0) setError('未取到行情数据，请检查网络或稍后重试。');
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 搜索 + 排序 */
  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = stocks;
    if (q) {
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
      );
    }
    const dir = desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const av = (a[sortKey] ?? Number.NEGATIVE_INFINITY) as number;
      const bv = (b[sortKey] ?? Number.NEGATIVE_INFINITY) as number;
      return (av - bv) * dir;
    });
  }, [stocks, query, sortKey, desc]);

  const upCount = useMemo(() => stocks.filter((s) => s.changePercent > 0).length, [stocks]);
  const downCount = useMemo(() => stocks.filter((s) => s.changePercent < 0).length, [stocks]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setDesc((d) => !d);
      else {
        setSortKey(key);
        setDesc(true);
      }
    },
    [sortKey]
  );

  const handleLongPress = useCallback(async (stock: Stock) => {
    const nowFav = await toggleFavorite(stock.code, stock.name);
    Alert.alert(nowFav ? '已收藏' : '已取消收藏', `${stock.name} (${stock.code})`);
  }, []);

  const openDetail = useCallback(
    (s: Stock) => {
      router.push(`/stock/${s.code}?name=${encodeURIComponent(s.name)}`);
    },
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
      {/* 搜索框 */}
      <View style={styles.searchWrap}>
        <TextInput
          style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          placeholder="搜索名称/代码，如 600000"
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* 涨跌统计 */}
      {stocks.length > 0 ? (
        <View style={styles.statsRow}>
          <ThemedText type="small" style={{ color: upDownColor(1) }}>
            涨 {upCount}
          </ThemedText>
          <ThemedText type="small" style={{ color: upDownColor(-1) }}>
            跌 {downCount}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            平 {stocks.length - upCount - downCount}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary" style={styles.countRight}>
            {view.length} / {stocks.length} 只 · 长按加收藏
          </ThemedText>
        </View>
      ) : null}

      {/* 排序条 */}
      <View style={styles.sortBar}>
        {SORTS.map((s) => {
          const active = s.key === sortKey;
          return (
            <Pressable key={s.key} onPress={() => handleSort(s.key)} hitSlop={4}>
              <View
                style={[styles.sortChip, active && { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText
                  type={active ? 'smallBold' : 'small'}
                  themeColor={active ? 'text' : 'textSecondary'}>
                  {s.label}
                  {active ? (desc ? ' ↓' : ' ↑') : ''}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
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
            <View style={styles.rowWrap}>
              <QuoteRow stock={item} onPress={openDetail} />
              {/* 长按区域：覆盖整行以支持收藏 */}
              <Pressable
                onLongPress={() => handleLongPress(item)}
                delayLongPress={350}
                style={StyleSheet.absoluteFill}
                pointerEvents="box-only"
              />
            </View>
          )}
          ItemSeparatorComponent={() => (
            <View style={[styles.sep, { backgroundColor: theme.border }]} />
          )}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {query ? '无匹配结果' : '暂无数据'}
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
  searchWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  search: { height: 40, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  countRight: { marginLeft: 'auto', fontSize: 11 },
  sortBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  sortChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  rowWrap: { position: 'relative' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: 'center', marginTop: 40 },
  errText: { textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 8, borderRadius: 12 },
});