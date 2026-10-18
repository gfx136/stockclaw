import { useRouter } from 'expo-router';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuoteRow } from '@/components/quote-row';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { getFilterState, subscribeFilter } from '@/lib/filter-store';

/**
 * 选股结果页。对应界面规格的「选股结果」tab。
 *
 * 默认空白——只有用户从「全部股票」页打开筛选面板、应用筛选后才显示结果。
 * 结果从 filter-store 读取（跨 tab 共享）。顶部搜索框可对结果二次过滤。
 */
export default function ResultsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const state = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const output = state.output;

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
        <ThemedText type="subtitle">选股结果</ThemedText>
        {output ? (
          <ThemedText type="small" themeColor="textSecondary">
            命中 {filtered.length} 只
          </ThemedText>
        ) : null}
      </View>

      {!output ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📊</Text>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            还没有筛选结果{'\n'}到「全部股票」页点筛选按钮设置条件
          </ThemedText>
        </View>
      ) : (
        <>
          {/* 搜索二次过滤 */}
          <View style={styles.searchWrap}>
            <TextInput
              style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              placeholder="搜索结果内过滤，名称/代码"
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {filtered.length === 0 ? (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary">
                没有符合条件的股票
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.stock.code}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <View style={styles.resultItem}>
                  <QuoteRow
                    stock={item.stock}
                    onPress={() =>
                      router.push(
                        `/stock/${item.stock.code}?name=${encodeURIComponent(item.stock.name)}`
                      )
                    }
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
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { textAlign: 'center', lineHeight: 22 },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  search: { height: 38, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  list: { paddingBottom: 24 },
  resultItem: { marginBottom: 4 },
  hitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  hitChip: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 4 },
  hitText: { color: '#ffffff', fontSize: 11, lineHeight: 16 },
});