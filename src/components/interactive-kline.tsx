import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { indicatorColor, indicatorDashed, indicatorWidth } from '@/lib/indicator-palette';
import { QuoteColors, fmtMoney, fmtPercent, fmtPrice } from '@/lib/format';
import type { IndicatorSeries, KlineBar } from '@/types/stock';

/**
 * 交互式 K 线图（补充规格 v1.2 §2/§3）。
 *
 * 十字光标状态机（§3.2）：
 * - 长按 ≥0.3s 进入：竖线吸附 bar + 高亮该 K 线 + 横线跟手 + y轴数值标签 + 信息条
 * - 主轴判定后锁副轴：左右滑=竖线逐根切换（不跳根）；上下滑=横线跟手读价位（竖线不动）
 * - 松手保留 1.5s 淡出；第二指落下立即退出转缩放；十字光标模式禁用平移
 * - 点按=仅定位 bar（无横线/标签）显示 1.5s
 *
 * 指标色来自共享色板 indicator-palette（四处同色），叠加顺序 MA20→MA26→BBI。
 */

const PAD_LEFT = 4;
const PAD_RIGHT = 46;
const PAD_TOP = 14; // 图例留白（§2.3）
const GAP = 10;
const SUB_H = 78;

const MIN_VISIBLE = 20;
const MAX_VISIBLE = 500;
const LINE_MODE_CW = 3;

export type SubMode = 'volume' | 'amount' | 'macd' | 'kdj' | 'rsi';

interface Props {
  bars: KlineBar[];
  width: number;
  height?: number;
  series?: IndicatorSeries;
  /** 开启的主图叠加均线（多选） */
  maOverlay?: number[];
  showBoll?: boolean;
  showBbi?: boolean;
  defaultVisible?: number;
  gridColor?: string;
  axisColor?: string;
  textColor?: string;
  /** 副图模式 */
  subMode?: SubMode;
  /** 复位令牌 */
  resetToken?: number;
  /** 选中 bar 索引回调（详情页速览/信息条联动） */
  onSelectBar?: (index: number | null) => void;
  /** 主题（取指标色用） */
  isDark?: boolean;
}

