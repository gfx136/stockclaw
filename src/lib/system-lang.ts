import { NativeModules, Platform } from 'react-native';

/**
 * 读取系统语言（zh / en）。用于「跟随系统」。
 */
export function getSystemLang(): 'zh' | 'en' {
  try {
    let locale = '';
    if (Platform.OS === 'ios') {
      locale =
        NativeModules.SettingsManager?.settings?.AppleLocale ??
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ??
        '';
    } else {
      locale = NativeModules.I18nManager?.localeIdentifier ?? '';
    }
    return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}
