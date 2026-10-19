import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StockTile } from '@/components/stock-tile';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllStocks } from '@/lib/api/failover';
import { setDetailList } from '@/lib/detail-nav';
import { loadFavorites, removeFavorite, toggleFavorite } from '@/lib/favorites';
import type { FavoriteItem, Stock } from '@/types/stock';

/**
 * 自选页（产品规格 2.4）。
 * 行结构与全部股票一致，行内星标可移除自选；长按删除（二次确认）。
 * 收藏只存 code+name，进页面再拉实时行情拼上价格。
 */
export default function FavoritesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Stock>>({});
  const [loading, setLoading] = useState(false);

  // 每次进入都重新读，保证和列表页的星标状态同步
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const list = await loadFavorites();
        if (!active) return;
        setFavorites(list);
        if (list.length > 0) {
          setLoading(true);
          try {
            const all = await fetchAllStocks(200);
            if (!active) return;
            const map: Record<string, Stock> = {};
            for (const s of all) map[s.code] = s;
            setQuotes(map);
          } catch {
            /* 行情失败时仍展示自选（价格显示为 —） */
          } finally {
            if (active) setLoading(false);
          }
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  /** 点星标 = 移除自选 */
  const handleToggleFav = useCallback(async (s: Stock) => {
    await toggleFavorite(s.code, s.name);
    setFavorites(await loadFavorites());
  }, []);

  /** 长按删除（二次确认） */
  const handleLongPress = useCallback((s: Stock) => {
    Alert.alert('移除自选', `确定移除 ${s.name}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: async () => {
          await removeFavorite(s.code);
          setFavorites(await loadFavorites());
        },
      },
    ]);
  }, []);

  /** 组装：有行情用行情，没有则用自选中的名字兜底 */
  const data: Stock[] = favorites.map(
    (f) => quotes[f.code] ?? { code: f.code, name: f.name, price: 0, changePercent: 0 }
  );

  if (favorites.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            还没有自选股票，{'\n'}在列表页点右侧星标加入。
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.headRow}>
        <ThemedText type="code" themeColor="textSecondary">
          {favorites.length} 只自选 · 长按可移除
        </ThemedText>
        {loading ? <ActivityIndicator size="small" /> : null}
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => item.code}
        renderItem={({ item }) => (
          <StockTile
            stock={item}
            isFav
            onPress={(s) => {
              setDetailList(data.map((x) => ({ code: x.code, name: x.name })));
              router.push(`/stock/${s.code}?name=${encodeURIComponent(s.name)}`);
            }}
            onToggleFav={handleToggleFav}
            onLongPress={handleLongPress}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.sep, { backgroundColor: theme.border }]} />
        )}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', lineHeight: 22 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  listContent: { paddingBottom: 24 },
});