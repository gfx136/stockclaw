import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Icon } from '@/components/icon';
import { Colors } from '@/constants/theme';
import { useT } from '@/lib/i18n';

/**
 * Tab 栏。
 *
 * UI 评审修正（2026-10-21）：
 *  - headerShown: false 保留（各页自绘标题，避免双重标题与 56pt 浪费）。
 *  - 图标原来是 emoji（📈📋⭐⚙️）。emoji 自带彩色字形、不响应 tabBarActiveTintColor，
 *    导致「当前在哪个 tab」只能靠下方 10pt 文字颜色区分，图标本身永远满彩。
 *    改为 SF Symbols，并用「线性 ↔ 实心」表达选中态，颜色与形状双通道，
 *    色弱用户也能分辨。
 */
export default function TabLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { t } = useT();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab_stocks'),
          tabBarIcon: ({ color, focused }) => (
            <Icon
              name="chart.line.uptrend.xyaxis"
              size={22}
              color={color}
              weight={focused ? 'semibold' : 'regular'}
              fallbackGlyph="📈"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="results"
        options={{
          title: t('tab_results'),
          tabBarIcon: ({ color, focused }) => (
            <Icon
              name={focused ? 'list.bullet.rectangle.fill' : 'list.bullet.rectangle'}
              size={22}
              color={color}
              weight={focused ? 'semibold' : 'regular'}
              fallbackGlyph="📋"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: t('tab_favorites'),
          tabBarIcon: ({ color, focused }) => (
            <Icon
              name={focused ? 'star.fill' : 'star'}
              size={22}
              color={color}
              weight={focused ? 'semibold' : 'regular'}
              fallbackGlyph="⭐"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tab_settings'),
          tabBarIcon: ({ color, focused }) => (
            <Icon
              name={focused ? 'gearshape.fill' : 'gearshape'}
              size={22}
              color={color}
              weight={focused ? 'semibold' : 'regular'}
              fallbackGlyph="⚙️"
            />
          ),
        }}
      />
    </Tabs>
  );
}
