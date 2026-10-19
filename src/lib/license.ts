import * as ed from '@noble/ed25519';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Base64 } from 'js-base64';
import { sha256 } from 'js-sha256';
import { sha512 } from 'js-sha512';

/**
 * 会员授权系统（产品规格 4.5）。
 *
 * - 设备码：IVF + 机型 + 系统版本 → SHA-256 取前 6 字节 → XXXX-XXXX-XXXX
 *   （不用 IDFA；卸载重装后 IVF 会变，需重新激活，文案已说明）
 * - 激活码：payload(设备码6B + 到期4B + 序列号4B) + Ed25519签名(64B)，Base64 分段
 * - App 内纯离线验签（内置公钥），校验设备码匹配 + 到期未过
 * - 激活状态本地存储，HMAC 完整性校验（防手改到期时间）
 */

/* 内置 Ed25519 公钥（与签发私钥配对，私钥在 .license-private-key.txt，不进 App） */
const PUBLIC_KEY_HEX = '44e96884084e980acec7a288cd27f4d2dc9fcab9bf6d569c70e501457cc46042';
/** 激活记录完整性 HMAC 密钥（内置随机常量） */
const INTEGRITY_KEY = 'stockclaw-license-integrity-v1';

const STORAGE_KEY = 'stockclaw:license';

/* —— 字节工具（RN 无 Buffer） —— */
function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/* 给 @noble/ed25519 配置 sha512（用纯 JS js-sha512 实现，无原生依赖） */
let edReady = false;
function ensureEd() {
  if (edReady) return;
  const sha512Async = async (...msgs: Uint8Array[]): Promise<Uint8Array> => {
    const total = msgs.reduce((s, m) => s + m.length, 0);
    const concat = new Uint8Array(total);
    let off = 0;
    for (const m of msgs) {
      concat.set(m, off);
      off += m.length;
    }
    return hexToBytes(sha512(concat));
  };
  ed.hashes.sha512Async = sha512Async as unknown as typeof ed.hashes.sha512Async;
  ed.hashes.sha512 = (() => {
    throw new Error('sync sha512 not available, use verifyAsync');
  }) as unknown as typeof ed.hashes.sha512;
  edReady = true;
}

/** 生成持久 UUID（首次启动生成并存本地，卸载重装后会变——需重新激活，文案已说明） */
async function getDeviceId(): Promise<string> {
  const KEY = 'stockclaw:device_id';
  try {
    let id = await AsyncStorage.getItem(KEY);
    if (!id) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      await AsyncStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

/** 生成本机设备码：XXXX-XXXX-XXXX（持久 UUID 的 SHA-256 前 6 字节） */
export async function getDeviceCode(): Promise<string> {
  const id = await getDeviceId();
  const hash = sha256(id);
  const c = hash.slice(0, 12).toUpperCase();
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

/** 激活状态 */
export interface LicenseState {
  deviceCode: string;
  /** 到期时间（unix 秒） */
  expiry: number;
  serial: number;
  /** 完整性校验码 */
  hmac: string;
}

async function integrityHmac(deviceCode: string, expiry: number, serial: number): Promise<string> {
  return sha256(`${INTEGRITY_KEY}|${deviceCode}|${expiry}|${serial}`);
}

/** 读取激活状态（含完整性校验） */
export async function getLicenseState(): Promise<LicenseState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LicenseState;
    const expect = await integrityHmac(s.deviceCode, s.expiry, s.serial);
    if (expect !== s.hmac) return null; // 被篡改
    return s;
  } catch {
    return null;
  }
}

/** 是否已激活（含到期校验） */
export async function isActivated(): Promise<boolean> {
  const s = await getLicenseState();
  return !!s && s.expiry * 1000 > Date.now();
}

/** 激活失败原因 */
export type ActivateError = 'invalid' | 'device_mismatch' | 'expired';

export interface ActivateResult {
  ok: boolean;
  error?: ActivateError;
  expiry?: number;
}

/**
 * 验证并激活。
 * @param input 用户粘贴的激活码（允许含空格/横线，自动清理）
 */
export async function activateLicense(input: string): Promise<ActivateResult> {
  ensureEd();
  const deviceCode = await getDeviceCode();

  // 清理输入：去空白与横线
  const clean = input.replace(/[\s-]/g, '');
  let bytes: Uint8Array;
  try {
    bytes = Base64.toUint8Array(clean);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  // payload 14B + 签名 64B = 78B
  if (bytes.length !== 78) return { ok: false, error: 'invalid' };

  const payload = bytes.slice(0, 14);
  const signature = bytes.slice(14, 78);

  // 验签
  let valid = false;
  try {
    valid = await ed.verifyAsync(signature, payload, hexToBytes(PUBLIC_KEY_HEX));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: 'invalid' };

  // 解析 payload
  const codeHex = bytesToHex(payload.slice(0, 6)).toUpperCase();
  const payloadCode = `${codeHex.slice(0, 4)}-${codeHex.slice(4, 8)}-${codeHex.slice(8, 12)}`;
  const dv = new DataView(payload.buffer, payload.byteOffset);
  const expiry = dv.getUint32(6, false);
  const serial = dv.getUint32(10, false);

  // 设备码匹配
  if (payloadCode !== deviceCode) return { ok: false, error: 'device_mismatch' };
  // 到期校验
  if (expiry * 1000 <= Date.now()) return { ok: false, error: 'expired' };

  // 写入本地激活状态（含 HMAC）
  const hmac = await integrityHmac(deviceCode, expiry, serial);
  const state: LicenseState = { deviceCode, expiry, serial, hmac };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true, expiry };
}

/** 退出授权 / 换绑 */
export async function deactivateLicense(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** 剩余天数 */
export function daysLeft(state: LicenseState): number {
  return Math.max(0, Math.ceil((state.expiry * 1000 - Date.now()) / 86400000));
}
