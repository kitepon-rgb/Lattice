# RC1-D2 portable control acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v3` / RC1-D2
- Control: `lattice-rc1-closed-loop-v3` / `RC1-D2-portable-control-v3`
- Contract: [portable evidence correction](2026-07-15-rc1-portable-evidence-correction-contract.md)
- Decision: [ADR 0013](../adr/0013-rc1-portable-control-accepted.md)
- classification: F。artifact digest意味とactive predecessor correctionを親が裁定した。

## Result

control base `d2d4128…`を別々のtemp worktreeへ展開し、Codegraph 1.4.1を2回fresh indexした。両runは16 files、208 nodes、
835 edges、pending changes／refs 0、mismatchなし。raw outcome digestは不一致、portable outcome集合は
`a8a3f762471ec685095395fde0d852e60070f6240a031a07667e5d9621aaa35d`で一致し、normal／negative compiled artifactもdeep equalだった。

| condition／artifact | canonical digest | canonical bytes |
|---|---|---:|
| normal boundary manifest | `1aec1c9efc6baa19a6df9f82464ddb8069988f5165f049573811cc3de935a064` | 4298 |
| normal boundary verdict | `f7e4df5b94ea7f0cb9676670d312d7aaee5ef2881854610c3bb2de41557735bf` | 1186 |
| normal plan graph | `506052d82f68cd1041e7b3398687a2d539053dc55ffd63b5530ed9bdf5102110` | 984 |
| negative boundary manifest | `01973acb35b4fef16f6af124b3f5adffa8c2cc8da0c355c76c0a2cbb6e6f7575` | 4677 |
| negative boundary verdict | `446079126e1f83a33e35cfd9b1aeb9c8834c8f48ec39999a24696acfe2a3ef8a` | 714 |
| negative plan graph | `2d2f882dcc6ee90cdde2a0cf29dac514b1f8998b6f81342c42d4913a55a6eba5` | 1156 |

`compilation-evidence.json`はschema v2、projection ID、2 raw digest、portable digest、input digest、artifact meta、observed factsを
bindし、canonical digestは`44cfd470e01e1e115c7f687271520483fbd3295d4b8ca2962a22b21129acb00e`。絶対path本文は含まない。

## Gates

- test-first red: planned export `portableCodegraphOutcome`不在で2 test fileがESM import error。
- focused: `node --test test/codegraph-adapter.test.mjs test/control-compiler.test.mjs`
  → 13 pass / 0 fail / 0 skip。
- syntax: task対象5 source／test fileがpass。
- related: `node test/integration/control-portability.integration.mjs`
  → raw unequal、portable equal、normal／negative artifact equal、source unchanged、cleanup passed。
- artifact reread: public validators、manifest→verdict／plan chain、canonical digest／bytes、evidence outcome digestを再検証してpass。
- full `npm run ci`: RC1-Gへ集約したため未実行。
- canonical Codegraph post-index: 1.4.1、20 files、329 nodes、1284 edges、pending changes／refs 0、mismatchなし。

## Audit and residual unknown

- changed sourceはadapterのpure projectionとcompiler digest入口だけ。raw collection、typed status、control topologyは変更していない。
- `updatedAt`はdirect `node` recordだけから除き、同名のunknown top-level fieldは保持するunit caseを固定した。
- Codegraph 1.4.1で観測していない将来volatile fieldは自動除外しない。fresh-index gateが失敗した時にprojection versionを更新する。
- artifact生成は正規`collectCodegraphEvidence`／`compileControlArtifacts`を使い、integrationと同じ2-fresh-index条件で直接生成した。
- old control artifact、dotagents、Observer関連repoは変更していない。remote作成、push、publishも未実施。
