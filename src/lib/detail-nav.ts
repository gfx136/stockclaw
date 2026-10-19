/**
 * 详情页切换股票的来源列表（补充规格 §2.5）。
 * 列表页/自选页/结果页点进详情时，把当前排序后的列表存进来；
 * 详情页「上一只/下一只」按此顺序循环切换。
 */

let currentList: string[] = [];
let nameMap: Record<string, string> = {};

export function setDetailList(items: { code: string; name: string }[]): void {
  currentList = items.map((i) => i.code);
  nameMap = Object.fromEntries(items.map((i) => [i.code, i.name]));
}

export function getDetailList(): string[] {
  return currentList;
}

export function getDetailName(code: string): string {
  return nameMap[code] ?? '';
}

/** 取 code 在列表中的相邻项（循环） */
export function neighborCode(code: string, dir: 1 | -1): string | null {
  const idx = currentList.indexOf(code);
  if (idx < 0 || currentList.length === 0) return null;
  const next = (idx + dir + currentList.length) % currentList.length;
  return currentList[next];
}
