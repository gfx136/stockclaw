import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CapTierPicker, ExclusionPicker, SectionTitle } from '@/components/filter-controls';
import { RulePicker } from '@/components/rule-picker';
import { ThemedText } from '@/components/themed-text';
import { OfflineBanner } from '@/components/offline-banner';
import { TouchTarget } from '@/components/touch-target';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { hasAnyRules } from '@/lib/filter-engine';
import {
  getFilterRunState,
  runStageText,
  startFilterRun,
  subscribeFilterRun,
} from '@/lib/filter-runner';
import { loadFilterSets, saveFilterSet, type SavedFilterSet } from '@/lib/filter-sets';
import { getFilterState, setFilter, subscribeFilter } from '@/lib/filter-store';
import type { FilterSet, MarketCapTier } from '@/types/stock';

/**
 * 选股条件面板（产品规格 2.2，底部弹出 Sheet）。
 * 基础面（区间/市值档位/缺口）+ 排除条件 + 技术指标规则（含适用周期）。
 * 运行后结果写 filter-store → 关弹层 → 跳「筛选结果」页。
 */
export default function FilterScreen() {
  const theme = useTheme();
  const { t, tf } = useT();
  const router = useRouter();

  const storeState = useSyncExternalStore(subscribeFilter, getFilterState, getFilterState);
  const filter = storeState.filter;
  // 运行状态由模块级执行器提供：面板关掉也继续跑（后台运行）
  const runState = useSyncExternalStore(subscribeFilterRun, getFilterRunState, getFilterRunState);
  const running = runState.running;

  const [msg, setMsg] = useState<string | null>(null);
  const [savedSets, setSavedSets] = useState<SavedFilterSet[]>([]);
  /** 用户是否点了「后台运行」——是的话跑完不自动跳结果页 */
  const [bgRun, setBgRun] = useState(false);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    (async () => setSavedSets(await loadFilterSets()))();
  }, []);

  const patch = useCallback((p: Partial<FilterSet>) => {
    setFilter({ ...getFilterState().filter, ...p });
  }, []);

  const num = (t: string): number | undefined => {
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : undefined;
  };

  const run = useCallback(() => {
    setMsg(null);
    setBgRun(false);
    startFilterRun();
  }, []);

  // 前台跑完 → 自动跳到结果页；后台运行则不打扰
  useEffect(() => {
    if (bgRun) return;
    if (runState.stage !== 'done') return;
    if ((runState.finishedAt ?? 0) <= mountedAt.current) return; // 进页面时看到的旧结果不算
    const id = setTimeout(() => {
      router.back();
      router.navigate('/(tabs)/results');
    }, 450);
    return () => clearTimeout(id);
  }, [runState.stage, runState.finishedAt, bgRun, router]);

  const goBackground = useCallback(() => {
    setBgRun(true);
    router.back();
  }, [router]);

  const clearAll = () => {
    setFilter({});
    setMsg(null);
  };

  /** 保存为常用条件 */
  const onSaveSet = () => {
    Alert.prompt?.(t('filter_savePreset'), t('filter_presetNamePlaceholder'), async (name) => {
      if (!name?.trim()) return;
      setSavedSets(await saveFilterSet(name.trim(), filter));
    }) ??
      // Android 无 Alert.prompt，用固定名
      (async () => {
        const name = tf('filter_presetDefault', { n: savedSets.length + 1 });
        setSavedSets(await saveFilterSet(name, filter));
      })();
  };

  const applySet = (s: SavedFilterSet) => {
    setFilter(s.filter);
    setMsg(null);
  };

  const hasKlineConds = hasAnyRules(filter) || filter.gapMin !== undefined;

  return (
    // ⚠️ 本页是 modal presentation，外层 Stack 已提供系统 header（含安全区）。
    //    故 edges 只取 'bottom'——若再取 'top' 会与 header 叠加成双重留白。
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      {/* 顶部操作行：清空 / 运行（标题已由系统 header 显示，此处不再重复） */}
      <View style={styles.topBar}>
        <TouchTarget onPress={clearAll}>
          <ThemedText type="small" themeColor="textSecondary">{t('filter_clear')}</ThemedText>
        </TouchTarget>
        <View style={styles.topSpacer} />
        {running ? (
          <TouchTarget onPress={goBackground}>
            <ThemedText type="small" style={{ color: theme.tint }}>{t('filter_bgRun')}</ThemedText>
          </TouchTarget>
        ) : (
          <TouchTarget onPress={run}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>{t('filter_run')}</ThemedText>
          </TouchTarget>
        )}
      </View>

      <OfflineBanner />

      {/* 运行进度条（用户反馈3）：阶段文案 + 百分比 + 进度条
          点右上角「后台运行」可关掉本面板，筛选在后台继续，结果页顶部会显示同一条进度 */}
      {running || runState.stage === 'error' ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressHead}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.progressText} numberOfLines={1}>
              {runState.stage === 'error' && runState.message === 'EMPTY'
                ? t('filter_noData')
                : runStageText(runState, t, tf)}
            </ThemedText>
            {running ? (
              <ThemedText type="small" themeColor="textSecondary">{runState.percent}%</ThemedText>
            ) : null}
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

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* 常用条件 */}
        {savedSets.length > 0 ? (
          <View style={styles.block}>
            <SectionTitle>{t('filter_presets')}</SectionTitle>
            <View style={styles.chipRow}>
              {savedSets.map((s) => (
                <TouchTarget key={s.name} onPress={() => applySet(s)}>
                  <View style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                    <Text style={[styles.chipText, { color: theme.text }]}>{s.name}</Text>
                  </View>
                </TouchTarget>
              ))}
            </View>
          </View>
        ) : null}

        {/* 排除条件 */}
        <View style={styles.block}>
          <SectionTitle hint={t('filter_excludeHint')}>{t('filter_exclude')}</SectionTitle>
          <ExclusionPicker
            value={{
              excludeST: filter.excludeST,
              excludeKCB: filter.excludeKCB,
              excludeChiNext: filter.excludeChiNext,
              excludeBSE: filter.excludeBSE,
              excludeBank: filter.excludeBank,
            }}
            onChange={(v) => patch({
              excludeST: v?.excludeST,
              excludeKCB: v?.excludeKCB,
              excludeChiNext: v?.excludeChiNext,
              excludeBSE: v?.excludeBSE,
              excludeBank: v?.excludeBank,
            })}
          />
        </View>

        {/* 市值档位 */}
        <View style={styles.block}>
          <SectionTitle hint={t('filter_capTierHint')}>{t('filter_capTier')}</SectionTitle>
          <CapTierPicker
            value={filter.capTiers}
            onChange={(v) => patch({ capTiers: v as MarketCapTier[] | undefined })}
          />
        </View>

        {/* 基础面区间 */}
        <View style={styles.block}>
          <SectionTitle hint={t('filter_leaveBlank')}>{t('filter_marketRange')}</SectionTitle>
          <RangeInput label={t('filter_price')} min={filter.priceRange?.min} max={filter.priceRange?.max}
            onMin={(v) => patch({ priceRange: { ...filter.priceRange, min: num(v) } })}
            onMax={(v) => patch({ priceRange: { ...filter.priceRange, max: num(v) } })} />
          <RangeInput label={t('filter_change')} min={filter.changeRange?.min} max={filter.changeRange?.max}
            onMin={(v) => patch({ changeRange: { ...filter.changeRange, min: num(v) } })}
            onMax={(v) => patch({ changeRange: { ...filter.changeRange, max: num(v) } })} />
          <RangeInput label={t('filter_turnover')} min={filter.turnoverRange?.min} max={filter.turnoverRange?.max}
            onMin={(v) => patch({ turnoverRange: { ...filter.turnoverRange, min: num(v) } })}
            onMax={(v) => patch({ turnoverRange: { ...filter.turnoverRange, max: num(v) } })} />
          <RangeInput label={t('filter_marketCap')} min={filter.marketCapRange?.min !== undefined ? filter.marketCapRange.min / 1e4 : undefined} max={filter.marketCapRange?.max !== undefined ? filter.marketCapRange.max / 1e4 : undefined}
            onMin={(v) => patch({ marketCapRange: { ...filter.marketCapRange, min: num(v) ? num(v)! * 1e4 : undefined } })}
            onMax={(v) => patch({ marketCapRange: { ...filter.marketCapRange, max: num(v) ? num(v)! * 1e4 : undefined } })} />
          <RangeInput label={t('filter_floatCap')} min={filter.floatCapRange?.min !== undefined ? filter.floatCapRange.min / 1e4 : undefined} max={filter.floatCapRange?.max !== undefined ? filter.floatCapRange.max / 1e4 : undefined}
            onMin={(v) => patch({ floatCapRange: { ...filter.floatCapRange, min: num(v) ? num(v)! * 1e4 : undefined } })}
            onMax={(v) => patch({ floatCapRange: { ...filter.floatCapRange, max: num(v) ? num(v)! * 1e4 : undefined } })} />
          <RangeInput label={t('filter_amount')} min={filter.amountRange?.min !== undefined ? filter.amountRange.min / 1e4 : undefined} max={filter.amountRange?.max !== undefined ? filter.amountRange.max / 1e4 : undefined}
            onMin={(v) => patch({ amountRange: { ...filter.amountRange, min: num(v) ? num(v)! * 1e4 : undefined } })}
            onMax={(v) => patch({ amountRange: { ...filter.amountRange, max: num(v) ? num(v)! * 1e4 : undefined } })} />
          <RangeInput label={t('filter_gapMin')} min={filter.gapMin}
            onMin={(v) => patch({ gapMin: num(v) })}
            onMax={() => {}} single />
          {/* 仅自选 */}
          <View style={styles.switchRow}>
            <ThemedText type="small" style={styles.switchLabel}>{t('filter_onlyFav')}</ThemedText>
            <Switch
              value={filter.onlyFavorites ?? false}
              onValueChange={(v) => patch({ onlyFavorites: v || undefined })}
            />
          </View>
        </View>

        {/* 技术指标 */}
        <View style={styles.block}>
          <SectionTitle hint={t('filter_indicatorHint')}>{t('filter_indicator')}</SectionTitle>
          <RulePicker
            rules={filter.rules ?? []}
            onChange={(rules) => patch({ rules: rules.length > 0 ? rules : undefined })}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.tip}>
            {t('filter_indicatorNote')}
          </ThemedText>
        </View>

        {/* 保存条件 */}
        <View style={styles.block}>
          <Pressable onPress={onSaveSet}>
            <View style={[styles.saveBtn, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.saveBtnText, { color: theme.tint }]}>{t('filter_savePreset')}</Text>
            </View>
          </Pressable>
        </View>

        {msg ? (
          <View style={[styles.msgBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">{msg}</ThemedText>
          </View>
        ) : null}

        {hasKlineConds ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.klineNote}>
            {t('filter_indicatorNote2')}
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 区间输入行（single=只有最小值） */
function RangeInput({ label, min, max, onMin, onMax, single }: {
  label: string; min?: number; max?: number;
  onMin: (t: string) => void; onMax: (t: string) => void; single?: boolean;
}) {
  const theme = useTheme();
  const { t, tf } = useT();
  return (
    <View style={styles.rangeRow}>
      <ThemedText type="small" style={styles.rangeLabel}>{label}</ThemedText>
      <TextInput defaultValue={min !== undefined ? String(min) : ''} onChangeText={onMin}
        placeholder={t('filter_minPlaceholder')} placeholderTextColor={theme.textSecondary} keyboardType="numeric"
        style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]} />
      {!single ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">~</ThemedText>
          <TextInput defaultValue={max !== undefined ? String(max) : ''} onChangeText={onMax}
            placeholder={t('filter_maxPlaceholder')} placeholderTextColor={theme.textSecondary} keyboardType="numeric"
            style={[styles.rangeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    // 左右内边距收到 6：按钮自带 44pt 命中区，视觉上的 16pt 边距由按钮内部留白补齐
    paddingHorizontal: 6,
  },
  topSpacer: { flex: 1 },
  progressWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  progressText: { flex: 1, marginRight: 8 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 48, paddingTop: 4 },
  block: { paddingHorizontal: 16, marginBottom: 22 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  chipText: { fontSize: 13 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rangeLabel: { width: 96 },
  rangeInput: { flex: 1, height: 44, borderRadius: 8, paddingHorizontal: 12, fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: {},
  tip: { marginTop: 8, lineHeight: 20 },
  saveBtn: { height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 14, fontWeight: '600' },
  msgBox: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 8 },
  klineNote: { paddingHorizontal: 16, lineHeight: 18 },
});