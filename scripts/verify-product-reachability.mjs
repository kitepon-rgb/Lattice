#!/usr/bin/env node
/**
 * 配布物の到達可能性gate。
 *
 * `src/`には2種類が同居している。製品の入口（`bin/`）からimportで辿り着くものと、
 * 研究campaignの成果物として残っているものである。同じdirectoryに並んでいると、
 * 「実装根拠」として後者を挙げてしまう事故が起きる——実際に請求項の充足表でそれをやり、
 * 挙げたmoduleが製品経路から一度も呼ばれていないことに後で気づいた。
 *
 * よって入口から辿れる集合を機械的に出し、辿れないものは**理由つきで宣言されている場合だけ**
 * 通す。新しく増えた未到達fileは落とす。研究成果を消すのではなく、製品と区別する。
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 製品経路から辿れないが配布物に残すもの。理由を書く。
 *
 * RC1〜RC3の研究campaignは、実変換の受入契約（ADR 0137・0138）を決めるための実験である。
 * 成果物と再生testは不変の記録として残すが、製品はここを通らない——製品の実変換経路は
 * `seam-derivation`／`seam-rewrite`／`seam-verification`／`seam-apply`である（ADR 0142）。
 */
const RESEARCH_ARTIFACTS = new Map([
  ['src/bounded-seam.mjs', 'RC1期の4ゲート版。製品はADR 0138の五条件を使う'],
  ['src/seam-transform.mjs', 'RC1 seam treatmentの実験実装'],
  ['src/treatment-compiler.mjs', 'RC1 treatment compileの実験実装'],
  ['src/treatment-runner.mjs', 'RC1 treatment recompileの実験実装'],
  ['src/rc1-black-box-oracle.mjs', 'RC1 実験'],
  ['src/rc1-comparison.mjs', 'RC1 実験'],
  ['src/rc1-evidence-bundle.mjs', 'RC1 実験'],
  ['src/rc1-v4-campaign.mjs', 'RC1 実験'],
  ['src/rc1-v4-transform.mjs', 'RC1 実験'],
  ['src/rc1-v5-artifact-set.mjs', 'RC1 実験'],
  ['src/rc1-v5-behavior-evidence.mjs', 'RC1 実験'],
  ['src/rc1-v5-campaign.mjs', 'RC1 実験'],
  ['src/rc1-v5-transform.mjs', 'RC1 実験'],
  ['src/rc1-v6-artifact-set.mjs', 'RC1 実験'],
  ['src/rc1-v6-behavior-evidence.mjs', 'RC1 実験'],
  ['src/rc1-v6-campaign.mjs', 'RC1 実験'],
  ['src/rc1-v6-causal-binding.mjs', 'RC1 実験'],
  ['src/rc1-v6-measurement.mjs', 'RC1 実験'],
  ['src/rc2-artifact-set.mjs', 'RC2 実験'],
  ['src/rc2-campaign.mjs', 'RC2 実験'],
  ['src/rc2-delivery-policy-front-end.mjs', 'RC2 実験'],
  ['src/rc2-delivery-policy-oracle.mjs', 'RC2 実験'],
  ['src/rc2-delivery-policy-transform.mjs', 'RC2 実験'],
  ['src/rc2-rc1-transfer-front-end.mjs', 'RC2 実験'],
  ['src/rc3-actual-dogfood.mjs', 'RC3 dogfood記録'],
  ['src/rc3-dogfood-scaffold.mjs', 'RC3 dogfood記録'],
  ['src/rc3-scripted-campaign.mjs', 'RC3 dogfood記録'],
  ['src/rc4-stage1-dogfood.mjs', 'RC4 dogfood記録'],
  // 名前は中核に見えるが、製品はどれも通らない。挙げてしまう事故を防ぐため明示する。
  ['src/boundary-compiler.mjs', 'RC1期の境界compiler。製品はruntime-front-endのcompileRuntimePlanV1'],
  ['src/control-compiler.mjs', 'RC1期のcontrol compiler。製品経路に入口が無い'],
  ['src/artifact-contracts-v2.mjs', 'RC2 artifact契約。製品はartifact-contracts'],
  ['src/runtime-scripted-executor.mjs', 'RC3実験のexecutor。製品のscripted adapterはruntime-scripted-adapter-controller'],
  ['src/runtime-worktree-executor.mjs', 'RC3実験のexecutor。製品の隔離実行はisolation-runner'],
]);

// import文は複数行に跨る。行内に閉じる形だけを見ると、この codebase の大半を取り落とす。
// 相対specifierだけを拾えば、layoutに関係なく静的import／re-exportの両方を覆える。
const IMPORT = /from\s*['"](\.[^'"]+)['"]/gu;
const DYNAMIC = /import\(\s*['"](\.[^'"]+)['"]\s*\)/gu;

async function readIfPresent(file) {
  try { return await readFile(path.join(ROOT, file), 'utf8'); } catch { return null; }
}

async function reachableFrom(entries) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    const text = await readIfPresent(current);
    if (text === null) continue;
    seen.add(current);
    const dir = path.posix.dirname(current);
    for (const pattern of [IMPORT, DYNAMIC]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        pending.push(path.posix.normalize(path.posix.join(dir, match[1])));
      }
    }
  }
  return seen;
}

const entries = [];
for (const directory of ['bin', 'scripts']) {
  for (const name of await readdir(path.join(ROOT, directory))) {
    if (name.endsWith('.mjs')) entries.push(`${directory}/${name}`);
  }
}
const reachable = await reachableFrom(entries);
const sources = (await readdir(path.join(ROOT, 'src')))
  .filter((name) => name.endsWith('.mjs')).map((name) => `src/${name}`).sort();

const undeclared = sources
  .filter((file) => !reachable.has(file) && !RESEARCH_ARTIFACTS.has(file));
const staleDeclarations = [...RESEARCH_ARTIFACTS.keys()]
  .filter((file) => reachable.has(file) || !sources.includes(file));

const report = {
  schema: 'lattice.product_reachability_report.v1',
  entry_points: entries.length,
  product_modules: sources.filter((file) => reachable.has(file)).length,
  declared_research_artifacts: RESEARCH_ARTIFACTS.size,
  undeclared_unreachable: undeclared,
  stale_declarations: staleDeclarations,
};
process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
if (undeclared.length > 0 || staleDeclarations.length > 0) {
  process.stderr.write(`product reachability drifted: ${undeclared.length} undeclared,`
    + ` ${staleDeclarations.length} stale\n`);
  process.exit(1);
}
process.stdout.write(`product reachability verified: ${report.product_modules} product modules,`
  + ` ${RESEARCH_ARTIFACTS.size} declared research artifacts\n`);
