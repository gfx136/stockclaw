import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  FlatList,
  Modal,
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
import { setDetailList } from '@/lib/detail-nav';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import { getFilterState, setFilter, subscribeFilter } from '@/lib/filter-store';
import { isSnapshotFresh, loadListSnapshot } from '@/lib/list-cache';
import { getHomeSort, setHomeSort, type HomeSortKey } from '@/lib/prefs';
import { buildPinyinMap } from '@/lib/pinyin-search';
import type { Stock } from '@/types/stock';

/**
 * 全部股票页（补充规格 §1）。
 * 5 区块纵向结构：顶栏(标题+搜索) → 工具行(筛选/排序/刷新) → 列表表头 → 列表 → 安全区。
 * 通栏行，无卡片。长按 0.5s 加自选（触觉+提示）；排序下拉菜单（持久化）；刷新行情旋转动画+轻提示。
 */

/** 排序选项（规格 §1.4，固定 6 项，无名称排序；除代码外均降序） */
const SORT_OPTIONS: { key: HomeSortKey; label: string; desc: boolean }[] = [
  { key: 'code', label: '代码升序', desc: false },
  { key: 'price', label: '价格降序', desc: true },
  { key: 'changePercent', label: '涨幅降序', desc: true },
  { key: 'amount', label: '成交额降序', desc: true },
  { key: 'turnover', label: '换手率降序', desc: true },
  { key: 'marketCap', label: '市值降序', desc: true },
];

const TABLE_HEADER = ['代码', '名称', '最新价', '涨跌幅', '成交额'];
const COL_FLEX = [22, 26, 16, 16, 20];

