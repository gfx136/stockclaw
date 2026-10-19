import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import {
  activateLicense,
  deactivateLicense,
  daysLeft,
  getDeviceCode,
  getLicenseState,
  type LicenseState,
} from '@/lib/license';

/**
 * 会员授权页（产品规格 2.7）。
 * 设备码 + 四步激活流程 + Ed25519 离线验签 + 状态区。
 */
export default function LicenseScreen() {
  const theme = useTheme();
  const [deviceCode, setDeviceCode] = useState('');
  const [state, setState] = useState<LicenseState | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setDeviceCode(await getDeviceCode());
    setState(await getLicenseState());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const copyCode = async () => {
    await Clipboard.setStringAsync(deviceCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onActivate = async () => {
    if (!codeInput.trim()) {
      Alert.alert('提示', '请粘贴激活码');
      return;
    }
    setActivating(true);
    try {
      const r = await activateLicense(codeInput);
      if (r.ok) {
        Alert.alert('激活成功', '选股功能已解锁');
        setCodeInput('');
        await refresh();
      } else {
        const map = {
          invalid: '激活码无效（签名校验失败）',
          device_mismatch: '设备不匹配（激活码与本机设备码不符）',
          expired: '激活码已过期',
        } as const;
        Alert.alert('激活失败', map[r.error ?? 'invalid']);
      }
    } finally {
      setActivating(false);
    }
  };

  const onDeactivate = () => {
    Alert.alert('退出授权', '退出后选股功能将重新锁定，确定吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await deactivateLicense();
          await refresh();
        },
      },
    ]);
  };

  const activated = !!state && state.expiry * 1000 > Date.now();
  const expired = !!state && state.expiry * 1000 <= Date.now();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 免费/付费说明 */}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">开通会员（按月订阅，一机一码）</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.descText}>
            解锁选股功能。浏览、自选与行情始终免费。
          </ThemedText>
        </View>

        {/* 状态区 */}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          {activated && state ? (
            <>
              <Text style={[styles.statusOk, { color: '#0AA869' }]}>已激活</Text>
              <ThemedText type="small" themeColor="textSecondary">
                有效期至 {new Date(state.expiry * 1000).toISOString().slice(0, 10)}（剩余 {daysLeft(state)} 天）
              </ThemedText>
              <Pressable onPress={onDeactivate} style={styles.linkWrap}>
                <Text style={[styles.link, { color: theme.textSecondary }]}>退出授权 / 换绑</Text>
              </Pressable>
            </>
          ) : expired ? (
            <Text style={[styles.statusBad, { color: '#E43B3B' }]}>已过期，请重新激活</Text>
          ) : (
            <Text style={[styles.statusBad, { color: theme.textSecondary }]}>
              未开通：选股需要会员，浏览免费
            </Text>
          )}
        </View>

        {/* 四步激活流程 */}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={styles.stepTitle}>激活流程</ThemedText>

          <Step n={1} text="复制下方设备码（同时用作付款备注）" theme={theme} />
          <Pressable onPress={copyCode}>
            <View style={[styles.codeBox, { backgroundColor: theme.background }]}>
              <Text style={[styles.codeText, { color: theme.tint }]}>{deviceCode || '…'}</Text>
              <Text style={[styles.copyText, { color: theme.textSecondary }]}>
                {copied ? '已复制设备码' : '点击复制'}
              </Text>
            </View>
          </Pressable>

          <Step n={2} text="通过支付宝/微信完成转账（付款备注填设备码）" theme={theme} />
          <Step n={3} text="联系开发者，发送设备码 + 付款截图，获取激活码" theme={theme} />
          <Step n={4} text="将激活码粘贴到下方输入框，点击「激活」" theme={theme} />

          <TextInput
            style={[styles.codeInput, { backgroundColor: theme.background, color: theme.text }]}
            placeholder="粘贴激活码（允许含空格/横线）"
            placeholderTextColor={theme.textSecondary}
            value={codeInput}
            onChangeText={setCodeInput}
            autoCapitalize="characters"
            autoCorrect={false}
            multiline
          />
          <Pressable onPress={onActivate} disabled={activating}>
            <View style={[styles.activateBtn, { backgroundColor: theme.tint, opacity: activating ? 0.6 : 1 }]}>
              {activating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.activateBtnText}>激活</Text>
              )}
            </View>
          </Pressable>
        </View>

        <ThemedText type="code" themeColor="textSecondary" style={styles.note}>
          说明：重装应用后设备码会变化，需重新激活。
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ n, text, theme }: { n: number; text: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepNum, { backgroundColor: theme.tint }]}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.stepText}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { borderRadius: 14, padding: 14, gap: 10 },
  descText: { lineHeight: 20 },
  statusOk: { fontSize: 16, fontWeight: '700' },
  statusBad: { fontSize: 14, fontWeight: '600' },
  linkWrap: { marginTop: 4 },
  link: { fontSize: 12, textDecorationLine: 'underline' },
  stepTitle: { marginBottom: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNum: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, lineHeight: 20 },
  codeBox: { borderRadius: 10, padding: 12, alignItems: 'center', gap: 4 },
  codeText: { fontSize: 20, fontWeight: '700', letterSpacing: 2, fontVariant: ['tabular-nums'] },
  copyText: { fontSize: 11 },
  codeInput: { borderRadius: 10, padding: 12, fontSize: 14, minHeight: 60, textAlignVertical: 'top' },
  activateBtn: { height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  activateBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  note: { fontSize: 11, textAlign: 'center', lineHeight: 16 },
});