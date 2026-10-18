import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { QuoteColors, fmtMoney, fmtPercent, fmtPrice, fmtVolume, upDownColor } from '@/lib/format';
import type { IndicatorSeries, KlineBar } from '@/types/stock';

/**
 * 交互式 K 线蜡烛图（对应视频演示的 K 线交互）。
 *
 * 手势：
 * - 双指缩放：改变显示根数（缩=看多根，放=看少根）
 * - 单指左右滑动：平移浏览历史
 * - 长按：进入十字光标模式，显示该根 OHLC + 涨跌幅，蜡烛高亮
 * - 单击：退出十字光标
 * - 复位按钮：回到默认显示根数并定位到最新
 *
 * 副图：成交量 / 成交额 可切换。
 * ⚠️ 涨红跌绿（A 股口径）。等宽分配（不按时间间隔），停牌空档不挤压图形。
 */

const PAD_LEFT = 4;
const PAD_RIGHT = 46;
const PAD_TOP = 8;
const GAP = 10;
const VOL_H = 48;

const MIN_VISIBLE = 15; // 最多放大到 15 根
const MA_COLORS: Record<number, string> = {
  5: '#F5A623',
  10: '#4DA3F5',
  20: '#C77DFF',
  60: '#8A8F98',
};

interface Props {
  bars: KlineBar[]; // 全部 K线（升序）
  width: number;
  height?: number;
  series?: IndicatorSeries;
  maOverlay?: number[];
  /** 默认显示根数（复位回到此值） */
  defaultVisible?: number;
  gridColor?: string;
  axisColor?: string;
  textColor?: string;
}

