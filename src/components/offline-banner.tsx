import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useOnline } from '@/hooks/use-online';
import { useT } from '@/lib/i18n';

/**
 * 离线横幅（UI 评审：原来只有首页有 useOnline()，筛选页 / 风险页 / 个股页
 * 断网时只表现为「加载失败」或空数据，用户分不清是网络问题还是真没数据）。
 *
 * 在线时渲染 null，直接平铺在页面顶部即可，不需要额外判断。
 */
export function OfflineBanner({ style }: { style?: object }) {
  const online = useOnline();
  const theme = useTheme();
  const { t } = useT();

  if (online) return null;

  return (
    <View
      style={[styles.wrap, { backgroundColor: theme.backgroundElement }, style]}
      accessibilityRole="alert">
      <Text style={[styles.text, { color: theme.textSecondary }]} numberOfLines={2}>
        {t('common_offline')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  text: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
