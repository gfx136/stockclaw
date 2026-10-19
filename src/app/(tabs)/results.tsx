import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StockTile } from '@/components/stock-tile';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import { setDetailList } from '@/lib/detail-nav';
import { getFilterState, setFilterOutput, subscribeFilter } from '@/lib/filter-store';
import type { Stock } from '@/types/stock';

/**
 * 筛选结果页（产品规格 2.3）。
 * 展示最近一次筛选命中列表，行结构与全部股票一致 + 命中条件摘要标签。
 * 空态固定文案；「清空结果」二次确认。支持搜索二次过滤。
 */
export default function ResultsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [favSet, setFavSet] = useState<Set<string>>(new Set());

  const state = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const output = state.output;

  useEffect(() => {
    (async () => {
      const favs = await loadFavorites();
      setFavSet(new Set(favs.map((f) => f.code)));
    })();
  }, [state.output]);

  const handleToggleFav = useCallback(async (s: Stock) => {
    const nowFav = await toggleFavorite(s.code, s.name);
    setFavSet((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(s.code);
      else next.delete(s.code);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert('清空筛选结果？', '将删除当前命中列表', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: () => setFilterOutput(null) },
    ]);
  }, []);

  // 搜索二次过滤
  const filtered = useMemo(() => {
    if (!output) return [];
    const q = query.trim().toLowerCase();
    if (!q) return output.results;
    return output.results.filter(
      (r) => r.stock.name.toLowerCase().includes(q) || r.stock.code.includes(q)
    );
  }, [output, query]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <ThemedText type="subtitle">筛选结果</ThemedText>
        {output ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              命中 {filtered.length} 只
            </ThemedText>
            <Pressable onPress={handleClear} hitSlop={8}>
              <ThemedText type="small" style={{ color: theme.tint }}>清空</ThemedText>
            </Pressable>
          </>
        ) : null}
      </View>

      {!output ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📋</Text>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            暂无筛选结果。{'\n'}在「全部股票」页点击筛选条件运行后，命中股票会自动出现在这里。
          </ThemedText>
        </View>
      ) : (
        <>
          <View style={styles.searchWrap}>
            <TextInput
              style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              placeholder="结果内过滤，名称/代码"
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {filtered.length === 0 ? (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary">没有符合条件的股票</ThemedText>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.stock.code}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <View>
                  <StockTile
                    stock={item.stock}
                    isFav={favSet.has(item.stock.code)}
                    onPress={(s) => {
                      setDetailList(filtered.map((x) => ({ code: x.stock.code, name: x.stock.name })));
                      router.push(`/stock/${s.code}?name=${encodeURIComponent(s.name)}`);
                    }}
                    onToggleFav={handleToggleFav}
                  />
                  {item.hits.length > 0 ? (
                    <View style={styles.hitRow}>
                      {item.hits.map((h) => (
                        <View key={h} style={[styles.hitChip, { backgroundColor: theme.tint }]}>
                          <Text style={styles.hitText}>{h}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
              ItemSeparatorComponent={() => (
                <View style={[styles.sep, { backgroundColor: theme.border }]} />
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'baseline', gap: 12,
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { textAlign: 'center', lineHeight: 22 },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  search: { height: 38, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  list: { paddingBottom: 24 },
  hitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 16, paddingBottom: 8 },
  hitChip: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 4 },
  hitText: { color: '#ffffff', fontSize: 11, lineHeight: 16 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
});