export function InteractiveKline({
  bars,
  width,
  height = 320,
  series,
  maOverlay = [5, 10, 20, 26],
  showBoll = false,
  showBbi = true,
  defaultVisible = 60,
  gridColor = '#3A3D42',
  axisColor = '#8A8F98',
  textColor = '#FFFFFF',
  subMode = 'volume',
  resetToken,
  onSelectBar,
  isDark = true,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(defaultVisible);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  /** 十字光标：横线 y 位置（null = 未进入） */
  const [crossY, setCrossY] = useState<number | null>(null);
  /** 主轴锁定：'x' = 竖线跟手逐根，'y' = 横线跟手读价位 */
  const lockAxis = useRef<'x' | 'y' | null>(null);

  // 复位（§3.5）
  const resetRef = useRef(resetToken);
  useEffect(() => {
    if (resetRef.current !== resetToken) {
      resetRef.current = resetToken;
      setVisibleCount(defaultVisible);
      setScrollOffset(0);
      setSelected(null);
      setCrossY(null);
    }
  }, [resetToken, defaultVisible]);

  // 默认根数变化时同步
  useEffect(() => { setVisibleCount(defaultVisible); }, [defaultVisible]);

  useEffect(() => { onSelectBar?.(selected); }, [selected, onSelectBar]);

  // 松手 1.5s 后淡出（§3.2）
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleFade = () => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setSelected(null);
      setCrossY(null);
    }, 1500);
  };
  useEffect(() => () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); }, []);

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
      if (showBoll) { absorb(series.boll.upper); absorb(series.boll.lower); }
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
    const yToPrice = (y: number) => top - ((y - PAD_TOP) / mainH) * span; // y → 价格（十字光标读数）
    const xOf = (i: number) => PAD_LEFT + i * stepX + stepX / 2;

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
      for (let i = startIdx; i < endIdx; i++) { absorbSub(series.macd.dif[i]); absorbSub(series.macd.dea[i]); }
    }
    if (subMode === 'kdj' && series) {
      for (let i = startIdx; i < endIdx; i++) { absorbSub(series.kdj.k[i]); absorbSub(series.kdj.d[i]); }
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

    return { plotW, mainH, stepX, cw, asLine, yOf, yToPrice, xOf, subYOf, subTop, subAbsMax, ticks, subVal };
  }, [n, visBars, width, height, series, maOverlay, showBoll, showBbi, startIdx, endIdx, subMode]);

  if (!geom) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={{ color: axisColor, fontSize: 12 }}>暂无 K 线数据</Text>
      </View>
    );
  }

  const { stepX, cw, asLine, yOf, yToPrice, xOf, subYOf, subTop, ticks, subVal } = geom;

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

  const clampVisible = (v: number) => Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, Math.min(total, Math.round(v))));
  const clampOffset = (v: number) => Math.max(0, Math.min(total - 1, Math.round(v)));

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart(() => {
          // 第二指落下立即退出十字光标（§3.2 仲裁）
          setCrossY(null);
          lockAxis.current = null;
          baseVisible.current = visibleCountRef.current;
        })
        .onUpdate((e) => setVisibleCount(clampVisible(baseVisible.current / e.scale))),
    [total]
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-8, 8])
        .onStart(() => {
          if (lockAxis.current !== null || selectedRef.current !== null) return; // 十字光标模式禁用平移
          baseOffset.current = scrollOffsetRef.current;
        })
        .onUpdate((e) => {
          if (lockAxis.current !== null) return;
          const deltaBars = -e.translationX / stepXRef.current;
          setScrollOffset(clampOffset(baseOffset.current + deltaBars));
        }),
    [total]
  );

  /** x 坐标 → 全局 bar 索引 */
  const barIndexAt = (x: number): number => {
    const idxInView = Math.floor((x - PAD_LEFT) / stepXRef.current);
    const local = Math.max(0, Math.min(nRef.current - 1, idxInView));
    return startIdxRef.current + local;
  };

  /** 长按（十字光标状态机，§3.2） */
  const longPress = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activateAfterLongPress(300)
        .onStart((e) => {
          lockAxis.current = null;
          setSelected(barIndexAt(e.x));
          setCrossY(e.y);
          if (fadeTimer.current) clearTimeout(fadeTimer.current);
        })
        .onUpdate((e) => {
          // 主轴判定（首次位移超阈时锁定，§3.2 斜向）
          if (lockAxis.current === null && (Math.abs(e.translationX) > 12 || Math.abs(e.translationY) > 12)) {
            lockAxis.current = Math.abs(e.translationX) > Math.abs(e.translationY) ? 'x' : 'y';
          }
          if (lockAxis.current === 'y') {
            setCrossY(e.y); // 横线跟手读价位，竖线不动
          } else {
            setSelected(barIndexAt(e.x)); // 竖线逐根切换（不跳根）
            setCrossY(e.y);
          }
        })
        .onEnd(() => {
          lockAxis.current = null;
          scheduleFade();
        })
        .onFinalize(() => {
          lockAxis.current = null;
        }),
    []
  );

  /** 点按：定位 bar（无横线），1.5s 淡出（§3.4） */
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .maxDistance(10)
        .onEnd((e, ok) => {
          if (!ok) return;
          const idx = barIndexAt(e.x);
          setSelected(selectedRef.current === idx ? null : idx);
          setCrossY(null);
          scheduleFade();
        }),
    []
  );

  /** 双击：全部可见 ↔ 默认根数（§3.4） */
  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .numberOfTaps(2)
        .onEnd(() => {
          setVisibleCount((v) => (v >= total - 1 ? defaultVisible : total));
          setScrollOffset(0);
        }),
    [total, defaultVisible]
  );

  const composed = useMemo(
    () => Gesture.Exclusive(doubleTap, Gesture.Race(Gesture.Simultaneous(pinch, pan), longPress, tap)),
    [doubleTap, pinch, pan, longPress, tap]
  );

  const selBar = selected !== null && selected >= 0 && selected < total ? bars[selected] : null;
  const crossActive = crossY !== null;

  const linePath = (arr: (number | undefined)[], yFn: (v: number) => number): string => {
    let d = '';
    let started = false;
    for (let i = startIdx; i < endIdx; i++) {
      const v = arr[i];
      if (v === undefined) { started = false; continue; }
      d += `${started ? 'L' : 'M'}${xOf(i - startIdx).toFixed(1)},${yFn(v).toFixed(1)}`;
      started = true;
    }
    return d;
  };

  const closeLinePath = asLine
    ? (() => {
        let d = '';
        for (let i = 0; i < n; i++) d += `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(visBars[i].close).toFixed(1)}`;
        return d;
      })()
    : '';

  // 图例项（§2.3：只显示已开启）
  const legend: { key: string; label: string }[] = [];
  for (const p of maOverlay) legend.push({ key: `ma${p}`, label: `MA${p}` });
  if (showBoll) legend.push({ key: 'boll', label: 'BOLL' });
  if (showBbi) legend.push({ key: 'bbi', label: 'BBI' });

  return (
    <View style={{ width }}>
      {/* 图例（§2.3：图表区左上角覆盖，色点+同色文字） */}
      {legend.length > 0 ? (
        <View style={styles.legend} pointerEvents="none">
          {legend.map((it) => (
            <View key={it.key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: indicatorColor(it.key as never, isDark) }]} />
              <Text style={[styles.legendText, { color: indicatorColor(it.key as never, isDark) }]}>{it.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <GestureDetector gesture={composed}>
        <View>
          <Svg width={width} height={height}>
            {/* 网格与价格刻度 */}
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

            {/* 选中 bar 高亮底色带（§3.1②，2pt 宽半透明，覆盖主图与副图） */}
            {selected !== null && selected >= startIdx && selected < endIdx ? (
              <Rect
                x={xOf(selected - startIdx) - 1} y={PAD_TOP}
                width={2} height={height - PAD_TOP}
                fill="#4DA3F5" opacity={0.18}
              />
            ) : null}

            {/* K 线 */}
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
                        stroke={isSel ? '#4DA3F5' : color}
                        strokeWidth={isSel ? 1.5 : 1}
                      />
                    </G>
                  );
                })}
              </G>
            )}

            {/* 主图叠加：MA 各周期（色板，叠加顺序 MA20→MA26→BBI） */}
            {series
              ? maOverlay.map((p) => {
                  const arr = series.ma[p];
                  if (!arr) return null;
                  const d = linePath(arr, yOf);
                  if (!d) return null;
                  const key = `ma${p}`;
                  return (
                    <Path key={p} d={d}
                      stroke={indicatorColor(key as never, isDark)}
                      strokeWidth={indicatorWidth(key as never)}
                      fill="none" />
                  );
                })
              : null}

            {/* BOLL（上轨实线/中轨虚线/下轨实线） */}
            {series && showBoll ? (
              <G>
                <Path d={linePath(series.boll.upper, yOf)} stroke={indicatorColor('boll', isDark)} strokeWidth={indicatorWidth('boll')} fill="none" />
                <Path d={linePath(series.boll.mid, yOf)} stroke={indicatorColor('bollMid', isDark)} strokeWidth={indicatorWidth('bollMid')} strokeDasharray="3,3" fill="none" />
                <Path d={linePath(series.boll.lower, yOf)} stroke={indicatorColor('bollLower', isDark)} strokeWidth={indicatorWidth('bollLower')} fill="none" />
              </G>
            ) : null}

            {/* BBI（最粗，最上层） */}
            {series && showBbi ? (
              <Path d={linePath(series.bbi, yOf)} stroke={indicatorColor('bbi', isDark)} strokeWidth={indicatorWidth('bbi')} fill="none" />
            ) : null}

            {/* 副图 */}
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
                  <Path d={linePath(series.macd.dif, subYOf)} stroke={indicatorColor('macdDif', isDark)} strokeWidth={1} fill="none" />
                  <Path d={linePath(series.macd.dea, subYOf)} stroke={indicatorColor('macdDea', isDark)} strokeWidth={1} fill="none" />
                </G>
              ) : subMode === 'kdj' && series ? (
                <G>
                  <Path d={linePath(series.kdj.k, subYOf)} stroke={indicatorColor('kdjK', isDark)} strokeWidth={1} fill="none" />
                  <Path d={linePath(series.kdj.d, subYOf)} stroke={indicatorColor('kdjD', isDark)} strokeWidth={1} fill="none" />
                  <Path d={linePath(series.kdj.j, subYOf)} stroke={indicatorColor('kdjJ', isDark)} strokeWidth={1} fill="none" />
                </G>
              ) : subMode === 'rsi' && series ? (
                <Path d={linePath(series.rsi[14] ?? [], subYOf)} stroke={indicatorColor('rsi', isDark)} strokeWidth={1} fill="none" />
              ) : null}
              <Line x1={0} y1={subTop + SUB_H / 2} x2={width - PAD_RIGHT} y2={subTop + SUB_H / 2}
                stroke={gridColor} strokeWidth={StyleSheet.hairlineWidth} />
            </G>

            {/* 十字光标：竖线（吸附 bar 中心） */}
            {selected !== null && selected >= startIdx && selected < endIdx ? (
              <G>
                <Line x1={xOf(selected - startIdx)} y1={PAD_TOP} x2={xOf(selected - startIdx)} y2={height}
                  stroke="#FFFFFF" strokeWidth={1} strokeDasharray="3,3" opacity={0.9} />
                <Line x1={xOf(selected - startIdx) - 3} y1={PAD_TOP} x2={xOf(selected - startIdx) - 3} y2={height}
                  stroke="#FFFFFF" strokeWidth={0.5} opacity={0.35} />
                <Line x1={xOf(selected - startIdx) + 3} y1={PAD_TOP} x2={xOf(selected - startIdx) + 3} y2={height}
                  stroke="#FFFFFF" strokeWidth={0.5} opacity={0.35} />
              </G>
            ) : null}

            {/* 十字光标：横线 + y 轴数值标签（§3.1③） */}
            {crossActive ? (
              <G>
                <Line x1={0} y1={crossY!} x2={width - PAD_RIGHT} y2={crossY!}
                  stroke="#FFFFFF" strokeWidth={1} strokeDasharray="3,3" opacity={0.9} />
                <Rect x={width - PAD_RIGHT} y={crossY! - 10} width={PAD_RIGHT} height={20} rx={4} fill={axisColor} />
                <SvgText x={width - PAD_RIGHT / 2} y={crossY! + 4} fill="#000000" fontSize={10}
                  textAnchor="middle" fontWeight="700">
                  {fmtPrice(yToPrice(crossY!))}
                </SvgText>
              </G>
            ) : null}
          </Svg>

          {/* 信息条（§3.3，覆盖图表顶部，不挤压高度） */}
          {(crossActive || selBar) && selBar ? (
            <View style={styles.infoBar} pointerEvents="none">
              <Text style={styles.infoLine1} numberOfLines={1}>
                {selBar.date}  |  开 {fmtPrice(selBar.open)}  高 {fmtPrice(selBar.high)}  低 {fmtPrice(selBar.low)}  收 {fmtPrice(selBar.close)}  <Text style={{ color: QuoteColors.up }}>{fmtPercent(selBar.changePercent)}</Text>
              </Text>
              <Text style={styles.infoLine2} numberOfLines={1}>
                成交量 {fmtMoney(selBar.volume)}手   成交额 {fmtMoney(selBar.amount)}
              </Text>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      <Text style={[styles.hint, { color: axisColor }]}>
        双指缩放 · 横滑平移 · 长按看数值 · 当前 {n} 根
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  legend: {
    position: 'absolute', left: PAD_LEFT + 2, top: 2, zIndex: 5,
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, maxWidth: 320,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontWeight: '600' },
  infoBar: {
    position: 'absolute', left: 0, right: PAD_RIGHT, top: 0, zIndex: 6,
    backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  infoLine1: { color: '#FFFFFF', fontSize: 10, fontVariant: ['tabular-nums'] },
  infoLine2: { color: '#FFFFFF', fontSize: 10, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 10, textAlign: 'center', marginTop: 4 },
});