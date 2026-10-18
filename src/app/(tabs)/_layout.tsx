import { Tabs } from 'expo-router';
import { Text, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

// 模板自带的 tabIcons 只有 home/explore 两个 png，不够用。
// 用文字符号代替，避免找图标资源。color 参数由 Tabs 传入，这里不使用。
function TabBarEmoji({ emoji }: { emoji: string }) {
  return <Text style={{ fontSize: 20 }}>{emoji}</Text>;
}

export default function TabLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '行情',
          tabBarIcon: () => <TabBarEmoji emoji="📈" />,
        }}
      />
      <Tabs.Screen
        name="screener"
        options={{
          title: '选股',
          tabBarIcon: () => <TabBarEmoji emoji="🔍" />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: '自选',
          tabBarIcon: () => <TabBarEmoji emoji="⭐" />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: () => <TabBarEmoji emoji="⚙️" />,
        }}
      />
    </Tabs>
  );
}