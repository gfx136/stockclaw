import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { QuoteColors, fmtMoney, fmtPrice, upDownColor } from '@/lib/format';
import type { IndicatorSeries, KlineBar } from '@/types/stock';

interface Props {
  bars: KlineBar[];
  width: number;
  height?: number;
  /** 叠加均线周期；空则不画 */
  maOverlay?: number[];
  /** 是否画成交量副图 */
  showVolume?: boolean;
  series?: IndicatorSeries;
  /** 深色主题下网格线颜色 */
  gridColor?: string;
  axisColor?: string;
}

/**
 * K 线蜡烛图（自绘 SVG）。
 *
 * 布局：主图（蜡烛 + 均线叠加）在上，成交量副图在下，中间留 8px 间隙。
 * 采用**等宽分配**（不按时间间隔），这样停牌造成的空档不会挤压图形——
 * 与国内行情软件一致。
 *
 * ⚠️ 涨红跌绿（A 股口径）。
 */
export function CandleChart({
  bars,
  width,
  height = 260,
  maOverlay = [5, 10, 20],
  showVolume = true,
  series,
  gridColor = '#3A3D42',
  axisColor = '#8A8F98',
}: Props) {
  const PAD_LEFT = 4;
  const PAD_RIGHT = 44; // 右侧留价格轴
  const PAD_TOP = 8;
  const GAP = 10;
  const VOL_H = 50;

  const geom = useMemo(() => {
    if (bars.length === 0) return null;
    const plotW = Math.max(10, width - PAD_LEFT - PAD_RIGHT);
    const mainH = Math.max(40, height - PAD_TOP - GAP - (showVolume ? VOL_H : 0));
    const n = bars.length;

    let hi = -Infinity;
    let lo = Infinity;
    for (const b of bars) {
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
    }
    // 均线极值也纳入范围，避免线出框
    if (series) {
      for (const p of maOverlay) {
        const arr = series.ma[p];
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (v === undefined) continue;
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }
    }
    const padRange = (hi - lo) * 0.04 || hi * 0.02 || 1;
    const top = hi + padRange;
    const bot = Math.max(0.01, lo - padRange);
    const span = top - bot;

    const stepX = plotW / n;
    const cw = Math.max(1, Math.min(10, stepX * 0.68));

    const yOf = (v: number) => PAD_TOP + ((top - v) / span) * mainH;
    const xOf = (i: number) => PAD_LEFT + i * stepX + stepX / 2;

    // 成交量范围
    let vmax = 0;
    for (const b of bars) if (b.volume > vmax) vmax = b.volume;
    const volTop = height - VOL_H;
    const volH = VOL_H;

    // 价格轴刻度（4 档）
    const ticks: { y: number; label: string }[] = [];
    for (let k = 0; k <= 4; k++) {
      const v = top - (span * k) / 4;
      ticks.push({ y: yOf(v), label: fmtPrice(v) });
    }

    return { plotW, mainH, n, stepX, cw, yOf, xOf, vmax, volTop, volH, ticks };
  }, [bars, width, height, showVolume, series, maOverlay]);

  if (!geom) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <ThemedText type="small" themeColor="textSecondary">
          暂无 K 线数据
        </ThemedText>
      </View>
    );
  }

  const { cw, xOf, yOf, vmax, volTop, volH, ticks } = geom;

  /** 均线折线路径（跳过 undefined） */
  const maPath = (arr: (number | undefined)[]): string => {
    let d = '';
    let started = false;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === undefined) {
        started = false;
        continue;
      }
      const cmd = started ? 'L' : 'M';
      d += `${cmd}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
      started = true;
    }
    return d;
  };

  const maColors: Record<number, string> = {
    5: '#F5A623',
    10: '#4DA3F5',
    20: '#C77DFF',
    60: '#8A8F98',
  };

  return (
    <View>
      <Svg width={width} height={height}>
        {/* 网格 + 价格轴 */}
        <G>
          {ticks.map((t, i) => (
            <G key={i}>
              <Line
                x1={0}
                y1={t.y}
                x2={width - PAD_RIGHT_SCALE}
                y2={t.y}
                stroke={gridColor}
                strokeWidth={StyleSheet.hairlineWidth}
                strokeDasharray="2,4"
              />
              <SvgText
                x={width - PAD_RIGHT_SCALE + 4}
                y={t.y + 3}
                fill={axisColor}
                fontSize={9}
                textAnchor="start">
                {t.label}
              </SvgText>
            </G>
          ))}
        </G>

        {/* 蜡烛 */}
        <G>
          {bars.map((b, i) => {
            const rising = b.close >= b.open;
            const color = rising ? QuoteColors.up : QuoteColors.down;
            const x = xOf(i);
            const yHigh = yOf(b.high);
            const yLow = yOf(b.low);
            const yOpen = yOf(b.open);
            const yClose = yOf(b.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1, Math.abs(yClose - yOpen));
            return (
              <G key={`${b.date}-${i}`}>
                {/* 影线 */}
                <Line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1} />
                {/* 实体：涨用空心（描边），跌用实心——国内软件惯例 */}
                <Rect
                  x={x - cw / 2}
                  y={bodyTop}
                  width={cw}
                  height={bodyH}
                  fill={rising ? 'transparent' : color}
                  stroke={color}
                  strokeWidth={1}
                />
              </G>
            );
          })}
        </G>

        {/* 均线叠加 */}
        {series ? (
          <G>
            {maOverlay.map((p) => {
              const arr = series.ma[p];
              if (!arr) return null;
              const d = maPath(arr);
              if (!d) return null;
              return (
                <Path
                  key={p}
                  d={d}
                  stroke={maColors[p] ?? '#8A8F98'}
                  strokeWidth={1.2}
                  fill="none"
                />
              );
            })}
          </G>
        ) : null}

        {/* 成交量副图 */}
        {showVolume && vmax > 0 ? (
          <G>
            {bars.map((b, i) => {
              const rising = b.close >= b.open;
              const color = rising ? QuoteColors.up : QuoteColors.down;
              const h = Math.max(1, (b.volume / vmax) * (volH - 2));
              const x = xOf(i);
              return (
                <Rect
                  key={`v-${b.date}-${i}`}
                  x={x - cw / 2}
                  y={volTop + (volH - h)}
                  width={cw}
                  height={h}
                  fill={color}
                  opacity={0.75}
                />
              );
            })}
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

/** 价格轴宽度（与 CandleChart 内部一致） */
const PAD_RIGHT_SCALE = 44;

/** 均线图例 */
export function MALegend({
  periods,
  series,
}: {
  periods: number[];
  series?: IndicatorSeries;
}) {
  const colors: Record<number, string> = {
    5: '#F5A623',
    10: '#4DA3F5',
    20: '#C77DFF',
    60: '#8A8F98',
  };
  const lastVal = (arr?: (number | undefined)[]): string => {
    if (!arr) return '—';
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== undefined) return fmtPrice(arr[i] as number);
    }
    return '—';
  };
  return (
    <View style={styles.legend}>
      {periods.map((p) => (
        <View key={p} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors[p] }]} />
          <ThemedText type="small" style={[styles.legendText, { color: colors[p] }]}>
            MA{p} {lastVal(series?.ma[p])}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** 指标数值条（详情页下方指标区） */
export function IndicatorBar({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.indItem}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.indLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={color ? { color } : undefined}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, paddingVertical: Spacing.two },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 11, lineHeight: 16 },
  indItem: { minWidth: 76, gap: Spacing.half },
  indLabel: { fontSize: 11, lineHeight: 14 },
});