import { pinyin } from 'pinyin-pro';

/**
 * 股票搜索匹配（按产品规格 2.1）：
 * - 代码精确/前缀匹配
 * - 名称全字匹配
 * - 拼音首字母匹配（含 ch/sh/zh 多音消歧，由 pinyin-pro 词典处理）
 *
 * 拼音首字母带缓存（股票名不变，算一次即可）。
 */

const cache = new Map<string, string>();

/** 名称 → 拼音首字母串（小写、无空格）。如 浦发银行 → pfyh */
export function nameToPinyinInitials(name: string): string {
  if (!name) return '';
  let hit = cache.get(name);
  if (hit === undefined) {
    hit = pinyin(name, { pattern: 'first', toneType: 'none', type: 'string' })
      .replace(/\s/g, '')
      .toLowerCase();
    cache.set(name, hit);
  }
  return hit;
}

/** 判断股票是否匹配查询串 */
export function matchStock(
  stock: { code: string; name: string },
  query: string,
  pyMap?: Map<string, string>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (stock.code.toLowerCase().includes(q)) return true;
  if (stock.name.toLowerCase().includes(q)) return true;
  const py = pyMap?.get(stock.code) ?? nameToPinyinInitials(stock.name);
  return py.includes(q);
}

/** 预计算一批股票的拼音首字母映射（code → 首字母），避免每次按键都重算 */
export function buildPinyinMap(stocks: { code: string; name: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of stocks) {
    m.set(s.code, nameToPinyinInitials(s.name));
  }
  return m;
}
