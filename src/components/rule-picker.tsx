import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { indicatorColor } from '@/lib/indicator-palette';
import { ruleLabel, type IndicatorRule, type IndicatorRuleKind, type KlinePeriod } from '@/types/stock';

/**
 * 技术指标规则选择器（补充规格 §3）。
 * 按指标分组点选规则；规则间是 AND 组合。
 * 周期规则（规格 §3.1）：
 * - 周期无关规则（MA/BOLL/MACD/KDJ/RSI）→ 60分钟/日/周/月 四周期全部生效（固定）
 * - BBI 组规则自带周期标签（日线/周线定向）
 */

interface RuleOption {
  kind: IndicatorRuleKind;
  label: string;
  value?: number;
}

const RULE_GROUPS: { group: string; options: RuleOption[] }[] = [
  {
    group: 'MA 均线',
    options: [
      { kind: 'ma_above', value: 5, label: '站上MA5' },
      { kind: 'ma_above', value: 10, label: '站上MA10' },
      { kind: 'ma_above', value: 20, label: '站上MA20' },
      { kind: 'ma_above', value: 26, label: '站上MA26' },
      { kind: 'ma_above', value: 60, label: '站上MA60' },
      { kind: 'ma_below', value: 20, label: '跌破MA20' },
    ],
  },
  {
    group: 'BOLL 布林带',
    options: [
      { kind: 'boll_above_upper', label: '触上轨' },
      { kind: 'boll_above_mid', label: '中轨上方' },
      { kind: 'boll_below_mid', label: '中轨下方' },
      { kind: 'boll_below_lower', label: '触下轨' },
    ],
  },
  {
    group: 'MACD',
    options: [
      { kind: 'macd_hist_pos', label: '柱为正' },
      { kind: 'macd_hist_neg', label: '柱为负' },
      { kind: 'macd_golden', label: '金叉' },
      { kind: 'macd_dead', label: '死叉' },
    ],
  },
  {
    group: 'KDJ (J值)',
    options: [
      { kind: 'kdj_lt', value: 0, label: '超卖 J<0' },
      { kind: 'kdj_gt', value: 100, label: '超买 J>100' },
    ],
  },
  {
    group: 'RSI(14)',
    options: [
      { kind: 'rsi_lt', value: 30, label: '超卖 <30' },
      { kind: 'rsi_gt', value: 70, label: '超买 >70' },
    ],
  },
  {
    group: 'BBI（周线/日线定向）',
    options: [
      { kind: 'bbi_close_gt', label: '日:收盘>BBI' },
      { kind: 'bbi_4close_gt', label: '日:连续4收盘>BBI' },
      { kind: 'bbi_gt_ma26', label: '日:BBI>MA26' },
      { kind: 'bbi_w_close_gt', label: '周:收盘>BBI' },
      { kind: 'bbi_w_gt_ma26', label: '周:BBI>MA26' },
      { kind: 'bbi_w_bull', label: '周:红柱(收>开)' },
    ],
  },
];

/** 规则默认周期（规格 §3.1） */
function defaultPeriods(kind: IndicatorRuleKind): KlinePeriod[] {
  if (kind.startsWith('bbi_w_')) return ['weekly'];
  if (kind.startsWith('bbi_')) return ['daily'];
  return ['60min', 'daily', 'weekly', 'monthly'];
}

/** 规则的周期标签（固定显示，规格 §3.1） */
function periodLabelOf(kind: IndicatorRuleKind): string {
  if (kind.startsWith('bbi_w_')) return '周线';
  if (kind.startsWith('bbi_')) return '日线';
  return '四周期';
}

function ruleKey(r: { kind: IndicatorRuleKind; value?: number }): string {
  return `${r.kind}:${r.value ?? ''}`;
}

/** 规则 → 指标色板键（第五处同色：筛选面板与图表/图例/速览带一致） */
function ruleColorKey(kind: IndicatorRuleKind): string {
  if (kind.startsWith('bbi')) return 'bbi';
  if (kind.startsWith('ma_')) return kind.includes('26') ? 'ma26' : 'ma20';
  if (kind.startsWith('boll')) return 'boll';
  if (kind.startsWith('macd')) return 'macdDif';
  if (kind.startsWith('kdj')) return 'kdjJ';
  if (kind.startsWith('rsi')) return 'rsi';
  return 'ma20';
}

export function RulePicker({
  rules,
  onChange,
}: {
  rules: IndicatorRule[];
  onChange: (rules: IndicatorRule[]) => void;
}) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';

  const isOn = (opt: RuleOption) => rules.some((r) => ruleKey(r) === ruleKey(opt));

  const toggle = (opt: RuleOption) => {
    const k = ruleKey(opt);
    const exists = rules.some((r) => ruleKey(r) === k);
    if (exists) {
      onChange(rules.filter((r) => ruleKey(r) !== k));
    } else {
      onChange([...rules, { kind: opt.kind, value: opt.value, periods: defaultPeriods(opt.kind) }]);
    }
  };

  const removeRule = (target: IndicatorRule) => {
    onChange(rules.filter((r) => ruleKey(r) !== ruleKey(target)));
  };

  return (
    <View style={styles.box}>
      {/* 已选规则 */}
      {rules.length > 0 ? (
        <View style={styles.selectedBox}>
          {rules.map((r) => (
            <View key={ruleKey(r)} style={[styles.selectedItem, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.selectedTop}>
                <View style={styles.selectedLabelRow}>
                  <View style={[styles.ruleDot, { backgroundColor: indicatorColor(ruleColorKey(r.kind), isDark) }]} />
                  <Text style={[styles.selectedLabel, { color: theme.text }]}>{ruleLabel(r)}</Text>
                </View>
                <Pressable onPress={() => removeRule(r)} hitSlop={6}>
                  <Icon name="xmark.circle.fill" size={15} color={theme.textSecondary} weight="regular" fallbackGlyph="✕" />
                </Pressable>
              </View>
              <Text style={[styles.periodTag, { color: theme.textSecondary }]}>{periodLabelOf(r.kind)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.emptyHint, { color: theme.textSecondary }]}>
          点下方指标添加条件，多条为「并且」关系；每个条件在所有适用周期上都须满足
        </Text>
      )}

      {/* 分组选项 */}
      {RULE_GROUPS.map((g) => (
        <View key={g.group} style={styles.group}>
          <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>{g.group}</Text>
          <View style={styles.chipRow}>
            {g.options.map((opt) => {
              const on = isOn(opt);
              return (
                <Pressable key={ruleKey(opt)} onPress={() => toggle(opt)} hitSlop={4}>
                  <View style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
                    <Text style={[styles.chipText, { color: on ? '#fff' : theme.text }]}>{opt.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  emptyHint: { fontSize: 12, lineHeight: 18 },
  selectedBox: { gap: 8 },
  selectedItem: { borderRadius: 8, padding: 10, gap: 4 },
  selectedTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  ruleDot: { width: 8, height: 8, borderRadius: 4 },
  selectedLabel: { fontSize: 13, fontWeight: '600' },
  removeBtn: { fontSize: 14, paddingHorizontal: 4 },
  periodTag: { fontSize: 11 },
  group: { gap: 6 },
  groupLabel: { fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chipText: { fontSize: 12 },
});