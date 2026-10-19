import { useEffect, useState } from 'react';
import { getSystemLang } from '@/lib/system-lang';
import { getLanguage, onLanguageChange, type LanguagePref } from '@/lib/prefs';

/**
 * i18n 框架（产品规格 2.9）。
 * 两套语言资源 zh（默认）/ en；跟随系统 + 设置内切换。
 * 用法：const { t } = useT(); t('tabAllStocks')
 */

type Lang = 'zh' | 'en';

const zh = {
  tabAllStocks: '全部股票',
  tabResults: '筛选结果',
  tabFavorites: '自选',
  tabSettings: '设置',
  searchPlaceholder: '搜索代码 / 名称 / 拼音',
  noData: '暂无数据',
  resultEmpty: '暂无筛选结果。在「全部股票」页点击筛选条件运行后，命中股票会自动出现在这里。',
  favEmpty: '还没有自选股票，在列表页点右侧星标加入。',
  screening: '正在筛选股票…',
  clearResult: '清空筛选结果？',
  notActivated: '未开通：选股需要会员，浏览免费',
  activated: '激活成功，选股功能已解锁',
  expired: '会员已过期，请重新激活',
  chartHint: '双指缩放 · 横滑平移 · 点按看详情 · 缩到最小自动变线',
  riskWarning: '本应用仅提供行情数据与技术指标展示，不构成任何投资建议；投资有风险，入市需谨慎。',
};

const en: Record<keyof typeof zh, string> = {
  tabAllStocks: 'All Stocks',
  tabResults: 'Results',
  tabFavorites: 'Watchlist',
  tabSettings: 'Settings',
  searchPlaceholder: 'Search code / name / pinyin',
  noData: 'No data',
  resultEmpty: 'No filtered results yet. Run a filter from the "All Stocks" page and hits will appear here.',
  favEmpty: 'No watchlist yet. Tap the star on a row to add.',
  screening: 'Screening stocks…',
  clearResult: 'Clear filtered results?',
  notActivated: 'Not active: stock picking requires membership; browsing is free',
  activated: 'Activated! Stock picking is now unlocked',
  expired: 'Membership expired. Please reactivate.',
  chartHint: 'Pinch to zoom · Drag to pan · Tap for details · Auto line at minimum zoom',
  riskWarning: 'Market data and indicators for reference only. Not investment advice. Invest at your own risk.',
};

const resources: Record<Lang, Record<string, string>> = { zh, en };

function resolve(pref: LanguagePref): Lang {
  if (pref === 'zh' || pref === 'en') return pref;
  return getSystemLang();
}

/** 当前语言（模块级，t() 同步读） */
let currentLang: Lang = 'zh';

export function t(key: keyof typeof zh): string {
  return resources[currentLang][key] ?? resources.zh[key] ?? String(key);
}

/** React hook：订阅语言变化，返回 t 函数与当前语言 */
export function useT(): { t: typeof t; lang: Lang } {
  const [lang, setLang] = useState<Lang>(currentLang);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const pref = await getLanguage();
      const l = resolve(pref);
      currentLang = l;
      if (active) setLang(l);
    };
    load();
    const unsub = onLanguageChange(load);
    return () => {
      active = false;
      unsub();
    };
  }, []);
  return { t, lang };
}
