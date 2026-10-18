# StockClaw（clean-room 重写）

> A 股选股与行情分析 App。**以功能为参照的干净重写**，不包含原应用的任何代码、
> 不涉及授权校验逻辑，数据全部来自公开行情接口。

技术栈：**Expo SDK 57 + React Native 0.86 + TypeScript**，路由用 Expo Router（文件式）。

---

## 功能

| 模块 | 说明 |
|---|---|
| **行情** | 全市场 A 股列表，关键字搜索，按涨跌幅/换手率/成交额/市值/价格排序，下拉刷新 |
| **选股** | 基础条件（市值分层、PE、涨跌幅、换手率、价格区间）+ 技术信号（12 种）；含 4 组快捷预设 |
| **周线 BBI 策略** | 用户自定公式的完整实现（周线 BBI > MA26 且收盘 > BBI；市值 ≥20 亿；排除 ST/科创板/北交所/银行） |
| **自选** | 收藏列表，即时行情拼接，长按移除 |
| **详情** | 实时行情 + 三周期切换（日/周/月）+ 自绘 K 线蜡烛图 + 12 项技术指标快照 |
| **设置** | 缓存统计、一键清空、能力说明 |

---

## 目录结构

```
src/
├── app/                        # Expo Router 路由（每个文件 = 一个页面）
│   ├── _layout.tsx             # 根布局：Stack + 主题
│   ├── (tabs)/
│   │   ├── _layout.tsx         # 底部标签导航（行情/选股/自选/设置）
│   │   ├── index.tsx           # 行情页
│   │   ├── screener.tsx        # 选股页（含周线 BBI 面板）
│   │   ├── favorites.tsx       # 自选页
│   │   └── settings.tsx        # 设置页
│   └── stock/[code].tsx        # 个股详情页（动态路由）
├── components/
│   ├── candle-chart.tsx        # 自绘 SVG K 线图（蜡烛 + 均线叠加 + 成交量）
│   ├── filter-controls.tsx     # 筛选控件（市值分层、信号多选、区间输入）
│   ├── quote-row.tsx           # 行情列表行（通用）
│   ├── weekly-bbi-panel.tsx    # 周线 BBI 策略面板
│   ├── themed-text.tsx / themed-view.tsx
│   └── animated-icon.tsx       # 启动动画
├── lib/
│   ├── eastmoney.ts            # 东方财富数据源适配（行情/K线/个股）
│   ├── indicators.ts           # 技术指标计算库（MA/MACD/KDJ/RSI/BOLL/BBI）
│   ├── filter-engine.ts        # 筛选引擎（基础条件 + 技术信号）
│   ├── weekly-bbi.ts           # 周线 BBI 策略（用户公式）
│   ├── kline-db.ts             # 本地 K 线缓存（expo-sqlite）
│   ├── kline-downloader.ts     # K 线下载/增量更新
│   ├── favorites.ts            # 自选存储（AsyncStorage）
│   └── format.ts               # 格式化 + A 股涨跌配色
├── constants/theme.ts          # 主题色 / 间距 / 字体
├── hooks/                      # useTheme / useColorScheme
└── types/stock.ts              # 数据模型 + 指标/筛选类型
```

---

## 关键约定

### ⚠️ 涨跌配色：涨红跌绿

A 股市场惯例与欧美相反。**所有展示涨跌的地方必须走 `lib/format.ts` 的
`upDownColor()`**，不要写死颜色：

```ts
import { upDownColor } from '@/lib/format';
<Text style={{ color: upDownColor(stock.changePercent) }}>
```

- 涨 → `#E43B3B`（红）
- 跌 → `#0AA869`（绿）
- 平 → `#8A8F98`（灰）

### 技术指标口径

与国内行情软件（通达信/同花顺系）对齐，参数固定：

| 指标 | 参数 | 要点 |
|---|---|---|
| MA | 5/10/20/60 | 简单移动平均 |
| MACD | (12,26,9) | **柱值 = (DIF − DEA) × 2**（国内惯例乘 2） |
| KDJ | (9,3,3) | K/D 用 `SMA(X,3,1)` 递推，首值取 50；RSV 分母为 0 时取 50 |
| RSI | 6 / 14 | Wilder 平滑；无涨无跌时取 50 |
| BOLL | (20,2) | 中轨 = MA20，上下轨 = 中轨 ± 2σ（总体标准差） |
| BBI | (3,6,12,24) | 四条均线的平均 |

指标序列**长度与输入严格一致**，未进入窗口的位置为 `undefined`，
便于用同一下标同时取 K 线与指标。

### 数据源

东方财富公开接口，三处端点：

- `push2.eastmoney.com/api/qt/stock/get` — 个股实时行情
- `82.push2.eastmoney.com/api/qt/clist/get` — 全市场列表（分页）
- `push2his.eastmoney.com/api/qt/stock/kline/get` — K 线历史

`secid` 市场前缀规则：`60/68/90` 开头 → `1.`，其余 → `0.`。

---

## 开发

```bash
npm install

npx expo start          # 启动开发服务器（扫码 / 模拟器）
npx expo start --web    # 浏览器预览

npx tsc --noEmit        # 类型检查（提交前必跑）
```

### 自检脚本

```bash
node scripts/verify-indicators.mjs   # 技术指标计算正确性（28 项断言）
```

覆盖：SMA/EMA 递推、MACD 柱 ×2 口径、KDJ 的 SMA(3,1) 递推与边界、
RSI 的 Wilder 平滑（单调涨→100 / 单调跌→0 / 横盘→50）、
BOLL 对称性与 4σ 间距、BBI 四均线均值、空数组/数据不足/一字板等边界。

### 构建

```bash
npx expo export --platform web --output-dir dist        # Web 静态导出
npx expo export --platform android --output-dir dist    # Android JS bundle
```

> ⚠️ `metro.config.js` 里把 `wasm` 加进了 `assetExts`：
> `expo-sqlite` 的 Web 后端用 `wa-sqlite.wasm`，Metro 默认不认这个扩展名，
> 不加这行 Web 构建会报 `Unable to resolve ./wa-sqlite/wa-sqlite.wasm`。

---

## 说明

- 本应用为**功能参考实现**：只做行情展示、指标计算与选股筛选，
  不含原 APK 的会员/授权逻辑。
- 行情数据来自公开接口，**仅供个人研究，不构成投资建议**。