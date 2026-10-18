const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// expo-sqlite 的 Web 后端（wa-sqlite）以 .wasm 形式引入 SQLite 引擎。
// Metro 默认不把 .wasm 视作可打包资源 → web 构建会报 "Unable to resolve ./wa-sqlite/wa-sqlite.wasm"。
// 加入 assetExts 后，Web 端 SQLite 才能正常打包。
// （原生平台不读这个文件，无副作用。）
config.resolver.assetExts.push('wasm');

module.exports = config;