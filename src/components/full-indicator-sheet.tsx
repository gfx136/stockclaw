import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { fmtPrice } from '@/lib/format';
import { indicatorColor } from '@/lib/indicator-palette';
import type { IndicatorSeries, KlineBar, KlinePeriod } from '@/types/stock';

/**
 * 「完整指标数值」底部 Sheet（补充规格 v1.2 §5）。
 * 六组固定顺序（MA → BOLL → MACD → KDJ → RSI → BBI），每组带指标色点。
 * 页脚：数值口径 + 复制全部 + 周期切换。与十字光标联动（展示选中 bar 的数值）。
 */

export interface BbiRuleResult {
  label: string;
  /** 'ok' | 'no' | 'nodata' */
  status: 'ok' | 'no' | 'nodata';
  needBars?: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  stockName: string;
  code: string;
  period: KlinePeriod;
  bars: KlineBar[];
  /** 展示的 bar 索引（长度末尾=最新；null 则用最新） */
  selIdx: number | null;
  series: IndicatorSeries | null;
  /** 选中 bar 的指标快照（含 ma26/bbi/boll 等） */
  snapshot: Record<string, number | undefined> | null;
  bbiRules?: BbiRuleResult[];
  isDark?: boolean;
  onPeriodChange?: (p: KlinePeriod) => void;
}

const PERIODS: { key: KlinePeriod; label: string }[] = [
  { key: '60min', label: '60分钟' },
  { key: 'daily', label: '日' },
  { key: 'weekly', label: '周' },
  { key: 'monthly', label: '月' },
];

function fmt(v?: number): string {
  return v === undefined || Number.isNaN(v) ? '—' : v.toFixed(2);
}

