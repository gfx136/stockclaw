import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // 启动默认竖屏；首页/筛选/自选/设置强制竖屏，仅详情页可横屏（补充规格 §2.10）
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AnimatedSplashOverlay />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="stock/[code]"
              options={{ title: '个股详情', headerBackTitle: '返回' }}
            />
          <Stack.Screen
            name="filter/index"
            options={{
              title: '筛选条件',
              presentation: 'modal',
              headerBackTitle: '关闭',
            }}
          />
          <Stack.Screen
            name="data-manage"
            options={{ title: '本地数据管理', headerBackTitle: '返回' }}
          />
        </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}