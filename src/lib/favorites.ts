import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FavoriteItem } from '@/types/stock';

/**
 * 收藏存储。对应 StockClaw 的收藏功能（原应用用 shared_preferences）。
 * 用 AsyncStorage 存 JSON 数组即可，量小。
 */

const KEY = 'stockclaw:favorites';

export async function loadFavorites(): Promise<FavoriteItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function isFavorite(code: string): Promise<boolean> {
  const list = await loadFavorites();
  return list.some((f) => f.code === code);
}

export async function addFavorite(code: string, name: string): Promise<FavoriteItem[]> {
  const list = await loadFavorites();
  if (list.some((f) => f.code === code)) return list;
  const next = [{ code, name, addedAt: Date.now() }, ...list];
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function removeFavorite(code: string): Promise<FavoriteItem[]> {
  const list = await loadFavorites();
  const next = list.filter((f) => f.code !== code);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function toggleFavorite(code: string, name: string): Promise<boolean> {
  const fav = await isFavorite(code);
  if (fav) {
    await removeFavorite(code);
    return false;
  }
  await addFavorite(code, name);
  return true;
}