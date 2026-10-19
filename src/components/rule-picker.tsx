import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { ruleLabel, type IndicatorRule, type IndicatorRuleKind, type KlinePeriod } from '@/types/stock';

/**
 * 技术指标规则选择器（产品规格 2.2 B）。
 * 按指标分组点选规则；每条规则可指定适用周期（60分钟/日/周/月）；
 * 已选规则显示为标签，可改周期、可删除。规则间是 AND 组合。
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
      { kind: 'boll_above_upper', label: '上轨上方' },
      { kind: 'boll_above_mid', label: '中轨上方' },
      { kind: 'boll_below_mid', label: '中轨下方' },
      { kind: 'boll_below_lower', label: '下轨下方' },
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
      { kind: 'kdj_lt', value: 30, label: '超卖 J<30' },
      { kind: 'kdj_gt', value: 70, label: '超买 J>70' },
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
    group: 'BBI',
    options: [
      { kind: 'bbi_close_gt', label: '收盘>BBI' },
      { kind: 'bbi_4close_gt', label: '连续4日收盘>BBI' },
      { kind: 'bbi_gt_ma26', label: 'BBI>MA26' },
      { kind: 'bbi_w_close_gt', label: '周收盘>BBI' },
      { kind: 'bbi_w_gt_ma26', label: '周BBI>MA26' },
    ],
  },
];

const PERIOD_OPTS: { key: KlinePeriod; label: string }[] = [
  { key: '60min', label: '60分' },
  { key: 'daily', label: '日' },
  { key: 'weekly', label: '周' },
  { key: 'monthly', label: '月' },
];

/** 规则默认周期：BBI 周线规则固定周线，其余默认日线 */
function defaultPeriods(kind: IndicatorRuleKind): KlinePeriod[] {
  if (kind === 'bbi_w_close_gt' || kind === 'bbi_w_gt_ma26') return ['weekly'];
  return ['daily'];
}

function ruleKey(r: { kind: IndicatorRuleKind; value?: number }): string {
  return `${r.kind}:${r.value ?? ''}`;
}

export function RulePicker({
  rules,
  onChange,
}: {
  rules: IndicatorRule[];
  onChange: (rules: IndicatorRule[]) => void;
}) {
  const theme = useTheme();

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

  const togglePeriod = (target: IndicatorRule, period: KlinePeriod) => {
    onChange(
      rules.map((r) => {
        if (ruleKey(r) !== ruleKey(target)) return r;
        const cur = r.periods ?? ['daily'];
        const next = cur.includes(period) ? cur.filter((p) => p !== period) : [...cur, period];
        // 至少保留一个周期
        return { ...r, periods: next.length > 0 ? next : cur };
      })
    );
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
                <Text style={[styles.selectedLabel, { color: theme.text }]}>{ruleLabel(r)}</Text>
                <Pressable onPress={() => removeRule(r)} hitSlop={6}>
                  <Text style={[styles.removeBtn, { color: theme.textSecondary }]}>✕</Text>
                </Pressable>
              </View>
              {/* 周期选择 */}
              <View style={styles.periodRow}>
                {PERIOD_OPTS.map((p) => {
                  const on = (r.periods ?? ['daily']).includes(p.key);
                  return (
                    <Pressable key={p.key} onPress={() => togglePeriod(r, p.key)} hitSlop={4}>
                      <Text
                        style={[
                          styles.periodChip,
                          { color: on ? theme.tint : theme.textSecondary, fontWeight: on ? '700' : '400' },
                        ]}>
                        {p.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.emptyHint, { color: theme.textSecondary }]}>
          点下方指标添加条件，多条为「并且」关系
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
  selectedItem: { borderRadius: 8, padding: 8, gap: 6 },
  selectedTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedLabel: { fontSize: 13, fontWeight: '600' },
  removeBtn: { fontSize: 14, paddingHorizontal: 4 },
  periodRow: { flexDirection: 'row', gap: 12 },
  periodChip: { fontSize: 11 },
  group: { gap: 6 },
  groupLabel: { fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chipText: { fontSize: 12 },
});