import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Stock } from '@/types/stock';

/**
 * 行情列表快照缓存（问题1修复：冷启动秒显上次数据，不用干等网络）。
 *
 * 策略：
 * - 启动时先读快照 → 立即渲染（毫秒级），再后台拉网络刷新
 * - 网络结果回来后覆盖快照并更新 UI
 * - 快照有 TTL（默认 12 小时），过期仍先显示（离线可用），但会提示需刷新
 */

const LIST_KEY = 'stockclaw:list_snapshot_v1';
const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;

interface Snapshot {
  at: number;
  list: Stock[];
}

export async function saveListSnapshot(list: Stock[]): Promise<void> {
  if (!list || list.length === 0) return;
  try {
    await AsyncStorage.setItem(LIST_KEY, JSON.stringify({ at: Date.now(), list }));
  } catch { /* 存储失败不影响主流程 */ }
}

export async function loadListSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snapshot;
    if (!s?.list?.length) return null;
    return s;
  } catch {
    return null;
  }
}

/** 快照是否新鲜（未过期） */
export function isSnapshotFresh(at: number): boolean {
  return Date.now() - at < SNAPSHOT_TTL_MS;
}