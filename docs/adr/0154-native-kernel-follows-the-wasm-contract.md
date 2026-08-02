# ADR 0154: native kernelはwasm側の索引契約へ追従する

- Status: Accepted
- Date: 2026-08-03

## Context

sensorの抽出器は二重実装である。配布物に載るのはwasm経路（TypeScript）で、開発機にだけ置かれる
native kernel（Rust、`lattice-sensor-kernel`）は同じ結果をより速く出すための経路にすぎない。両者が
同じグラフを出すことは`kernel-tsjs-parity`が突き合わせて守っている。

その前提が2026年7月末から8月初めにかけて破れていた。TypeScript側へ入った索引機能——装飾込みの
開始行（schema v11）、import束縛の形と元の名前、動的`import()`／`require()`のspecifier畳み込み、
child_process spawn系の`invokes`辺——が、Rust側へ一度も書かれなかった。

破れたこと自体より、**破れが見えなかったこと**が問題である。parity testは常時26件赤で、
`npm run ci`はその赤を含んだまま日常的に無視されていた。gateが常に赤いなら、新しい赤は既存の赤に
紛れる。この状態でreleaseが2回通っている。

## Decision

1. **native kernelはwasm側の索引契約に追従する義務を負う。** 抽出結果に現れる項目——node/edge/ref
   のフィールド、新しく作るnode種別、新しい辺——をTypeScript側へ足したら、同じcommit範囲でRust側へも
   足す。速度のために結果が違う部品を使わない。
2. **parity testが赤いまま他の作業を続けない。** 赤い突き合わせは「遅い方が正しく、速い方が壊れている」
   という警告であり、開発機の索引結果が配布物と違うことを意味する。
3. **native側の未実装をwasm側の削減で解消しない。** 揃える方向は常にnative→wasmであって、
   TypeScript側の機能を落として一致させるのは目標の切り下げである。
4. **abiを変える時は両側とKERNEL_ABI_VERSIONを同時に動かす。** loaderは知らない版を拒んでwasmへ
   落ちるので、片側だけの変更は「静かに遅くなる」形で表面化する。

## Consequences

- TypeScript側へ抽出機能を足す作業は、Rust側の実装を含めて1つの作業になる。見積もりもそう扱う。
- Rust toolchainを持たない環境では`build:kernel`が動かず、prebuildが古いまま残りうる。その状態は
  parity testが検出するので、赤を無視しない限り事故にはならない。
- 二重実装をやめる（nativeを畳む、あるいは配布に載せる）判断は本ADRの範囲外である。追従の義務は、
  二重実装が存在する限り有効とする。
