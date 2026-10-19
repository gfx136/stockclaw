import { useColorScheme as useSystemScheme } from 'react-native';
import { useEffect, useState } from 'react';

import { setQuoteDark } from '@/lib/format';
import { getThemePref, onThemePrefChange, type ThemePref } from '@/lib/prefs';

/**
 * 外观主题（产品规格 2.8）：跟随系统 / 浅色 / 深色。
 * 设置页「外观」手动覆盖时立即生效（订阅 prefs 变化），并联动涨跌色（format.setQuoteDark）。
 */
export function useColorScheme(): 'light' | 'dark' {
  const sys = useSystemScheme();
  const [pref, setPref] = useState<ThemePref>('system');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const v = await getThemePref();
      if (active) setPref(v);
    };
    load();
    const unsub = onThemePrefChange(load);
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const effective = pref === 'system' ? sys : pref;
  const isDark = effective === 'dark';
  // 联动涨跌色主题（补充规格 §5.1）
  setQuoteDark(isDark);
  return isDark ? 'dark' : 'light';
}