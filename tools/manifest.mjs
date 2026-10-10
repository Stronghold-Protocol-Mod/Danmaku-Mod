// tools/manifest.mjs — 重新计算 tools/manifest.json 里的哈希。
//
//   node tools/manifest.mjs                   只刷新 payload/ 的 SHA-256（改了 payload/ 之后跑一下）
//   node tools/manifest.mjs --game <官方目录>   另外：把每个补丁打到那份**纯净官方**上，重算 baseSha256 / resultSha256
//
// 为什么需要它：安装器逐个文件校验 SHA-256，manifest 里的哈希一旦和 payload/ 对不上，安装就会失败。
// 你手改了 payload/data/danmaku.json（投稿最常用的一步），跑一下这个脚本即可。
//
// --game 需要一个 0.2.3 的**纯净**官方目录（补丁要逐行匹配它的原文）。给的是已经装过 MOD 的目录也没关系
// ——补丁打不上时会明确报错，而不是悄悄写出一份错的哈希。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyPatch } from './diff.mjs';
import { findGameRoot, gameVersion } from './game-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const MANIFEST_PATH = path.join(HERE, 'manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const next = { ...manifest, files: {}, patches: { ...manifest.patches } };

// ---- 1. payload 的哈希 ----
let changed = 0;
for (const rel of Object.keys(manifest.files)) {
  const from = path.join(PKG, 'payload', rel.split('/').join(path.sep));
  if (!fs.existsSync(from)) {
    console.error('× payload 里缺文件：' + rel + '（manifest 与 payload/ 不同步，先补回来）');
    process.exit(1);
  }
  const hash = sha256(fs.readFileSync(from));
  next.files[rel] = hash;
  if (hash !== manifest.files[rel]) { changed += 1; console.log('  更新  ' + rel); }
}
console.log(`payload：${Object.keys(next.files).length} 个文件，${changed} 个哈希有变化`);

// ---- 2. 补丁的哈希（可选）----
if (arg('game') || argv.includes('--game')) {
  const root = findGameRoot(arg('game'));
  if (!root) { console.error('× 找不到游戏目录（用 --game <路径> 指定）'); process.exit(2); }
  const version = gameVersion(root);
  console.log(`\n官方目录  ${root}`);
  console.log(`官方版本  ${version || '(读不出)'}    MOD 基准 ${manifest.base.version}`);
  if (version && version.split('.').slice(0, 2).join('.') !== manifest.base.version.split('.').slice(0, 2).join('.')) {
    console.error(`× 这个 MOD 是对着官方 ${manifest.base.version} 做的，你这份是 ${version}。换一份纯净的官方再跑。`);
    process.exit(3);
  }

  let pchanged = 0;
  for (const [rel, meta] of Object.entries(manifest.patches)) {
    const abs = path.join(root, rel.split('/').join(path.sep));
    if (!fs.existsSync(abs)) { console.error('× 官方目录里缺文件：' + rel); process.exit(4); }
    const base = fs.readFileSync(abs);
    const patchText = fs.readFileSync(path.join(PKG, meta.patch), 'utf8');
    let result;
    try {
      result = applyPatch(base.toString('utf8'), patchText);
    } catch (e) {
      console.error('× ' + rel + '：补丁打不上 —— ' + e.message);
      console.error('  （这份官方目录不纯净，或补丁与官方版本不匹配；修好再跑）');
      process.exit(5);
    }
    const outBuf = Buffer.from(result.text, 'utf8');
    const baseSha256 = sha256(base);
    const resultSha256 = sha256(outBuf);
    if (baseSha256 !== meta.baseSha256 || resultSha256 !== meta.resultSha256) {
      pchanged += 1;
      console.log('  更新  ' + rel + '（' + meta.hunks + ' hunks）');
    }
    next.patches[rel] = { ...meta, baseSha256, resultSha256 };
  }
  console.log(`补丁：${Object.keys(next.patches).length} 个，${pchanged} 个哈希有变化`);
}

if (!changed && !arg('game')) {
  console.log('没有变化 —— manifest.json 不用重写。');
} else {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log('✓ 已写入 tools/manifest.json');
}