export default function AllStocksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const online = useOnline();

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<HomeSortKey>('code');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [snapshotStale, setSnapshotStale] = useState(false);

  const listRef = useRef<FlatList>(null);
  const spin = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filterState = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const filter = filterState.filter;

  // 已启用筛选条件数（角标）
  const activeCondCount = useMemo(() => {
    let n = 0;
    if (filter.capTiers?.length) n++;
    if (filter.priceRange?.min !== undefined || filter.priceRange?.max !== undefined) n++;
    if (filter.changeRange?.min !== undefined || filter.changeRange?.max !== undefined) n++;
    if (filter.turnoverRange?.min !== undefined || filter.turnoverRange?.max !== undefined) n++;
    if (filter.marketCapRange?.min !== undefined || filter.marketCapRange?.max !== undefined) n++;
    if (filter.gapMin !== undefined) n++;
    if (filter.rules?.length) n += filter.rules.length;
    if (filter.excludeST || filter.excludeKCB || filter.excludeChiNext || filter.excludeBSE || filter.excludeBank) n++;
    return n;
  }, [filter]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  const load = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const list = await fetchAllStocks(200);
      if (list.length === 0) {
        if (!silent) setError('请检查网络连接后点「重试」');
        return;
      }
      setStocks(list);
      setLastLoadedAt(Date.now());
      setError(null);
      if (isRefresh) {
        const t = new Date();
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');
        showToast(`已刷新 · ${hh}:${mm}:${ss}`);
      }
    } catch {
      if (!silent) setError('请检查网络连接后点「重试」');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  /**
   * 启动流程（问题1修复）：
   * ① 立刻读本地快照 → 首屏秒显（无网络也能看）
   * ② 再后台静默拉网络 → 回来后覆盖
   * 这样双击图标到看到列表几乎是瞬时的，不再"加载好久"。
   */
  useEffect(() => {
    (async () => {
      // ① 快照优先
      const snap = await loadListSnapshot();
      if (snap) {
        setStocks(snap.list);
        setLastLoadedAt(snap.at);
        setLoading(false);
        setSnapshotStale(!isSnapshotFresh(snap.at));
      }
      // ② 收藏与排序偏好
      setFavSet(new Set((await loadFavorites()).map((f) => f.code)));
      setSortKey(await getHomeSort());
      // ③ 后台静默刷新（有快照时不显示加载态，无快照时才显示骨架屏）
      load(false, !!snap);
    })();
  }, [load]);

  const pyMap = useMemo(() => buildPinyinMap(stocks), [stocks]);

  // 刷新行情（旋转动画 + 超时）
  const onRefresh = useCallback(() => {
    spin.setValue(0);
    spinLoop.current = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, useNativeDriver: true })
    );
    spinLoop.current.start();
    load(true).finally(() => {
      spinLoop.current?.stop();
      spin.setValue(0);
    });
  }, [load, spin]);

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const applyFav = useCallback(async (s: Stock) => {
    const nowFav = await toggleFavorite(s.code, s.name);
    setFavSet((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(s.code);
      else next.delete(s.code);
      return next;
    });
    return nowFav;
  }, []);

  const handleToggleFav = useCallback((s: Stock) => { applyFav(s); }, [applyFav]);

  // 长按 0.5s 加/取消自选（触觉 + 提示）
  const handleLongPress = useCallback(async (s: Stock) => {
    const nowFav = await applyFav(s);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showToast(nowFav ? '已加入自选' : '取消自选');
  }, [applyFav, showToast]);

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

  /** 搜索 + 排除 + 排序（纯本地内存排序，不请求网络） */
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
    const opt = SORT_OPTIONS.find((o) => o.key === sortKey)!;
    const dir = opt.desc ? -1 : 1;
    return [...list].sort((a, b) => {
      if (sortKey === 'code') return a.code.localeCompare(b.code) * dir;
      const av = (a[sortKey] ?? Number.NEGATIVE_INFINITY) as number;
      const bv = (b[sortKey] ?? Number.NEGATIVE_INFINITY) as number;
      return (av - bv) * dir;
    });
  }, [stocks, query, sortKey, applyExclusions, pyMap]);

  const onSelectSort = useCallback((key: HomeSortKey) => {
    setSortKey(key);
    setHomeSort(key);
    setSortMenuOpen(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const openDetail = useCallback(
    (s: Stock) => {
      // 存入当前列表（详情页上一只/下一只按此顺序循环，规格 §2.5）
      setDetailList(view.map((x) => ({ code: x.code, name: x.name })));
      router.push(`/stock/${s.code}?name=${encodeURIComponent(s.name)}`);
    },
    [router, view]
  );

  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortKey)!.label.replace(/序$/, '');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* ① 顶栏：标题 + 搜索框 */}
      <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
        <ThemedText type="subtitle" style={styles.title}>全部股票</ThemedText>
        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.searchIcon, { color: theme.textSecondary }]}>🔍</Text>
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="搜索名称/代码，如 浦发银行 600000"
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="清空搜索">
              <Text style={[styles.clearIcon, { color: theme.textSecondary }]}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ② 工具行：筛选条件 / 排序 / 刷新行情 */}
      <View style={[styles.toolBar, { borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.push('/filter')} hitSlop={6}>
          <View style={[styles.filterBtn, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.filterBtnText, { color: theme.text }]}>⧩ 筛选条件{activeCondCount > 0 ? ` · ${activeCondCount}` : ''}</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setSortMenuOpen(true)} hitSlop={6} style={styles.sortBtn}>
          <Text style={[styles.sortText, { color: theme.text }]}>排序 · {sortLabel} ▾</Text>
        </Pressable>
        <View style={styles.flex1} />
        <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8} accessibilityLabel="刷新行情">
          <Animated.Text style={[styles.refreshIcon, { color: theme.text, transform: [{ rotate: spinDeg }] }]}>
            ⟳
          </Animated.Text>
        </Pressable>
      </View>

      {/* 离线横幅 */}
      {!online || snapshotStale ? (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.bannerText, { color: theme.textSecondary }]}>
            {!online ? '离线' : '本地缓存'} · 数据截至 {lastLoadedAt ? new Date(lastLoadedAt).toISOString().slice(0, 10) : '—'}
          </Text>
        </View>
      ) : null}

      {/* 失败常驻条（有数据时原位提示） */}
      {error && stocks.length > 0 ? (
        <Pressable onPress={() => load(true)}>
          <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.bannerText, { color: theme.textSecondary }]}>{error}</Text>
          </View>
        </Pressable>
      ) : null}

      {/* 顶部轻提示 Toast */}
      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={[styles.toast, { backgroundColor: theme.text }]}>
            <Text style={[styles.toastText, { color: theme.background }]}>{toast}</Text>
          </View>
        </View>
      ) : null}

      {/* ③ 列表表头 */}
      <View style={[styles.tableHeader, { borderBottomColor: theme.border }]}>
        {TABLE_HEADER.map((h, i) => (
          <View key={h} style={[styles.thCol, { flex: COL_FLEX[i] }, i >= 2 && styles.thRight]}>
            <Text style={[styles.thText, { color: theme.textSecondary }]} numberOfLines={1}>{h}</Text>
          </View>
        ))}
        <View style={styles.thStar} />
      </View>

      {/* ④ 股票列表 */}
      {loading && stocks.length === 0 ? (
        <View>{Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} theme={theme} />)}</View>
      ) : error && stocks.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.errIcon, { color: theme.textSecondary }]}>⚠</Text>
          <ThemedText type="small" themeColor="textSecondary" style={styles.errText}>{error}</ThemedText>
          <Pressable onPress={() => load()}>
            <View style={[styles.retryBtn, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">重试</ThemedText>
            </View>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={view}
          keyExtractor={(item) => item.code}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
              onLongPress={handleLongPress}
            />
          )}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.border }]} />}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>暂无数据</ThemedText>
          }
        />
      )}

      {/* 排序下拉菜单 */}
      <Modal visible={sortMenuOpen} transparent animationType="fade" onRequestClose={() => setSortMenuOpen(false)}>
        <Pressable style={styles.menuMask} onPress={() => setSortMenuOpen(false)}>
          <View style={[styles.menu, { backgroundColor: theme.backgroundElement }]}>
            {SORT_OPTIONS.map((o) => {
              const active = o.key === sortKey;
              return (
                <Pressable key={o.key} onPress={() => onSelectSort(o.key)}>
                  <View style={styles.menuItem}>
                    <Text style={[styles.menuItemText, { color: active ? theme.tint : theme.text, fontWeight: active ? '700' : '400' }]}>
                      {o.label}
                    </Text>
                    {active ? <Text style={{ color: theme.tint }}>✓</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/** 骨架行（规格 §1.8：12 行占位，5 列与实体列宽一致，避免加载完成瞬间跳变） */
function SkeletonRow({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const bar = (flex: number, w: number | string, h: number) => (
    <View style={[styles.skCol, { flex }]}>
      <View style={[styles.skeleton, { width: w as number, height: h, backgroundColor: theme.backgroundElement }]} />
    </View>
  );
  return (
    <View style={styles.skeletonRow}>
      {bar(22, 52, 13)}
      {bar(26, 64, 15)}
      <View style={[styles.skCol, styles.skRight, { flex: 16 }]}>
        <View style={[styles.skeleton, { width: 44, height: 17, backgroundColor: theme.backgroundElement }]} />
      </View>
      <View style={[styles.skCol, styles.skRight, { flex: 16 }]}>
        <View style={[styles.skeleton, { width: 40, height: 12, backgroundColor: theme.backgroundElement }]} />
      </View>
      <View style={[styles.skCol, styles.skRight, { flex: 20 }]}>
        <View style={[styles.skeleton, { width: 44, height: 12, backgroundColor: theme.backgroundElement }]} />
      </View>
      <View style={styles.thStar} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  topBar: {
    height: 56, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22 },
  searchBox: { flex: 1, height: 36, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  searchIcon: { fontSize: 12, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  clearIcon: { fontSize: 14, paddingLeft: 6 },
  toolBar: {
    height: 44, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterBtn: { height: 32, borderRadius: 16, paddingHorizontal: 14, justifyContent: 'center' },
  filterBtnText: { fontSize: 14 },
  sortBtn: { paddingVertical: 4 },
  sortText: { fontSize: 14 },
  refreshIcon: { fontSize: 20 },
  banner: { marginHorizontal: 16, marginTop: 6, borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
  bannerText: { fontSize: 12 },
  tableHeader: {
    height: 28, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thCol: { justifyContent: 'center' },
  thRight: { alignItems: 'flex-end' },
  thText: { fontSize: 12 },
  thStar: { width: 32, marginLeft: 12 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: 'center', marginTop: 40 },
  errIcon: { fontSize: 44 },
  errText: { textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: { height: 40, borderRadius: 20, paddingHorizontal: 24, justifyContent: 'center' },
  toastWrap: { position: 'absolute', top: 100, left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  toast: { height: 36, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  toastText: { fontSize: 13, fontWeight: '500' },
  skeletonRow: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  skCol: { justifyContent: 'center' },
  skRight: { alignItems: 'flex-end' },
  skeleton: { borderRadius: 4 },
  menuMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-start', alignItems: 'flex-end' },
  menu: { marginTop: 100, marginRight: 16, borderRadius: 12, paddingVertical: 6, minWidth: 180, elevation: 8 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  menuItemText: { fontSize: 15 },
});