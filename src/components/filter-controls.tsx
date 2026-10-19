import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CAP_TIER_LABELS, type MarketCapTier, type SignalCondition } from '@/types/stock';

/** 简单分段选择器 */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  multi = false,
}: {
  options: { value: T; label: string }[];
  value: T[] | T | undefined;
  onChange: (next: T[] | T | undefined) => void;
  multi?: boolean;
}) {
  const theme = useTheme();
  const selected: string[] = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (v: T) => {
    if (multi) {
      const set = new Set(selected);
      if (set.has(v)) set.delete(v);
      else set.add(v);
      onChange(Array.from(set) as T[]);
    } else {
      onChange(selected.includes(v) ? undefined : v);
    }
  };

  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const active = selected.includes(o.value);
        return (
          <Pressable key={o.value} onPress={() => toggle(o.value)} hitSlop={4}>
            <View
              style={[
                styles.chip,
                { backgroundColor: active ? theme.tint : theme.backgroundElement },
              ]}>
              <ThemedText
                type={active ? 'smallBold' : 'small'}
                style={active ? styles.chipTextActive : undefined}
                themeColor={active ? undefined : 'textSecondary'}>
                {o.label}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 市值分层多选（补充规格 §3.4：仅 大盘/中盘/小盘 三档，含「全选」） */
export function CapTierPicker({
  value,
  onChange,
}: {
  value: MarketCapTier[] | undefined;
  onChange: (v: MarketCapTier[] | undefined) => void;
}) {
  const theme = useTheme();
  const ALL: MarketCapTier[] = ['large', 'mid', 'small'];
  const allOn = value && ALL.every((t) => value.includes(t));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <Chips<MarketCapTier>
        multi
        value={value}
        onChange={(v) => onChange(v as MarketCapTier[] | undefined)}
        options={[
          { value: 'large', label: CAP_TIER_LABELS.large },
          { value: 'mid', label: CAP_TIER_LABELS.mid },
          { value: 'small', label: CAP_TIER_LABELS.small },
        ]}
      />
      <Pressable onPress={() => onChange(allOn ? undefined : ALL)} hitSlop={6}>
        <Text style={{ fontSize: 13, color: allOn ? theme.tint : theme.textSecondary }}>全选</Text>
      </Pressable>
    </View>
  );
}

/** 技术信号勾选项 */
export interface SignalOption {
  key: keyof SignalCondition;
  label: string;
  /** 是否为「附加参数」型信号（如放量），勾选时用默认参数 */
  volumeSurge?: boolean;
}

export const SIGNAL_OPTIONS: SignalOption[] = [
  { key: 'maBullish', label: '均线多头' },
  { key: 'maBearish', label: '均线空头' },
  { key: 'macdGoldenCross', label: 'MACD金叉' },
  { key: 'macdDeadCross', label: 'MACD死叉' },
  { key: 'macdHistTurnPositive', label: 'MACD柱转正' },
  { key: 'kdjGoldenCross', label: 'KDJ金叉' },
  { key: 'kdjOversold', label: 'KDJ超卖' },
  { key: 'kdjOverbought', label: 'KDJ超买' },
  { key: 'rsiOversold', label: 'RSI超卖' },
  { key: 'rsiOverbought', label: 'RSI超买' },
  { key: 'aboveBollMid', label: '站上布林中轨' },
  { key: 'belowBollLower', label: '跌破布林下轨' },
  { key: 'volumeSurge', label: '放量(5日×2)', volumeSurge: true },
];

/* ------------------------------------------------------------------ *
 * BBI 分组（按界面规格：周线/日线两组，组内多选）
 * ------------------------------------------------------------------ */

export interface BBIOption {
  key: keyof SignalCondition;
  label: string;
  group: 'weekly' | 'daily';
}

export const BBI_OPTIONS: BBIOption[] = [
  { key: 'weeklyCloseGtBBI', label: '收盘 > BBI', group: 'weekly' },
  { key: 'weeklyBull', label: '红柱(收>开)', group: 'weekly' },
  { key: 'weeklyBBIGtMA26', label: 'BBI > MA26', group: 'weekly' },
  { key: 'dailyCloseGtBBI', label: '收盘 > BBI', group: 'daily' },
  { key: 'daily4CloseGtBBI', label: '近4根连续收盘 > BBI', group: 'daily' },
  { key: 'dailyBBIGtMA26', label: 'BBI > MA26', group: 'daily' },
];

export function BBIPicker({
  value,
  onChange,
}: {
  value: SignalCondition | undefined;
  onChange: (v: SignalCondition | undefined) => void;
}) {
  const theme = useTheme();
  const isOn = (k: keyof SignalCondition) => value?.[k] === true;

  const toggle = (k: keyof SignalCondition) => {
    const next: SignalCondition = { ...(value ?? {}) };
    if (next[k]) delete next[k];
    else (next as Record<string, unknown>)[k] = true;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const renderGroup = (group: 'weekly' | 'daily', label: string) => (
    <View style={styles.bbiGroup}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.bbiGroupLabel}>
        {label}
      </ThemedText>
      <View style={styles.chipRow}>
        {BBI_OPTIONS.filter((o) => o.group === group).map((o) => {
          const on = isOn(o.key);
          return (
            <Pressable key={String(o.key)} onPress={() => toggle(o.key)} hitSlop={4}>
              <View
                style={[
                  styles.chip,
                  { backgroundColor: on ? theme.tint : theme.backgroundElement },
                ]}>
                <ThemedText
                  type={on ? 'smallBold' : 'small'}
                  style={on ? styles.chipTextActive : undefined}
                  themeColor={on ? undefined : 'textSecondary'}>
                  {o.label}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.bbiBox}>
      {renderGroup('weekly', '周线')}
      {renderGroup('daily', '日线')}
    </View>
  );
}

export function SignalPicker({
  value,
  onChange,
}: {
  value: SignalCondition | undefined;
  onChange: (v: SignalCondition | undefined) => void;
}) {
  const theme = useTheme();
  const active = (k: keyof SignalCondition): boolean => {
    if (!value) return false;
    const v = value[k];
    return v === true || (typeof v === 'object' && v !== null);
  };

  const toggle = (opt: SignalOption) => {
    const next: SignalCondition = { ...(value ?? {}) };
    if (active(opt.key)) {
      delete next[opt.key];
    } else if (opt.volumeSurge) {
      next.volumeSurge = { days: 5, multiple: 2 };
    } else {
      (next as Record<string, unknown>)[opt.key] = true;
    }
    const hasAny = Object.keys(next).length > 0;
    onChange(hasAny ? next : undefined);
  };

  return (
    <View style={styles.chipRow}>
      {SIGNAL_OPTIONS.map((o) => {
        const on = active(o.key);
        return (
          <Pressable key={String(o.key)} onPress={() => toggle(o)} hitSlop={4}>
            <View
              style={[
                styles.chip,
                { backgroundColor: on ? theme.tint : theme.backgroundElement },
              ]}>
              <ThemedText
                type={on ? 'smallBold' : 'small'}
                style={on ? styles.chipTextActive : undefined}
                themeColor={on ? undefined : 'textSecondary'}>
                {o.label}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 排除条件多选（ST / 科创板 / 创业板 / 北交所 / 银行） */
export type ExclusionKey = 'excludeST' | 'excludeKCB' | 'excludeChiNext' | 'excludeBSE' | 'excludeBank';

export const EXCLUSION_OPTIONS: { value: ExclusionKey; label: string }[] = [
  { value: 'excludeST', label: '排除ST' },
  { value: 'excludeKCB', label: '排除科创板' },
  { value: 'excludeChiNext', label: '排除创业板' },
  { value: 'excludeBSE', label: '排除北交所' },
  { value: 'excludeBank', label: '排除银行' },
];

export function ExclusionPicker({
  value,
  onChange,
}: {
  value: Partial<Record<ExclusionKey, boolean>> | undefined;
  onChange: (v: Partial<Record<ExclusionKey, boolean>> | undefined) => void;
}) {
  const theme = useTheme();
  const active = (k: ExclusionKey) => !!value?.[k];

  const toggle = (k: ExclusionKey) => {
    const next = { ...(value ?? {}) };
    if (next[k]) delete next[k];
    else next[k] = true;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  return (
    <View style={styles.chipRow}>
      {EXCLUSION_OPTIONS.map((o) => {
        const on = active(o.value);
        return (
          <Pressable key={o.value} onPress={() => toggle(o.value)} hitSlop={4}>
            <View
              style={[
                styles.chip,
                { backgroundColor: on ? theme.tint : theme.backgroundElement },
              ]}>
              <ThemedText
                type={on ? 'smallBold' : 'small'}
                style={on ? styles.chipTextActive : undefined}
                themeColor={on ? undefined : 'textSecondary'}>
                {o.label}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 小节标题 */
export function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <ThemedText type="smallBold">{children}</ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.three,
  },
  chipTextActive: { color: '#ffffff' },
  bbiBox: { gap: 10 },
  bbiGroup: { gap: 6 },
  bbiGroupLabel: { fontSize: 12 },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
});