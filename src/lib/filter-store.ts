import type { FilterOutput } from '@/lib/filter-engine';
import type { FilterSet } from '@/types/stock';

/**
 * 筛选状态共享 store（跨 tab）。
 *
 * 筛选面板（底部弹层）设置条件并运行 → 结果存这里 →
 * 「选股结果」页读取展示。用模块级单例 + 订阅实现，无外部依赖。
 */

interface FilterState {
  /** 当前筛选条件 */
  filter: FilterSet;
  /** 最近一次筛选结果；null = 还没筛过 */
  output: FilterOutput | null;
  /** 是否正在筛选 */
  running: boolean;
}

let state: FilterState = {
  filter: {},
  output: null,
  running: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFilterState(): FilterState {
  return state;
}

export function setFilter(filter: FilterSet): void {
  state = { ...state, filter };
  emit();
}

export function setFilterOutput(output: FilterOutput | null): void {
  state = { ...state, output };
  emit();
}

export function setFilterRunning(running: boolean): void {
  state = { ...state, running };
  emit();
}
