import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { fetchFinancialBundle } from '@/lib/api/financial';
import { semanticColor } from '@/constants/theme';
import {
  LEVEL_LABEL,
  LEVEL_LABEL_EN,
  buildRatingReference,
  buildRiskReport,
  type RatingReference,
  type RiskItem,
  type RiskReport,
} from '@/lib/financial-risk';
import { useT } from '@/lib/i18n';

/**
 * 财务风险体检页（方案 A）+ 机构评级参考。
 *
 * 数据按需拉取：进入本页时才请求该股票的财务与评级数据（约 6 个并行请求），
 * 结果在会话内缓存，返回再进不重复拉。
 *
 * ⚠️ 页面底部必须展示免责声明：本页为**独立实现**，判据取自公开资料，
 * 不等同于通达信官方「扫雷宝」评分（其含资金面/消息面/主题面，无法复刻）。
 */

/** 会话内缓存（按 code），避免来回切页重复拉取 */
const bundleCache = new Map<string, Awaited<ReturnType<typeof fetchFinancialBundle>>>();

/** 分类 → i18n 键 */
const CATEGORY_KEY: Record<string, string> = {
  financial: 'risk_catFinancial',
  st: 'risk_catSt',
  market: 'risk_catMarket',
};

export default function RiskScreen() {
  const params = useLocalSearchParams<{ code: string; name?: string }>();
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { t, tf, lang } = useT();

  const code = params.code ?? '';
  const stockName = params.name ? decodeURIComponent(params.name) : code;

  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<RiskReport | null>(null);
  const [rating, setRating] = useState<RatingReference | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setFailed(false);
    try {
      const cached = bundleCache.get(code);
      const bundle = cached ?? (await fetchFinancialBundle(code));
      bundleCache.set(code, bundle);
      setReport(buildRiskReport(bundle, stockName));
      setRating(buildRatingReference(bundle));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [code, stockName]);

  useEffect(() => { load(); }, [load]);

  // 风险等级配色（高 → 低：红 → 橙 → 黄 → 绿）
  const levelColor = useCallback(
    (lv: RiskReport['level']) => {
      switch (lv) {
        case 'high': return semanticColor('danger', isDark);
        case 'mediumHigh': return '#F97316';
        case 'medium': return semanticColor('warning', isDark);
        case 'mediumLow': return '#84CC16';
        default: return semanticColor('success', isDark);
      }
    },
    [isDark]
  );

  const renderItem = (it: RiskItem) => {
    return (
      <View key={it.key} style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.itemHead}>
          <View style={[styles.itemDot, {
            backgroundColor: it.insufficient
              ? theme.textSecondary
              : it.hit ? semanticColor('danger', isDark) : semanticColor('success', isDark),
          }]} />
          <Text style={[styles.itemLabel, { color: theme.text }]} numberOfLines={2}>{it.label}</Text>
          <Text style={[styles.itemBadge, {
            color: it.insufficient ? theme.textSecondary
              : it.hit ? semanticColor('danger', isDark) : semanticColor('success', isDark),
          }]}>
            {it.insufficient
              ? t('risk_noDataItem')
              : it.hit ? t('risk_hit') : t('risk_ok')}
          </Text>
        </View>
        <Text style={[styles.itemActual, { color: theme.textSecondary }]}>
          {t('risk_actual')}：{it.actual ?? '—'}　·　{t('risk_rule')}：{it.threshold}
        </Text>
        {it.note ? (
          <Text style={[styles.itemNote, { color: theme.textSecondary }]}>{it.note}</Text>
        ) : null}
        <Text style={[styles.itemCat, { color: theme.textSecondary }]}>
          {t((CATEGORY_KEY[it.category] ?? 'risk_catFinancial') as never)}
          {it.hit && !it.insufficient ? `　-${it.penalty}` : ''}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: t('risk_title') }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 顶部：股票 + 安全分 */}
        <View style={[styles.hero, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.heroTop}>
            <Text style={[styles.stockName, { color: theme.text }]} numberOfLines={1}>{stockName}</Text>
            <Text style={[styles.stockCode, { color: theme.textSecondary }]}>{code}</Text>
          </View>
          {loading ? (
            <View style={styles.loadingBox}><ActivityIndicator /></View>
          ) : failed ? (
            <Pressable onPress={load}>
              <Text style={[styles.failText, { color: theme.tint }]}>
                {t('risk_loadFail')}
              </Text>
            </Pressable>
          ) : report ? (
            <>
              <View style={styles.scoreRow}>
                <View style={styles.scoreLeft}>
                  <Text style={[styles.scoreValue, { color: levelColor(report.level) }]}>{report.score}</Text>
                  <Text style={[styles.scoreUnit, { color: theme.textSecondary }]}>/ 100</Text>
                </View>
                <View style={[styles.levelChip, { backgroundColor: levelColor(report.level) }]}>
                  <Text style={styles.levelText}>
                    {lang === 'en' ? LEVEL_LABEL_EN[report.level] : LEVEL_LABEL[report.level]}
                  </Text>
                </View>
              </View>
              <Text style={[styles.heroMeta, { color: theme.textSecondary }]}>
                {t('risk_reportPeriod')} {report.reportDate ?? '—'}　·　
                {tf('risk_foundCount', { n: report.items.length })}
              </Text>
              {report.missing.length > 0 ? (
                <Text style={[styles.heroWarn, { color: semanticColor('warning', isDark) }]}>
                  {tf('risk_missingStatements', { n: report.missing.length })}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>

        {/* 机构评级参考 */}
        {rating ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              {t('risk_analystConsensus')}
            </Text>
            <View style={[styles.ratingCard, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.ratingGrid}>
                <View style={styles.ratingCell}>
                  <Text style={[styles.ratingNum, { color: theme.text }]}>{rating.orgCount}</Text>
                  <Text style={[styles.ratingLabel, { color: theme.textSecondary }]}>
                    {t('risk_instCount')}
                  </Text>
                </View>
                <View style={styles.ratingCell}>
                  <Text style={[styles.ratingNum, { color: semanticColor('danger', isDark) }]}>{rating.buyNum}</Text>
                  <Text style={[styles.ratingLabel, { color: theme.textSecondary }]}>
                    {t('risk_buy')}
                  </Text>
                </View>
                <View style={styles.ratingCell}>
                  <Text style={[styles.ratingNum, { color: '#F97316' }]}>{rating.addNum}</Text>
                  <Text style={[styles.ratingLabel, { color: theme.textSecondary }]}>
                    {t('risk_add')}
                  </Text>
                </View>
                <View style={styles.ratingCell}>
                  <Text style={[styles.ratingNum, { color: theme.text }]}>
                    {rating.avgScore?.toFixed(2) ?? '—'}
                  </Text>
                  <Text style={[styles.ratingLabel, { color: theme.textSecondary }]}>
                    {t('risk_avgScore')}
                  </Text>
                </View>
              </View>
              {rating.targetMin !== null && rating.targetMax !== null ? (
                <Text style={[styles.ratingTarget, { color: theme.textSecondary }]}>
                  {t('risk_targetPrice')}：
                  <Text style={{ color: theme.text }}>{rating.targetMin} ~ {rating.targetMax}</Text>
                </Text>
              ) : null}
              <Text style={[styles.ratingNote, { color: theme.textSecondary }]}>
                {t('risk_scoringNote')}
              </Text>
            </View>
          </View>
        ) : null}

        {/* 命中的风险项（置顶） */}
        {report && report.items.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: semanticColor('danger', isDark) }]}>
              {tf('risk_found', { n: report.items.length })}
            </Text>
            {report.items.map(renderItem)}
          </View>
        ) : report && !loading ? (
          <View style={styles.section}>
            <View style={[styles.cleanBox, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.cleanText, { color: semanticColor('success', isDark) }]}>
                {t('risk_noRisk')}
              </Text>
            </View>
          </View>
        ) : null}

        {/* 全部判据明细 */}
        {report ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              {t('risk_allChecks')}
            </Text>
            {report.all
              .filter((i) => !report.items.some((h) => h.key === i.key))
              .map(renderItem)}
          </View>
        ) : null}

        {/* 免责声明（必读） */}
        <View style={[styles.disclaimer, { borderColor: theme.border }]}>
          <Text style={[styles.disclaimerText, { color: theme.textSecondary }]}>
            {t('risk_disclaimer')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 18 },
  hero: { borderRadius: 14, padding: 16, gap: 8 },
  heroTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  stockName: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  stockCode: { fontSize: 13, fontVariant: ['tabular-nums'] },
  loadingBox: { height: 90, alignItems: 'center', justifyContent: 'center' },
  failText: { fontSize: 14, textAlign: 'center', paddingVertical: 30 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  scoreValue: { fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] },
  scoreUnit: { fontSize: 14 },
  levelChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  levelText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  heroMeta: { fontSize: 12 },
  heroWarn: { fontSize: 11 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, paddingHorizontal: 2 },
  item: { borderRadius: 12, padding: 12, gap: 5 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemDot: { width: 8, height: 8, borderRadius: 4 },
  itemLabel: { fontSize: 14, fontWeight: '600', flex: 1 },
  itemBadge: { fontSize: 12, fontWeight: '600' },
  itemActual: { fontSize: 11, lineHeight: 17 },
  itemNote: { fontSize: 11, lineHeight: 17 },
  itemCat: { fontSize: 10 },
  ratingCard: { borderRadius: 12, padding: 14, gap: 10 },
  ratingGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  ratingCell: { width: '25%', gap: 2 },
  ratingNum: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ratingLabel: { fontSize: 10 },
  ratingTarget: { fontSize: 12, fontVariant: ['tabular-nums'] },
  ratingNote: { fontSize: 10, lineHeight: 15 },
  cleanBox: { borderRadius: 12, padding: 16 },
  cleanText: { fontSize: 13, textAlign: 'center' },
  disclaimer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  disclaimerText: { fontSize: 10, lineHeight: 16 },
});