export function InteractiveKline({
  bars,
  width,
  height = 280,
  series,
  maOverlay = [5, 10, 20],
  defaultVisible = 100,
  gridColor = '#3A3D42',
  axisColor = '#8A8F98',
  textColor = '#8A8F98',
}: Props) {
  const [visibleCount, setVisibleCount] = useState(defaultVisible);
  const [scrollOffset, setScrollOffset] = useState(0); // 0 = 最新在右端
  const [selected, setSelected] = useState<number | null>(null); // 全局索引
  const [subMode, setSubMode] = useState<'volume' | 'amount'>('volume');

  const total = bars.length;

  // —— 可见窗口 ——
  const endIdx = Math.max(0, Math.min(total, total - scrollOffset));
  const startIdx = Math.max(0, endIdx - visibleCount);
  const visBars = useMemo(() => bars.slice(startIdx, endIdx), [bars, startIdx, endIdx]);
  const n = visBars.length;

  // 手势缩放/滚动的基准值（手势开始时快照）
  const baseVisible = useRef(visibleCount);
  const baseOffset = useRef(scrollOffset);

  // —— 几何计算（基于可见窗口） ——
  const geom = useMemo(() => {
    if (n === 0) return null;
    const plotW = Math.max(10, width - PAD_LEFT - PAD_RIGHT);
    const mainH = Math.max(40, height - PAD_TOP - GAP - VOL_H);

    let hi = -Infinity;
    let lo = Infinity;
    for (const b of visBars) {
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
    }
    if (series) {
      for (const p of maOverlay) {
        const arr = series.ma[p];
        if (!arr) continue;
        for (let i = startIdx; i < endIdx; i++) {
          const v = arr[i];
          if (v === undefined) continue;
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }
    }
    const padRange = (hi - lo) * 0.04 || hi * 0.02 || 1;
    const top = hi + padRange;
    const bot = Math.max(0.0001, lo - padRange);
    const span = top - bot;

    const stepX = plotW / n;
    const cw = Math.max(1, Math.min(12, stepX * 0.68));
    const yOf = (v: number) => PAD_TOP + ((top - v) / span) * mainH;
    const xOf = (i: number) => PAD_LEFT + i * stepX + stepX / 2; // i 是窗口内索引

    // 副图数值范围
    let vmax = 0;
    for (const b of visBars) {
      const v = subMode === 'amount' ? (b.amount ?? b.volume * b.close) : b.volume;
      if (v > vmax) vmax = v;
    }
    const volTop = height - VOL_H;

    const ticks: { y: number; label: string }[] = [];
    for (let k = 0; k <= 4; k++) {
      const v = top - (span * k) / 4;
      ticks.push({ y: yOf(v), label: fmtPrice(v) });
    }

    return { plotW, mainH, stepX, cw, yOf, xOf, vmax, volTop, ticks, span, top, bot };
  }, [n, visBars, width, height, series, maOverlay, startIdx, endIdx, subMode]);

  if (!geom) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={{ color: axisColor, fontSize: 12 }}>暂无 K 线数据</Text>
      </View>
    );
  }

  const { stepX, cw, yOf, xOf, vmax, volTop, ticks } = geom;

  // —— 手势 ——
  // 关键：gesture-handler v2 的回调默认在 UI 线程以 worklet 运行，
  // 直接调 setState（JS 线程）会闪退。必须 .runOnJS(true) 强制回 JS 线程。
  // 回调里用 ref 读最新的 stepX/visibleCount 等，避免 useMemo 闭包捕获旧值。
  const stepXRef = useRef(stepX);
  stepXRef.current = stepX;
  const startIdxRef = useRef(startIdx);
  startIdxRef.current = startIdx;
  const nRef = useRef(n);
  nRef.current = n;
  // 手势 onStart 在 useMemo 闭包里读 state 会拿到旧值，用 ref 存最新
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  const scrollOffsetRef = useRef(scrollOffset);
  scrollOffsetRef.current = scrollOffset;

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
          // scale>1 放大（少根），<1 缩小（多根）
          setVisibleCount((prev) => clampVisible(baseVisible.current / e.scale));
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
          // 左滑（translationX 负）→ 看历史 → scrollOffset 增
          const deltaBars = -e.translationX / stepXRef.current;
          setScrollOffset(clampOffset(baseOffset.current + deltaBars));
        }),
    [total]
  );

  // 十字光标：长按激活并定位，随后移动更新
  const locateAt = (x: number) => {
    const idxInView = Math.floor((x - PAD_LEFT) / stepXRef.current);
    const idx = Math.max(0, Math.min(nRef.current - 1, idxInView));
    setSelected(startIdxRef.current + idx);
  };

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .runOnJS(true)
        .minDuration(250)
        .onStart((e) => {
          locateAt(e.x);
        }),
    []
  );

  // 十字光标激活后的拖动：只在已有选中（长按已激活）时才启用，
  // 否则普通左右滑动应交给滚动 pan。selected 变化才重建此手势。
  const cursorPan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(selected !== null)
        .onUpdate((e) => {
          locateAt(e.x);
        }),
    [selected !== null]
  );

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd(() => {
          setSelected(null);
        }),
    []
  );

  // 十字光标优先于滚动：长按/光标拖动 → 缩放/滚动 → 单击
  const composed = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Simultaneous(longPress, cursorPan),
        Gesture.Simultaneous(pinch, pan),
        tap
      ),
    [longPress, cursorPan, pinch, pan, tap]
  );

  const reset = () => {
    setVisibleCount(defaultVisible);
    setScrollOffset(0);
    setSelected(null);
  };

  const selBar = selected !== null && selected >= 0 && selected < total ? bars[selected] : null;

  const maPath = (arr: (number | undefined)[]): string => {
    let d = '';
    let started = false;
    for (let i = startIdx; i < endIdx; i++) {
      const v = arr[i];
      if (v === undefined) {
        started = false;
        continue;
      }
      const cmd = started ? 'L' : 'M';
      d += `${cmd}${xOf(i - startIdx).toFixed(1)},${yOf(v).toFixed(1)}`;
      started = true;
    }
    return d;
  };

  return (
    <View style={{ width }}>
      {/* 顶部工具行：副图切换 + 复位 */}
      <View style={styles.toolbar}>
        <Pressable onPress={() => setSubMode(subMode === 'volume' ? 'amount' : 'volume')} hitSlop={6}>
          <Text style={[styles.toolBtn, { color: axisColor }]}>
            {subMode === 'volume' ? '成交量' : '成交额'} ⇄
          </Text>
        </Pressable>
        <Pressable onPress={reset} hitSlop={6}>
          <Text style={[styles.toolBtn, { color: axisColor }]}>复位</Text>
        </Pressable>
      </View>

      {/* 选中数值浮层（左侧） */}
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
            {fmtPercent(selBar.changePercent)}  {fmtMoney(selBar.amount ?? selBar.volume * selBar.close)}
          </Text>
        </View>
      ) : null}

      <GestureDetector gesture={composed}>
        <View>
          <Svg width={width} height={height}>
            {/* 网格 + 价格轴 */}
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

            {/* 蜡烛 */}
            <G>
              {visBars.map((b, i) => {
                const globalIdx = startIdx + i;
                const rising = b.close >= b.open;
                const isSel = selected === globalIdx;
                const color = rising ? QuoteColors.up : QuoteColors.down;
                const x = xOf(i);
                const yHigh = yOf(b.high);
                const yLow = yOf(b.low);
                const yOpen = yOf(b.open);
                const yClose = yOf(b.close);
                const bodyTop = Math.min(yOpen, yClose);
                const bodyH = Math.max(1, Math.abs(yClose - yOpen));
                return (
                  <G key={`${b.date}-${globalIdx}`}>
                    <Line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={isSel ? 2 : 1} />
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

            {/* 均线叠加 */}
            {series ? (
              <G>
                {maOverlay.map((p) => {
                  const arr = series.ma[p];
                  if (!arr) return null;
                  const d = maPath(arr);
                  if (!d) return null;
                  return (
                    <Path key={p} d={d} stroke={MA_COLORS[p] ?? '#8A8F98'} strokeWidth={1.2} fill="none" />
                  );
                })}
              </G>
            ) : null}

            {/* 副图（成交量/成交额） */}
            {vmax > 0 ? (
              <G>
                {visBars.map((b, i) => {
                  const rising = b.close >= b.open;
                  const color = rising ? QuoteColors.up : QuoteColors.down;
                  const v = subMode === 'amount' ? (b.amount ?? b.volume * b.close) : b.volume;
                  const h = Math.max(1, (v / vmax) * (VOL_H - 2));
                  const x = xOf(i);
                  return (
                    <Rect key={`v-${b.date}-${startIdx + i}`}
                      x={x - cw / 2} y={volTop + (VOL_H - h)} width={cw} height={h}
                      fill={color} opacity={0.75} />
                  );
                })}
              </G>
            ) : null}

            {/* 十字光标竖线 */}
            {selected !== null && selected >= startIdx && selected < endIdx ? (
              <Line
                x1={xOf(selected - startIdx)} y1={PAD_TOP}
                x2={xOf(selected - startIdx)} y2={height - VOL_H}
                stroke="#FFD700" strokeWidth={0.8} strokeDasharray="3,3"
              />
            ) : null}
          </Svg>
        </View>
      </GestureDetector>

      {/* 操作提示 */}
      <Text style={[styles.hint, { color: axisColor }]}>
        双指缩放·左右滑动·长按看详情 · 当前 {n} 根
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 },
  toolBtn: { fontSize: 12, fontWeight: '500' },
  hint: { fontSize: 10, textAlign: 'center', marginTop: 4 },
  selInfo: {
    position: 'absolute', left: 6, top: 30, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 8, padding: 8, gap: 2,
  },
  selDate: { fontSize: 11, fontWeight: '700' },
  selLine: { fontSize: 11, fontVariant: ['tabular-nums'] },
});