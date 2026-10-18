import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuoteRow } from '@/components/quote-row';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllStocks } from '@/lib/eastmoney';
import { loadFavorites, removeFavorite } from '@/lib/favorites';
import type { FavoriteItem, Stock } from '@/types/stock';

/**
 * 收藏页。
 * 收藏只存 code+name；这里再拉一次全量行情，把实时价拼上去，
 * 这样自选列表里的价格和行情页保持一致。
 */
export default function FavoritesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Stock>>({});
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 每次进入都重新读，保证和列表页的收藏状态同步
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const list = await loadFavorites();
        if (!active || !mounted.current) return;
        setFavorites(list);
        if (list.length > 0) {
          setLoading(true);
          try {
            const all = await fetchAllStocks(200);
            if (!active || !mounted.current) return;
            const map: Record<string, Stock> = {};
            for (const s of all) map[s.code] = s;
            setQuotes(map);
          } catch {
            /* 行情失败时仍展示收藏（价格显示为 —） */
          } finally {
            if (active && mounted.current) setLoading(false);
          }
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const handleRemove = useCallback((item: FavoriteItem) => {
    Alert.alert('移除收藏', `确定移除 ${item.name}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: async () => {
          const next = await removeFavorite(item.code);
          setFavorites(next);
        },
      },
    ]);
  }, []);

  /** 组装：有行情用行情，没有则用收藏中的名字兜底 */
  const data: Stock[] = favorites.map(
    (f) => quotes[f.code] ?? { code: f.code, name: f.name, price: 0, changePercent: 0 }
  );

  if (favorites.length === 0) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.background }]}
        edges={['top']}>
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            还没有收藏{'\n'}在「所有股票」页长按一只股票即可添加
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.headRow}>
        <ThemedText type="code" themeColor="textSecondary">
          {favorites.length} 只自选 · 长按移除
        </ThemedText>
        {loading ? <ActivityIndicator size="small" /> : null}
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => item.code}
        renderItem={({ item }) => (
          <View style={styles.rowWrap}>
            <QuoteRow
              stock={item}
              onPress={() =>
                router.push(`/stock/${item.code}?name=${encodeURIComponent(item.name)}`)
              }
            />
            <Pressable
              onLongPress={() => handleRemove({ code: item.code, name: item.name, addedAt: 0 })}
              delayLongPress={350}
              style={StyleSheet.absoluteFill}
              pointerEvents="box-only"
            />
          </View>
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
  rowWrap: { position: 'relative' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  listContent: { paddingBottom: 24 },
});