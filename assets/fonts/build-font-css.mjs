#!/usr/bin/env node
/**
 * build-font-css.mjs — 由本地 woff2 重新生成 assets/fonts/fonts.css
 *
 * 用法（任意 cwd 均可，重复执行结果一致）：
 *     node assets/fonts/build-font-css.mjs
 *
 * 为什么用 base64 data URI：
 *   站点要求「双击 index.html 以 file:// 协议离线打开」也能正确加载字体。
 *   file:// 下浏览器对外链字体文件存在 CORS / 路径限制（不同浏览器行为不
 *   一致），把 woff2 内联进 CSS 可彻底规避该问题：真正零请求、零依赖，
 *   断网可用。
 *
 * 字体许可：Share Tech Mono 采用 SIL Open Font License 1.1（OFL-1.1），
 *           版权归原作者，由 Google Fonts 发布/托管。
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fonts.css');

/** Google Fonts 官方 latin 子集 unicode-range（取自 css2 响应，保持原样） */
const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
  'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, ' +
  'U+2212, U+2215, U+FEFF, U+FFFD';

/** 若后续拿到 latin-ext 子集，放到同名文件即自动并入（当前 Google 未提供） */
const LATIN_EXT_RANGE =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, ' +
  'U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, ' +
  'U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const FACES = [
  { file: 'ShareTechMono-Regular.woff2', subset: 'latin', unicodeRange: LATIN_RANGE, required: true },
  { file: 'ShareTechMono-Regular-latin-ext.woff2', subset: 'latin-ext', unicodeRange: LATIN_EXT_RANGE, required: false },
];

const WOFF2_MAGIC = Buffer.from([0x77, 0x4f, 0x46, 0x32]); // "wOF2"

const exists = (p) =>
  access(p).then(() => true, () => false);

async function loadFace({ file, subset, unicodeRange, required }) {
  const abs = path.join(HERE, file);
  if (!(await exists(abs))) {
    if (required) throw new Error(`缺少必需字体文件: ${abs}`);
    return null; // 可选子集不存在则跳过
  }
  const buf = await readFile(abs);
  const magic = buf.subarray(0, 4);
  if (!magic.equals(WOFF2_MAGIC)) {
    throw new Error(`${file} 文件头不是 wOF2 (77 4F 46 32)，实际: ${magic.toString('hex')}`);
  }
  if (buf.length <= 5000) throw new Error(`${file} 体积异常（${buf.length} bytes ≤ 5000）`);
  return {
    file,
    subset,
    unicodeRange,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    base64: buf.toString('base64'),
  };
}

function renderFace(face) {
  return [
    `/* ${face.subset} —— ${face.file} · ${face.bytes} bytes · sha256 ${face.sha256.slice(0, 16)}… */`,
    '@font-face {',
    "  font-family: 'Share Tech Mono';",
    '  font-style: normal;',
    '  font-weight: 400;',
    '  font-display: swap;',
    `  src: url(data:font/woff2;base64,${face.base64}) format('woff2'),`,
    `       url('./${face.file}') format('woff2');`,
    `  unicode-range: ${face.unicodeRange};`,
    '}',
  ].join('\n');
}

const header = `/*!
 * fonts.css —— 自托管字体（自动生成，请勿手改；改完脚本重新运行即可）
 *
 * 字体   : Share Tech Mono / Regular 400 / normal
 * 许可   : SIL Open Font License 1.1（OFL-1.1）
 *          版权归原作者所有；woff2 由 Google Fonts 发布托管
 * 来源   : https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap
 *          https://fonts.gstatic.com/s/sharetechmono/v16/J7aHnp1uDWRBEqV98dVQztYldFcLowEF.woff2
 * 子集   : 仅 latin（Google Fonts 未发布该字族的 latin-ext）。此字体不含中文字形，
 *          中文由站点字体栈回退到系统黑体（如 'Microsoft YaHei'）。
 * 内联原因: 站点需支持双击 index.html 以 file:// 协议离线打开；把 woff2 以
 *          base64 data URI 内嵌可完全避开 file:// 下的字体 CORS / 路径限制，
 *          做到真正零请求、零依赖的离线自托管。
 * 生成   : node assets/fonts/build-font-css.mjs（可重复执行，输出确定）
 * 校验   : 生成时已断言每个 woff2 文件头为 77 4F 46 32（"wOF2"）
 *          且 base64 解码后字节数 > 5000
 */`;

async function main() {
  const loaded = [];
  for (const face of FACES) {
    const info = await loadFace(face);
    if (info) loaded.push(info);
  }

  const css = [header, '', ...loaded.map(renderFace), ''].join('\n');
  await writeFile(OUT, css, 'utf8');

  const woff2Bytes = loaded.reduce((n, f) => n + f.bytes, 0);
  console.log(`✔ 已生成 ${OUT}`);
  console.log(`  @font-face 数量 : ${loaded.length}`);
  console.log(`  内嵌 woff2 合计 : ${woff2Bytes} bytes`);
  for (const f of loaded) {
    console.log(`  - ${f.subset.padEnd(9)} ${f.file}  ${f.bytes} bytes  sha256 ${f.sha256.slice(0, 16)}…`);
  }
  console.log(`  fonts.css 体积  : ${Buffer.byteLength(css, 'utf8')} bytes`);
}

main().catch((err) => {
  console.error('✘ 生成失败:', err.message);
  process.exit(1);
});
