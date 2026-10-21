import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StockTile } from '@/components/stock-tile';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/icon';
import { OfflineBanner } from '@/components/offline-banner';
import { TouchTarget } from '@/components/touch-target';
import { useTheme } from '@/hooks/use-theme';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import { setDetailList } from '@/lib/detail-nav';
import { useT } from '@/lib/i18n';
import { getFilterState, setFilterOutput, subscribeFilter } from '@/lib/filter-store';
import { getFilterRunState, runStageText, subscribeFilterRun } from '@/lib/filter-runner';
import type { Stock } from '@/types/stock';

/**
 * 筛选结果页（产品规格 2.3）。
 * 展示最近一次筛选命中列表，行结构与全部股票一致 + 命中条件摘要标签。
 * 空态固定文案；「清空结果」二次确认。支持搜索二次过滤。
 */
export default function ResultsScreen() {
  const theme = useTheme();
  const { t, tf } = useT();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [favSet, setFavSet] = useState<Set<string>>(new Set());

  const state = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const output = state.output;
  // 后台运行的进度（在筛选面板里点了「后台运行」后会在这里继续显示）
  const runState = useSyncExternalStore(subscribeFilterRun, getFilterRunState, getFilterRunState);

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
  }, [t]);

  const handleClear = useCallback(() => {
    Alert.alert(t('results_clearConfirm'), t('results_clearDesc'), [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('common_clear'), style: 'destructive', onPress: () => setFilterOutput(null) },
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
        <ThemedText type="navTitle">{t('results_title')}</ThemedText>
        {output ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {tf('results_hits', { n: filtered.length })}
            </ThemedText>
            <TouchTarget onPress={handleClear}>
              <ThemedText type="small" style={{ color: theme.tint }}>{t('common_clear')}</ThemedText>
            </TouchTarget>
          </>
        ) : null}
      </View>

      {/* 后台筛选进度条：面板关掉后在这里继续显示，避免"点了运行就没反应" */}
      {runState.running ? (
        <View style={styles.runBanner}>
          <View style={styles.runBannerHead}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.runBannerText} numberOfLines={1}>
              {runStageText(runState, t, tf)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{runState.percent}%</ThemedText>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(2, runState.percent)}%`, backgroundColor: theme.tint },
              ]}
            />
          </View>
        </View>
      ) : null}

      <OfflineBanner />

      {!output ? (
        <View style={styles.center}>
          <Icon name="list.bullet.rectangle" size={34} color={theme.textSecondary} weight="regular" fallbackGlyph="📋" />
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            {t('results_emptyHint')}
          </ThemedText>
          {/* UI 评审：空态原来只有一句「暂无数据」，没有出口。
              后台筛选跑完为空时，用户最需要的就是回到条件页改条件。 */}
          <Pressable onPress={() => router.push('/filter')}>
            <View style={[styles.emptyAction, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>{t('results_emptyAction')}</ThemedText>
            </View>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.searchWrap}>
            <TextInput
              style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              placeholder={t('results_filterPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {filtered.length === 0 ? (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary">{t('results_empty')}</ThemedText>
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
                          <Text style={[styles.hitText, { color: theme.onAccent }]}>{h}</Text>
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
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyAction: { height: 40, borderRadius: 20, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  runBanner: { paddingHorizontal: 16, paddingBottom: 10 },
  runBannerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  runBannerText: { flex: 1, marginRight: 8 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  emptyIcon: { fontSize: 40 },
  emptyText: { textAlign: 'center', lineHeight: 22 },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  search: { height: 38, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  list: { paddingBottom: 24 },
  hitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 16, paddingBottom: 8 },
  hitChip: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 4 },
  hitText: { fontSize: 11, lineHeight: 16 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
});