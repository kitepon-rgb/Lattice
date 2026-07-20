/**
 * lattice-mcp bin向けNode versionガード（ADR 0049 wave2レビューでのスコープ外
 * 発見の修理 — bin/lattice-mcp.mjs が sensor/dist/index.js を直import して
 * MCPServer を起動する経路には、sensor CLI (sensor/src/bin/sensor.ts) が
 * 持つNode versionガードが一切通っていなかった）。
 *
 * 閾値・banner文言は複製せず、sensor CLI と同じ
 * `sensor/dist/bin/node-version-check.js`（Node 25.x のV8 turboshaft WASM JIT
 * Zone allocatorバグと、MIN_NODE_MAJOR未満のfloorを扱う）から再利用する。
 *
 * 判定ロジックだけをここに切り出し、process.versions.node / env を直接
 * 読まない純関数にすることで、境界値（MIN_NODE_MAJOR-1 / MIN_NODE_MAJOR /
 * 24 / 25 / 26、override有無）をunit testで固定できるようにする。
 */

import {
  MIN_NODE_MAJOR,
  buildNode25BlockBanner,
  buildNodeTooOldBanner,
  isNode25Affected,
} from '../sensor/dist/bin/node-version-check.js';

export { MIN_NODE_MAJOR };

/**
 * @param {string} nodeVersion - process.versions.node相当の文字列 (例: "26.5.0")
 * @param {boolean} overrideActive - LATTICE_SENSOR_ALLOW_UNSAFE_NODE が設定されているか
 * @returns {{ blocked: boolean, banner: string | null }}
 *   banner: 表示すべきbanner文言（sensor CLIと同一文言）。null ならサポート
 *     対象内で表示不要。
 *   blocked: true なら呼び出し側は起動を止める（exit 1 相当）。
 *     override有効時は nodeMajor が範囲外でも blocked は false になるが、
 *     banner は「表示のみ」で non-null のまま返る（sensor CLIと同一意味論）。
 */
export function evaluateNodeVersionGuard(nodeVersion, overrideActive) {
  const nodeMajor = parseInt(nodeVersion.split('.')[0] ?? '0', 10);
  if (isNode25Affected(nodeMajor)) {
    return { blocked: !overrideActive, banner: buildNode25BlockBanner(nodeVersion) };
  }
  if (nodeMajor < MIN_NODE_MAJOR) {
    return { blocked: !overrideActive, banner: buildNodeTooOldBanner(nodeVersion) };
  }
  return { blocked: false, banner: null };
}
