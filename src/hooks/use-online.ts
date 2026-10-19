import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * 网络在线状态。无网时返回 false（离线模式，规格 3.5 显示离线横幅）。
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    });
    return () => unsub();
  }, []);
  return online;
}
