import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 应用偏好设置（本地化数据模式、增量更新、后台下载、语言、外观等）。
 * 存 AsyncStorage，重启保留。
 */

const PREFIX = 'stockclaw:';

async function getBool(key: string, def: boolean): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PREFIX + key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

async function setBool(key: string, val: boolean): Promise<void> {
  await AsyncStorage.setItem(PREFIX + key, val ? '1' : '0');
}

async function getStr<T extends string>(key: string, def: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(PREFIX + key);
    return (v as T) ?? def;
  } catch {
    return def;
  }
}

async function setStr(key: string, val: string): Promise<void> {
  await AsyncStorage.setItem(PREFIX + key, val);
}

/** 本地化数据模式：选股与 K 线优先读本机已下载数据，没下载到的自动回退联网 */
export const getLocalDataMode = () => getBool('local_data_mode', true);
export const setLocalDataMode = (on: boolean) => setBool('local_data_mode', on);

/** 增量更新：开启后只补缺失的 K 线 */
export const getIncrementalUpdate = () => getBool('incremental_update', true);
export const setIncrementalUpdate = (on: boolean) => setBool('incremental_update', on);

/** 后台下载：系统空闲时自动补全数据（iOS 时机由系统决定） */
export const getBackgroundDownload = () => getBool('background_download', false);
export const setBackgroundDownload = (on: boolean) => setBool('background_download', on);

/** 语言：跟随系统 / 中文 / English */
export type LanguagePref = 'system' | 'zh' | 'en';
export const getLanguage = () => getStr<LanguagePref>('language', 'system');

const langListeners = new Set<() => void>();
/** 订阅语言变化（设置页切换后立即生效） */
export function onLanguageChange(cb: () => void): () => void {
  langListeners.add(cb);
  return () => langListeners.delete(cb);
}
export async function setLanguage(v: LanguagePref): Promise<void> {
  await setStr('language', v);
  langListeners.forEach((l) => l());
}

/** 外观：跟随系统 / 浅色 / 深色 */
export type ThemePref = 'system' | 'light' | 'dark';
export const getThemePref = () => getStr<ThemePref>('theme', 'system');

const themeListeners = new Set<() => void>();
/** 订阅外观变化（设置页改外观后立即生效） */
export function onThemePrefChange(cb: () => void): () => void {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
}
export async function setThemePref(v: ThemePref): Promise<void> {
  await setStr('theme', v);
  themeListeners.forEach((l) => l());
}

/** 首页排序键（规格 §1.4，持久化 pref_home_sort；结果页用 pref_results_sort 独立记忆） */
export type HomeSortKey = 'code' | 'price' | 'changePercent' | 'amount' | 'turnover' | 'marketCap';
export const getHomeSort = () => getStr<HomeSortKey>('home_sort', 'code');
export const setHomeSort = (v: HomeSortKey) => setStr('home_sort', v);
export const getResultsSort = () => getStr<HomeSortKey>('results_sort', 'code');
export const setResultsSort = (v: HomeSortKey) => setStr('results_sort', v);

/** 详情页指标开关（规格 §2.4：状态持久化） */
export const getShowBoll = () => getBool('ind_boll', false);
export const setShowBoll = (v: boolean) => setBool('ind_boll', v);
export const getShowBbi = () => getBool('ind_bbi', true);
export const setShowBbi = (v: boolean) => setBool('ind_bbi', v);
export const getShowMacd = () => getBool('ind_macd', true);
export const setShowMacd = (v: boolean) => setBool('ind_macd', v);
export const getShowKdj = () => getBool('ind_kdj', false);
export const setShowKdj = (v: boolean) => setBool('ind_kdj', v);
export const getShowRsi = () => getBool('ind_rsi', false);
export const setShowRsi = (v: boolean) => setBool('ind_rsi', v);
/** 详情页方向偏好（规格 §2.10：记住横屏偏好） */
export const getDetailLandscape = () => getBool('detail_landscape', false);
export const setDetailLandscape = (v: boolean) => setBool('detail_landscape', v);
