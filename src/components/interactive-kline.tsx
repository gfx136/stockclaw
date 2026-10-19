import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { QuoteColors, fmtMoney, fmtPercent, fmtPrice, upDownColor } from '@/lib/format';
import type { IndicatorSeries, KlineBar } from '@/types/stock';

/**
 * 交互式 K 线蜡烛图（产品规格 2.5 / 4.4）。
 *
 * 手势：
 * - 双指缩放：按时间轴缩放
 * - 单指横滑：平移浏览历史
 * - 点按：十字光标 + 该根 OHLCV 浮层（再点取消）
 *
 * 降级：单根宽度 < 2px 时蜡烛自动降级为收盘价折线（「缩到最小自动变线」）。
 * 副图可切换：成交量 / 成交额 / MACD / KDJ / RSI。
 * 主图叠加：MA（多周期可勾）/ BOLL / BBI。
 * ⚠️ 涨红跌绿（A 股口径）。等宽分配，停牌空档不挤压图形。
 */

const PAD_LEFT = 4;
const PAD_RIGHT = 46;
const PAD_TOP = 8;
const GAP = 10;
const SUB_H = 78;

const MIN_VISIBLE = 15;
const LINE_MODE_CW = 2;

const MA_COLORS: Record<number, string> = {
  5: '#F5A623',
  10: '#4DA3F5',
  20: '#C77DFF',
  60: '#8A8F98',
};

type SubMode = 'volume' | 'amount' | 'macd' | 'kdj' | 'rsi';
export type { SubMode };

interface Props {
  bars: KlineBar[];
  width: number;
  height?: number;
  series?: IndicatorSeries;
  maOverlay?: number[];
  showBoll?: boolean;
  showBbi?: boolean;
  defaultVisible?: number;
  gridColor?: string;
  axisColor?: string;
  textColor?: string;
  /** 副图模式（受控，由详情页选项行/指标浮层控制） */
  subMode?: SubMode;
  /** 复位令牌：值变化时恢复默认根数并右对齐最新（规格 §2.4 复位） */
  resetToken?: number;
  /** 长按选中的 bar 索引变化回调（详情页速览联动） */
  onSelectBar?: (index: number | null) => void;
}