export function FullIndicatorSheet({
  visible, onClose, stockName, code, period, bars, selIdx, snapshot, bbiRules, isDark = true, onPeriodChange,
}: Props) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const idx = selIdx !== null && selIdx >= 0 && selIdx < bars.length ? selIdx : bars.length - 1;
  const bar = bars[idx];
  const close = bar?.close ?? 0;
  const s = snapshot ?? {};

  const rel = (v?: number) => (v === undefined ? '—' : close >= v ? '价格 ↑' : '价格 ↓');

  const onCopy = async () => {
    const lines: string[] = [
      `${stockName} ${code} · ${PERIODS.find((p) => p.key === period)?.label}`,
      bar ? `日期: ${bar.date}` : '',
      '',
      `[MA] MA5 ${fmt(s.ma5)}  MA10 ${fmt(s.ma10)}  MA20 ${fmt(s.ma20)}  MA26 ${fmt(s.ma26)}  MA60 ${fmt(s.ma60)}`,
      `[BOLL] 上轨 ${fmt(s.bollUpper)}  中轨 ${fmt(s.bollMid)}  下轨 ${fmt(s.bollLower)}  带宽 ${fmt((s.bollUpper ?? 0) - (s.bollLower ?? 0))}`,
      `[MACD] DIF ${fmt(s.dif)}  DEA ${fmt(s.dea)}  柱 ${fmt(s.macdHist)}`,
      `[KDJ] K ${fmt(s.k)}  D ${fmt(s.d)}  J ${fmt(s.j)}`,
      `[RSI] RSI14 ${fmt(s.rsi14)}`,
      `[BBI] BBI ${fmt(s.bbi)}  MA26 ${fmt(s.ma26)}`,
    ];
    await Clipboard.setStringAsync(lines.filter(Boolean).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const group = (title: string, colorKey: string, rows: { k: string; v: string; note?: string }[]) => (
    <View key={title} style={styles.group}>
      <View style={styles.groupHead}>
        <View style={[styles.dot, { backgroundColor: indicatorColor(colorKey as never, isDark) }]} />
        <Text style={[styles.groupTitle, { color: theme.text }]}>{title}</Text>
      </View>
      {rows.map((r) => (
        <View key={r.k} style={styles.rowItem}>
          <Text style={[styles.rowK, { color: theme.textSecondary }]} numberOfLines={1}>{r.k}</Text>
          <Text style={[styles.rowV, { color: theme.text }]} numberOfLines={1}>
            {r.v}{r.note ? <Text style={[styles.rowNote, { color: theme.textSecondary }]}>  {r.note}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>完整指标数值</Text>
            <Text style={[styles.sub, { color: theme.textSecondary }]}>
              {stockName} {code} · {PERIODS.find((p) => p.key === period)?.label}{bar ? ` · ${bar.date}` : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[styles.close, { color: theme.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        {/* 周期切换 */}
        <View style={styles.periodRow}>
          {PERIODS.map((p) => {
            const on = p.key === period;
            return (
              <Pressable key={p.key} onPress={() => onPeriodChange?.(p.key)}>
                <View style={[styles.periodBtn, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
                  <Text style={[styles.periodText, { color: on ? '#fff' : theme.text }]}>{p.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {group('MA 均线', 'ma20', [
            { k: 'MA5', v: fmt(s.ma5), note: rel(s.ma5) },
            { k: 'MA10', v: fmt(s.ma10), note: rel(s.ma10) },
            { k: 'MA20', v: fmt(s.ma20), note: rel(s.ma20) },
            { k: 'MA26', v: fmt(s.ma26), note: rel(s.ma26) },
            { k: 'MA60', v: fmt(s.ma60), note: rel(s.ma60) },
          ])}
          {group('BOLL 布林带 (20, 2σ)', 'boll', [
            { k: '上轨', v: fmt(s.bollUpper) },
            { k: '中轨', v: fmt(s.bollMid) },
            { k: '下轨', v: fmt(s.bollLower) },
            { k: '带宽', v: fmt((s.bollUpper ?? 0) - (s.bollLower ?? 0)) },
            {
              k: '%B',
              v: s.bollUpper !== undefined && s.bollLower !== undefined && s.bollUpper !== s.bollLower
                ? (((close - s.bollLower!) / (s.bollUpper! - s.bollLower!)) * 100).toFixed(1) + '%'
                : '—',
            },
          ])}
          {group('MACD (12/26/9)', 'macdDif', [
            { k: 'DIF', v: fmt(s.dif) },
            { k: 'DEA', v: fmt(s.dea) },
            { k: '柱值(MACD)', v: fmt(s.macdHist) },
            { k: '状态', v: (s.macdHist ?? 0) >= 0 ? '柱为正' : '柱为负' },
          ])}
          {group('KDJ (9,3,3)', 'kdjJ', [
            { k: 'K', v: fmt(s.k) },
            { k: 'D', v: fmt(s.d) },
            { k: 'J', v: fmt(s.j) },
            { k: '状态', v: (s.j ?? 50) > 100 ? '超买' : (s.j ?? 50) < 0 ? '超卖' : '中性' },
          ])}
          {group('RSI(14)', 'rsi', [
            { k: 'RSI14', v: fmt(s.rsi14) },
            { k: '状态', v: (s.rsi14 ?? 50) > 70 ? '超买' : (s.rsi14 ?? 50) < 30 ? '超卖' : '中性' },
          ])}
          {group('BBI (MA3+MA6+MA12+MA24)/4', 'bbi', [
            { k: 'BBI', v: fmt(s.bbi) },
            { k: 'MA26', v: fmt(s.ma26) },
          ])}

          {/* BBI 六条规则判定（§5.3） */}
          {bbiRules ? (
            <View style={styles.group}>
              <Text style={[styles.groupTitle, { color: theme.text }]}>BBI 组规则判定</Text>
              {bbiRules.map((r) => (
                <View key={r.label} style={styles.ruleRow}>
                  <Text style={[styles.rowK, { color: theme.textSecondary, flex: 1 }]} numberOfLines={1}>{r.label}</Text>
                  <Text style={[styles.ruleStatus, {
                    color: r.status === 'ok' ? '#26A69A' : r.status === 'no' ? theme.textSecondary : '#FFB300',
                  }]}>
                    {r.status === 'ok' ? '✅ 满足' : r.status === 'no' ? '❌ 不满足' : `⚠ 数据不足 · 需 ${r.needBars ?? '?'} 根`}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={[styles.footnote, { color: theme.textSecondary }]}>
            所有指标均按前复权价格计算；数据截至 {bar?.date ?? '—'}；周期 = {PERIODS.find((p) => p.key === period)?.label}。
          </Text>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <Pressable onPress={onCopy} style={styles.copyBtn}>
            <View style={[styles.copyBtnInner, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.copyText, { color: theme.tint }]}>{copied ? '已复制指标数值' : '复制全部'}</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: '78%', borderTopLeftRadius: 16, borderTopRightRadius: 16,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#8888', alignSelf: 'center', marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 10, marginTop: 2 },
  close: { fontSize: 18, paddingHorizontal: 4 },
  periodRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  periodBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  periodText: { fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 18 },
  group: { gap: 2 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: { fontSize: 13, fontWeight: '700' },
  rowItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  rowK: { fontSize: 13, flexShrink: 0, width: '40%' },
  rowV: { fontSize: 13, fontVariant: ['tabular-nums'], textAlign: 'right', flex: 1 },
  rowNote: { fontSize: 11 },
  ruleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  ruleStatus: { fontSize: 12, fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 10, lineHeight: 16, marginTop: 4 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12 },
  copyBtn: {},
  copyBtnInner: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copyText: { fontSize: 15, fontWeight: '700' },
});