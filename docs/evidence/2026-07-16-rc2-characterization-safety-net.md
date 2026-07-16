# RC2 characterization safety net

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 7〜21
- Tasks: `RC2-B1-bounded-graph-characterization-v1`、`RC2-B2-independent-verifier-characterization-v1`
- HEAD: `d1eae876e157f22a7c91abaa7806d5e4454130a0`
- production source変更: 0

## Fixed characterization

`test/rc2-v6-compatibility.test.mjs`は、committed RC1 v6 artifactを正規disk verifierへ通し、12 checks全件greenを要求する。
SHA-256は`5418e9925fad9e814cceced942a95efafbb5b95707a78abc2036965dca2fb04e`である。

`test/rc2-schedulability-characterization.test.mjs`は次を固定する。

1. v1の実挙動: 3-TODO verdictをrejectする一方、非最小3-wave planの自己申告をacceptする。
2. compiler予定契約: K3、empty capacity 3／2、single edge＋isolated、A-B-C path、hard need＋conflict。
3. metamorphic／failure: TODO permutation、ID／resource rename、third-only unknown、9-node limit、search budget 0。
4. independent verifier予定契約: minimum feasible plan、非最小自己申告、conflict同居、precedence違反、capacity超過。

最終SHA-256は`788759ac0909b906cd328f9b1fe60a2d7390b51312e96f7b021b5d4ca175d14f`である。verifier 5ケースは
compilerを呼ばず、保存graphとdirect planだけをplanned verifierへ渡す。

## Expected-red result

親のfocused再実行結果:

```text
tests: 18
pass: 2
fail: 16
skip: 0
```

- pass 2: v1 characterization。
- expected-red 11: `src/schedulability-compiler-v2.mjs`の`ERR_MODULE_NOT_FOUND`だけ。
- expected-red 5: `src/schedulability-verifier-v2.mjs`の`ERR_MODULE_NOT_FOUND`だけ。
- syntax、fixture construction、assertion由来のfailure: 0。
- `git diff --check`: pass。

RC1 v6 focused testはB1で1 test pass／0 fail、その内部disk verificationは12 pass／0 failだった。B2はv6 test／source／fixtureを
変更していないため、同一HEAD・同一file digestのgreenを再利用し、重複実行しなかった。

## Delegation and acceptance

- A: test実装 → routing検証済みimplementer `/root/rc2_b1_characterization`。
- B1 reportはControl revision 13でimport、親検証後revision 14でaccept、revision 15でfinalizeした。
- B2 reportはrevision 20でimportし、追加5件、exact 1-path scope、失敗原因、file digestを親が実読／実行してrevision 21でacceptした。
- workerはproduction source、docs、git、dotagents／Observer関連repoを変更していない。

## Verification classification

- `focused`: v6 compatibility 1 pass／0 fail、schedulability characterization 2 pass／16 intentional expected-red。
- `related`: 未実行。production sourceはまだ存在しない。
- `full`: 未実行。RC2 Phase gateへ集約する。
- remote、push、publish、Lattice外write: 0。

