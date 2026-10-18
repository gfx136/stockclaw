import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 应用偏好设置（本地化数据模式等）。
 * 存 AsyncStorage，重启保留。
 */

const KEY_LOCAL_MODE = 'stockclaw:local_data_mode';

/**
 * 本地化数据模式：选股与 K 线优先读本机已下载数据，没下载到的自动回退联网。
 * 默认开启（与原应用一致）。
 */
export async function getLocalDataMode(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY_LOCAL_MODE);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export async function setLocalDataMode(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_LOCAL_MODE, on ? '1' : '0');
}
