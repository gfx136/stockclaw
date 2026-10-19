import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FilterSet } from '@/types/stock';

/**
 * 常用筛选条件集持久化（产品规格 3.4 filter_sets）。
 * 存 AsyncStorage，重启保留。
 */

const KEY = 'stockclaw:filter_sets';

export interface SavedFilterSet {
  name: string;
  filter: FilterSet;
  savedAt: number;
}

export async function loadFilterSets(): Promise<SavedFilterSet[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveFilterSet(name: string, filter: FilterSet): Promise<SavedFilterSet[]> {
  const list = await loadFilterSets();
  const idx = list.findIndex((s) => s.name === name);
  const item: SavedFilterSet = { name, filter, savedAt: Date.now() };
  if (idx >= 0) list[idx] = item;
  else list.push(item);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export async function deleteFilterSet(name: string): Promise<SavedFilterSet[]> {
  const list = (await loadFilterSets()).filter((s) => s.name !== name);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
