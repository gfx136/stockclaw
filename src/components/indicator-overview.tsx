import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { fmtPrice } from '@/lib/format';
import type { IndicatorSnapshot } from '@/types/stock';

/**
 * 指标速览区（补充规格 §2.6）。
 * 六大指标固定顺序：MA / BOLL / MACD / KDJ / RSI / BBI，竖屏 2 行 × 3 列。
 * 与图表同源（同一 snapshot）；未开启的指标灰态 40%，点击卡片打开指标开关浮层。
 */

export interface IndicatorOverviewProps {
  snapshot: IndicatorSnapshot;
  /** 最新收盘价（判定相对位置） */
  latestClose: number;
  /** MACD 交叉状态（详情页算好传入） */
  macdCross?: 'golden' | 'dead' | null;
  /** 各指标是否开启（主图/副图开关） */
  enabled: { ma: boolean; boll: boolean; macd: boolean; kdj: boolean; rsi: boolean; bbi: boolean };
  onOpenIndicators?: () => void;
}

const MA_COLORS = { 5: '#F5A623', 10: '#4DA3F5', 20: '#C77DFF', 60: '#8A8F98' };

export function IndicatorOverview({ snapshot: s, latestClose, macdCross, enabled, onOpenIndicators }: IndicatorOverviewProps) {
  const theme = useTheme();

  const card = (key: string, title: string, on: boolean, main: React.ReactNode, sub: string) => (
    <Pressable key={key} onPress={onOpenIndicators} style={styles.cardWrap}>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement, opacity: on ? 1 : 0.4 }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { color: theme.textSecondary }]}>{title}</Text>
          {!on ? <Text style={[styles.offTag, { color: theme.textSecondary }]}>未开启</Text> : null}
        </View>
        {main}
        <Text style={[styles.cardSub, { color: theme.textSecondary }]} numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );

  // MA：相对各均线位置
  const maPos = [s.ma5, s.ma10, s.ma20, s.ma60]
    .filter((v): v is number => v !== undefined)
    .map((v) => (latestClose >= v ? '↑' : '↓'))
    .join('');

  // BOLL：相对轨道
  let bollPos = '—';
  if (s.bollUpper !== undefined && s.bollLower !== undefined) {
    if (latestClose >= s.bollUpper) bollPos = '上轨上方';
    else if (s.bollMid !== undefined && latestClose >= s.bollMid) bollPos = '中轨上方';
    else if (s.bollMid !== undefined) bollPos = latestClose >= s.bollLower! ? '中轨下方' : '下轨下方';
  }

  // KDJ 超买超卖
  const kdjZone = s.j === undefined ? '—' : s.j > 100 ? '超买' : s.j < 0 ? '超卖' : '中性';
  // RSI 超买超卖
  const rsiZone = s.rsi14 === undefined ? '—' : s.rsi14 > 70 ? '超买' : s.rsi14 < 30 ? '超卖' : '中性';
  // BBI 相对位置
  const bbiPos = s.bbi === undefined ? '—' : latestClose > s.bbi ? '收盘>BBI' : '收盘<BBI';
  const bbiMa26 = s.bbi !== undefined && s.ma26 !== undefined ? (s.bbi > s.ma26 ? 'BBI>MA26' : 'BBI<MA26') : '—';

  return (
    <View style={styles.grid}>
      {card(
        'ma', 'MA', enabled.ma,
        <View style={styles.maRow}>
          {[5, 10, 20, 60].map((p) => {
            const v = s[`ma${p}` as keyof IndicatorSnapshot] as number | undefined;
            return (
              <View key={p} style={styles.maItem}>
                <View style={[styles.dot, { backgroundColor: MA_COLORS[p as keyof typeof MA_COLORS] }]} />
                <Text style={[styles.cardVal, { color: theme.text }]}>{fmtPrice(v)}</Text>
              </View>
            );
          })}
        </View>,
        maPos ? `价格 ${maPos}` : '—'
      )}
      {card(
        'boll', 'BOLL', enabled.boll,
        <Text style={[styles.cardVal, { color: theme.text }]}>
          {fmtPrice(s.bollUpper)} / {fmtPrice(s.bollMid)} / {fmtPrice(s.bollLower)}
        </Text>,
        bollPos
      )}
      {card(
        'macd', 'MACD', enabled.macd,
        <Text style={[styles.cardVal, { color: theme.text }]}>
          DIF {fmtPrice(s.dif)} · 柱 {fmtPrice(s.macdHist)}
        </Text>,
        macdCross === 'golden' ? '当日金叉' : macdCross === 'dead' ? '当日死叉' : (s.macdHist ?? 0) >= 0 ? '柱为正' : '柱为负'
      )}
      {card(
        'kdj', 'KDJ', enabled.kdj,
        <Text style={[styles.cardVal, { color: theme.text }]}>
          K {fmtPrice(s.k)} · D {fmtPrice(s.d)} · J {fmtPrice(s.j)}
        </Text>,
        kdjZone
      )}
      {card(
        'rsi', 'RSI(14)', enabled.rsi,
        <Text style={[styles.cardVal, { color: theme.text }]}>{fmtPrice(s.rsi14)}</Text>,
        rsiZone
      )}
      {card(
        'bbi', 'BBI', enabled.bbi,
        <Text style={[styles.cardVal, { color: theme.text }]}>
          {fmtPrice(s.bbi)} · MA26 {fmtPrice(s.ma26)}
        </Text>,
        `${bbiPos} · ${bbiMa26}`
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cardWrap: { width: '31.8%' },
  card: { borderRadius: 10, padding: 10, gap: 6, minHeight: 66 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 11 },
  offTag: { fontSize: 9 },
  cardVal: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  cardSub: { fontSize: 10 },
  maRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  maItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});