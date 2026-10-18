import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { QuoteRow } from '@/components/quote-row';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllStocks } from '@/lib/eastmoney';
import { downloadKlines } from '@/lib/kline-downloader';
import { loadKlines } from '@/lib/kline-db';
import { matchWeeklyBBI, prefilter, type WeeklyBBIResult } from '@/lib/weekly-bbi';
import type { Stock } from '@/types/stock';

/**
 * 周线 BBI 策略面板（用户公式的运行入口）。
 *
 * 自包含：自己的状态、运行逻辑、结果渲染。
 * 通过 props 复用父级已拉取的全市场列表（避免重复拉行情）。
 *
 * 公式：
 *   周线BBI > 周线MA26  AND  周线收盘 > 周线BBI
 *   且 市值≥20亿，排除 ST/科创板/北交所/银行
 */

interface Hit {
  stock: Stock;
  result: WeeklyBBIResult;
}

export function WeeklyBBIPanel({
  allStocks,
  setAllStocks,
}: {
  allStocks: Stock[] | null;
  setAllStocks: (s: Stock[]) => void;
}) {
  const theme = useTheme();
  const router = useRouter();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [candCount, setCandCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setHits(null);
    try {
      // 1. 全市场行情
      let stocks = allStocks;
      if (!stocks || stocks.length === 0) {
        stocks = await fetchAllStocks(200);
        setAllStocks(stocks);
      }
      if (stocks.length === 0) {
        setError('未取到行情数据，请检查网络');
        return;
      }

      // 2. 便宜过滤（市值/名称/代码），把全市场压到候选
      const candidates = prefilter(stocks);
      setCandCount(candidates.length);
      setProgress({ done: 0, total: candidates.length });

      // 3. 逐只下载周线并判定
      const found: Hit[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const s = candidates[i];
        try {
          await downloadKlines(s.code, 'weekly', 200);
          const bars = await loadKlines(s.code, 'weekly', 200);
          const r = matchWeeklyBBI(bars);
          if (r.pass) found.push({ stock: s, result: r });
        } catch {
          // 单只失败跳过
        }
        setProgress({ done: i + 1, total: candidates.length });
      }
      setHits(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : '运行失败');
    } finally {
      setRunning(false);
    }
  }, [allStocks, setAllStocks]);

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.head}>
        <ThemedText type="smallBold">周线 BBI 策略</ThemedText>
        <View style={[styles.badge, { backgroundColor: theme.tint }]}>
          <Text style={styles.badgeText}>我的公式</Text>
        </View>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.formula}>
        周线BBI &gt; 周线MA26 且 收盘 &gt; BBI{'\n'}
        市值≥20亿 · 排除ST/科创板/北交所/银行
      </ThemedText>

      {/* 运行按钮 */}
      <Pressable onPress={run} disabled={running}>
        <View style={[styles.runBtn, { backgroundColor: theme.tint, opacity: running ? 0.6 : 1 }]}>
          {running ? (
            <View style={styles.runningRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.runText}>
                {progress.done}/{progress.total} ({pct}%)
              </Text>
            </View>
          ) : (
            <Text style={styles.runText}>运行策略</Text>
          )}
        </View>
      </Pressable>

      {running && progress.total > 0 ? (
        <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.progressBar, { width: `${pct}%`, backgroundColor: theme.tint }]} />
        </View>
      ) : null}

      {error ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {error}
        </ThemedText>
      ) : null}

      {/* 结果 */}
      {hits !== null ? (
        <View style={styles.resultArea}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            候选 {candCount} 只 → 命中 {hits.length} 只
          </ThemedText>
          {hits.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              当前市场无符合条件的股票
            </ThemedText>
          ) : (
            hits.map((h) => (
              <View key={h.stock.code} style={styles.hitItem}>
                <QuoteRow
                  stock={h.stock}
                  onPress={() =>
                    router.push(
                      `/stock/${h.stock.code}?name=${encodeURIComponent(h.stock.name)}`
                    )
                  }
                />
                <View style={styles.hitMeta}>
                  <Text style={[styles.hitMetaText, { color: theme.textSecondary }]}>
                    BBI {h.result.weeklyBBI?.toFixed(2)} · MA26 {h.result.weeklyMA26?.toFixed(2)} ·
                    收盘 {h.result.weeklyClose?.toFixed(2)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 24, borderRadius: 14, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  formula: { lineHeight: 19, fontSize: 12 },
  runBtn: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  runningRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  runText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: 4, borderRadius: 2 },
  note: { lineHeight: 18 },
  resultArea: { gap: 4, marginTop: 4 },
  hitItem: { marginBottom: 4 },
  hitMeta: { paddingHorizontal: 4, paddingBottom: 6 },
  hitMetaText: { fontSize: 11 },
});