export function InteractiveKline({
  bars,
  width,
  height = 320,
  series,
  maOverlay = [5, 10, 20],
  showBoll = false,
  showBbi = false,
  defaultVisible = 100,
  gridColor = '#3A3D42',
  axisColor = '#8A8F98',
  textColor = '#8A8F98',
  subMode: controlledSubMode,
  resetToken,
  onSelectBar,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(defaultVisible);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [internalSub, setInternalSub] = useState<SubMode>('volume');
  const subMode = controlledSubMode ?? internalSub;

  // 复位令牌：变化时恢复默认根数并右对齐最新（规格 §2.4 复位）
  const resetRef = useRef(resetToken);
  useEffect(() => {
    if (resetRef.current !== resetToken) {
      resetRef.current = resetToken;
      setVisibleCount(defaultVisible);
      setScrollOffset(0);
      setSelected(null);
    }
  }, [resetToken, defaultVisible]);

  // 选中 bar 变化时通知外部（详情页速览联动）
  useEffect(() => {
    onSelectBar?.(selected);
  }, [selected, onSelectBar]);

  const total = bars.length;
  const endIdx = Math.max(0, Math.min(total, total - scrollOffset));
  const startIdx = Math.max(0, endIdx - visibleCount);
  const visBars = useMemo(() => bars.slice(startIdx, endIdx), [bars, startIdx, endIdx]);
  const n = visBars.length;

  const baseVisible = useRef(visibleCount);
  const baseOffset = useRef(scrollOffset);

  const geom = useMemo(() => {
    if (n === 0) return null;
    const plotW = Math.max(10, width - PAD_LEFT - PAD_RIGHT);
    const mainH = Math.max(40, height - PAD_TOP - GAP - SUB_H);

    let hi = -Infinity;
    let lo = Infinity;
    for (const b of visBars) {
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
    }
    const absorb = (arr?: (number | undefined)[]) => {
      if (!arr) return;
      for (let i = startIdx; i < endIdx; i++) {
        const v = arr[i];
        if (v === undefined) continue;
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
    };
    if (series) {
      for (const p of maOverlay) absorb(series.ma[p]);
      if (showBoll) {
        absorb(series.boll.upper);
        absorb(series.boll.lower);
      }
      if (showBbi) absorb(series.bbi);
    }
    const padRange = (hi - lo) * 0.04 || hi * 0.02 || 1;
    const top = hi + padRange;
    const bot = Math.max(0.0001, lo - padRange);
    const span = top - bot;

    const stepX = plotW / n;
    const cw = Math.max(0.5, stepX * 0.68);
    const asLine = stepX < LINE_MODE_CW;
    const yOf = (v: number) => PAD_TOP + ((top - v) / span) * mainH;
    const xOf = (i: number) => PAD_LEFT + i * stepX + stepX / 2;

    // 副图数据范围
    const subVal = (b: KlineBar, i: number): number => {
      const gi = startIdx + i;
      switch (subMode) {
        case 'volume': return b.volume;
        case 'amount': return b.amount ?? b.volume * b.close;
        case 'macd': return series?.macd.hist[gi] ?? 0;
        case 'kdj': return series?.kdj.j[gi] ?? 0;
        case 'rsi': return series?.rsi[14]?.[gi] ?? 0;
      }
    };
    let subMax = 0;
    let subMin = 0;
    const absorbSub = (v?: number) => {
      if (v === undefined) return;
      if (v > subMax) subMax = v;
      if (v < subMin) subMin = v;
    };
    for (let i = 0; i < n; i++) absorbSub(subVal(visBars[i], i));
    if (subMode === 'macd' && series) {
      for (let i = startIdx; i < endIdx; i++) {
        absorbSub(series.macd.dif[i]);
        absorbSub(series.macd.dea[i]);
      }
    }
    if (subMode === 'kdj' && series) {
      for (let i = startIdx; i < endIdx; i++) {
        absorbSub(series.kdj.k[i]);
        absorbSub(series.kdj.d[i]);
      }
    }
    if (subMode === 'rsi' && series) {
      for (let i = startIdx; i < endIdx; i++) absorbSub(series.rsi[6]?.[i]);
    }
    const subAbsMax = Math.max(Math.abs(subMin), Math.abs(subMax)) || 1;
    const subTop = height - SUB_H;
    const subYOf = (v: number) => subTop + SUB_H / 2 - (v / subAbsMax) * (SUB_H / 2 - 2);

    const ticks: { y: number; label: string }[] = [];
    for (let k = 0; k <= 4; k++) {
      const v = top - (span * k) / 4;
      ticks.push({ y: yOf(v), label: fmtPrice(v) });
    }

    return { plotW, mainH, stepX, cw, asLine, yOf, xOf, subYOf, subTop, subAbsMax, ticks, subVal };
  }, [n, visBars, width, height, series, maOverlay, showBoll, showBbi, startIdx, endIdx, subMode]);

  if (!geom) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={{ color: axisColor, fontSize: 12 }}>暂无 K 线数据</Text>
      </View>
    );
  }

  const { stepX, cw, asLine, yOf, xOf, subYOf, subTop, ticks, subVal } = geom;

  // —— 手势（runOnJS 回 JS 线程，ref 读最新值） ——
  const stepXRef = useRef(stepX);
  stepXRef.current = stepX;
  const startIdxRef = useRef(startIdx);
  startIdxRef.current = startIdx;
  const nRef = useRef(n);
  nRef.current = n;
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  const scrollOffsetRef = useRef(scrollOffset);
  scrollOffsetRef.current = scrollOffset;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const clampVisible = (v: number) => Math.max(MIN_VISIBLE, Math.min(total, Math.round(v)));
  const clampOffset = (v: number) => Math.max(0, Math.min(total - 1, Math.round(v)));

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart(() => {
          baseVisible.current = visibleCountRef.current;
        })
        .onUpdate((e) => {
          setVisibleCount(clampVisible(baseVisible.current / e.scale));
        }),
    [total]
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-8, 8])
        .onStart(() => {
          baseOffset.current = scrollOffsetRef.current;
        })
        .onUpdate((e) => {
          const deltaBars = -e.translationX / stepXRef.current;
          setScrollOffset(clampOffset(baseOffset.current + deltaBars));
        }),
    [total]
  );

  const locateAt = (x: number) => {
    const idxInView = Math.floor((x - PAD_LEFT) / stepXRef.current);
    const idx = Math.max(0, Math.min(nRef.current - 1, idxInView));
    setSelected(startIdxRef.current + idx);
  };

  // 点按：定位十字光标；已有选中再点则取消
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .maxDistance(10)
        .onEnd((e, ok) => {
          if (!ok) return;
          if (selectedRef.current !== null) setSelected(null);
          else locateAt(e.x);
        }),
    []
  );

  const composed = useMemo(
    () => Gesture.Race(Gesture.Simultaneous(pinch, pan), tap),
    [pinch, pan, tap]
  );

  const selBar = selected !== null && selected >= 0 && selected < total ? bars[selected] : null;

  const linePath = (arr: (number | undefined)[], yFn: (v: number) => number): string => {
    let d = '';
    let started = false;
    for (let i = startIdx; i < endIdx; i++) {
      const v = arr[i];
      if (v === undefined) {
        started = false;
        continue;
      }
      d += `${started ? 'L' : 'M'}${xOf(i - startIdx).toFixed(1)},${yFn(v).toFixed(1)}`;
      started = true;
    }
    return d;
  };

  const closeLinePath = asLine
    ? (() => {
        let d = '';
        for (let i = 0; i < n; i++) {
          d += `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(visBars[i].close).toFixed(1)}`;
        }
        return d;
      })()
    : '';

  return (
    <View style={{ width }}>
      {selBar ? (
        <View style={styles.selInfo}>
          <Text style={[styles.selDate, { color: textColor }]}>{selBar.date}</Text>
          <Text style={[styles.selLine, { color: textColor }]}>
            开 {fmtPrice(selBar.open)}  高 {fmtPrice(selBar.high)}
          </Text>
          <Text style={[styles.selLine, { color: textColor }]}>
            低 {fmtPrice(selBar.low)}  收 {fmtPrice(selBar.close)}
          </Text>
          <Text style={[styles.selLine, { color: upDownColor(selBar.changePercent) }]}>
            {fmtPercent(selBar.changePercent)}  量 {fmtMoney(selBar.volume)}
          </Text>
        </View>
      ) : null}

      <GestureDetector gesture={composed}>
        <View>
          <Svg width={width} height={height}>
            <G>
              {ticks.map((t, i) => (
                <G key={i}>
                  <Line x1={0} y1={t.y} x2={width - PAD_RIGHT} y2={t.y}
                    stroke={gridColor} strokeWidth={StyleSheet.hairlineWidth} strokeDasharray="2,4" />
                  <SvgText x={width - PAD_RIGHT + 4} y={t.y + 3} fill={axisColor} fontSize={9} textAnchor="start">
                    {t.label}
                  </SvgText>
                </G>
              ))}
            </G>

            {asLine ? (
              <Path d={closeLinePath} stroke="#4DA3F5" strokeWidth={1.2} fill="none" />
            ) : (
              <G>
                {visBars.map((b, i) => {
                  const globalIdx = startIdx + i;
                  const rising = b.close >= b.open;
                  const isSel = selected === globalIdx;
                  const color = rising ? QuoteColors.up : QuoteColors.down;
                  const x = xOf(i);
                  const bodyTop = Math.min(yOf(b.open), yOf(b.close));
                  const bodyH = Math.max(1, Math.abs(yOf(b.close) - yOf(b.open)));
                  return (
                    <G key={`${b.date}-${globalIdx}`}>
                      <Line x1={x} y1={yOf(b.high)} x2={x} y2={yOf(b.low)} stroke={color} strokeWidth={isSel ? 2 : 1} />
                      <Rect
                        x={x - cw / 2} y={bodyTop} width={cw} height={bodyH}
                        fill={rising ? 'transparent' : color}
                        stroke={isSel ? '#FFD700' : color}
                        strokeWidth={isSel ? 2 : 1}
                      />
                    </G>
                  );
                })}
              </G>
            )}

            {series
              ? maOverlay.map((p) => {
                  const arr = series.ma[p];
                  if (!arr) return null;
                  const d = linePath(arr, yOf);
                  if (!d) return null;
                  return <Path key={p} d={d} stroke={MA_COLORS[p] ?? '#8A8F98'} strokeWidth={1.2} fill="none" />;
                })
              : null}

            {series && showBoll ? (
              <G>
                <Path d={linePath(series.boll.upper, yOf)} stroke="#E0A93E" strokeWidth={1} fill="none" />
                <Path d={linePath(series.boll.mid, yOf)} stroke="#9B6DD3" strokeWidth={1} fill="none" />
                <Path d={linePath(series.boll.lower, yOf)} stroke="#4DA3F5" strokeWidth={1} fill="none" />
              </G>
            ) : null}

            {series && showBbi ? (
              <Path d={linePath(series.bbi, yOf)} stroke="#FF7F50" strokeWidth={1.3} fill="none" />
            ) : null}

            <G>
              {subMode === 'volume' || subMode === 'amount' ? (
                visBars.map((b, i) => {
                  const rising = b.close >= b.open;
                  const v = subVal(b, i);
                  const h = Math.max(1, (Math.abs(v) / geom.subAbsMax) * (SUB_H / 2 - 2));
                  const x = xOf(i);
                  return (
                    <Rect key={`s-${b.date}-${startIdx + i}`}
                      x={x - cw / 2} y={subTop + SUB_H / 2 - h} width={Math.max(cw, 0.5)} height={h}
                      fill={rising ? QuoteColors.up : QuoteColors.down} opacity={0.75} />
                  );
                })
              ) : subMode === 'macd' && series ? (
                <G>
                  {visBars.map((b, i) => {
                    const v = series.macd.hist[startIdx + i];
                    if (v === undefined) return null;
                    const y = subYOf(v);
                    const y0 = subYOf(0);
                    const x = xOf(i);
                    return (
                      <Rect key={`m-${i}`} x={x - cw / 2} y={Math.min(y, y0)}
                        width={Math.max(cw, 0.5)} height={Math.max(1, Math.abs(y - y0))}
                        fill={v >= 0 ? QuoteColors.up : QuoteColors.down} opacity={0.8} />
                    );
                  })}
                  <Path d={linePath(series.macd.dif, subYOf)} stroke="#F5A623" strokeWidth={1} fill="none" />
                  <Path d={linePath(series.macd.dea, subYOf)} stroke="#4DA3F5" strokeWidth={1} fill="none" />
                </G>
              ) : subMode === 'kdj' && series ? (
                <G>
                  <Path d={linePath(series.kdj.k, subYOf)} stroke="#F5A623" strokeWidth={1} fill="none" />
                  <Path d={linePath(series.kdj.d, subYOf)} stroke="#4DA3F5" strokeWidth={1} fill="none" />
                  <Path d={linePath(series.kdj.j, subYOf)} stroke="#C77DFF" strokeWidth={1} fill="none" />
                </G>
              ) : subMode === 'rsi' && series ? (
                <G>
                  <Path d={linePath(series.rsi[6] ?? [], subYOf)} stroke="#F5A623" strokeWidth={1} fill="none" />
                  <Path d={linePath(series.rsi[14] ?? [], subYOf)} stroke="#4DA3F5" strokeWidth={1} fill="none" />
                </G>
              ) : null}
              <Line x1={0} y1={subTop + SUB_H / 2} x2={width - PAD_RIGHT} y2={subTop + SUB_H / 2}
                stroke={gridColor} strokeWidth={StyleSheet.hairlineWidth} />
            </G>

            {selected !== null && selected >= startIdx && selected < endIdx ? (
              <Line
                x1={xOf(selected - startIdx)} y1={PAD_TOP}
                x2={xOf(selected - startIdx)} y2={height}
                stroke="#FFD700" strokeWidth={0.8} strokeDasharray="3,3"
              />
            ) : null}
          </Svg>
        </View>
      </GestureDetector>

      <Text style={[styles.hint, { color: axisColor }]}>
        双指缩放 · 横滑平移 · 点按看详情 · 缩到最小自动变线 · 当前 {n} 根
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 4 },
  subSwitch: { flexDirection: 'row', gap: 12 },
  subBtn: { fontSize: 12 },
  toolBtn: { fontSize: 12, fontWeight: '500' },
  hint: { fontSize: 10, textAlign: 'center', marginTop: 4 },
  selInfo: {
    position: 'absolute', left: 6, top: 30, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 8, padding: 8, gap: 2,
  },
  selDate: { fontSize: 11, fontWeight: '700' },
  selLine: { fontSize: 11, fontVariant: ['tabular-nums'] },
});