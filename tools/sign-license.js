/**
 * StockClaw 激活码签发工具（开发者侧离线用，不进 App）。
 *
 * 用法：
 *   node tools/sign-license.js <设备码> <月数>
 *   node tools/sign-license.js XXXX-XXXX-XXXX 1
 *
 * 设备码：用户在 App 授权页看到的本机设备码。
 * 私钥：从项目根目录 .license-private-key.txt 读取（保密）。
 */

const ed = require('@noble/ed25519');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

// @noble/ed25519 v2 需要配置 sha512
ed.hashes.sha512 = (...m) => createHash('sha512').update(Buffer.concat(m)).digest();
ed.hashes.sha512Async = (...m) => Promise.resolve(ed.hashes.sha512(...m));

function readPrivateKey() {
  const f = path.join(__dirname, '..', '.license-private-key.txt');
  const text = fs.readFileSync(f, 'utf8');
  const hex = text.trim().split('\n').pop().trim();
  return Buffer.from(hex, 'hex');
}

function deviceCodeToBytes(code) {
  const hex = code.replace(/[-\s]/g, '');
  if (hex.length !== 12) throw new Error('设备码应为 XXXX-XXXX-XXXX 格式（12 位十六进制）');
  return Buffer.from(hex, 'hex');
}

function main() {
  const [, , deviceCode, monthsArg] = process.argv;
  if (!deviceCode || !monthsArg) {
    console.error('用法: node tools/sign-license.js <设备码> <月数>');
    process.exit(1);
  }
  const months = parseInt(monthsArg, 10);
  if (!(months > 0 && months <= 120)) throw new Error('月数不合法');

  const priv = readPrivateKey();
  const codeBytes = deviceCodeToBytes(deviceCode.toUpperCase());

  // payload: 设备码6B + 到期4B(unix秒,BE) + 序列号4B(BE)
  const expiry = Math.floor(Date.now() / 1000) + months * 30 * 86400;
  const serial = Math.floor(Math.random() * 0xffffffff);
  const payload = Buffer.alloc(14);
  codeBytes.copy(payload, 0);
  payload.writeUInt32BE(expiry, 6);
  payload.writeUInt32BE(serial, 10);

  const signature = Buffer.from(ed.sign(payload, priv));
  const packed = Buffer.concat([payload, signature]); // 78 字节
  const b64 = packed.toString('base64');

  // 分段显示（每 6 字符一段，便于抄录）
  const grouped = b64.replace(/(.{6})/g, '$1-').replace(/-$/, '');

  console.log('');
  console.log('设备码   :', deviceCode.toUpperCase());
  console.log('有效期   :', months, '个月 →', new Date(expiry * 1000).toISOString().slice(0, 10));
  console.log('序列号   :', serial);
  console.log('');
  console.log('激活码（粘贴给 App，允许含横线/空格）:');
  console.log(grouped);
  console.log('');
}

main();
