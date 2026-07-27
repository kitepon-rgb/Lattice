# 2026-07-27 scaffold-creation — 宣言道具と創作境界を噛み合わせた

Decision: [ADR 0136](../adr/0136-declared-creation-boundary.md)（創作境界）・
[ADR 0135](../adr/0135-readjudicating-seam-proposal-open-questions.md) Decision 3（自動導出しない）

## 直した噛み合わせ

2つの機能が別々に在って、組み合わさっていなかった。

- ADR 0136は、まだ存在しないpathの所有を`creates: true`の宣言で裏付けありにする。
  実装は`run_request`と`witness_set`にある。
- 0.25.0の`todo independence witness scaffold`は、宣言を書く摩擦（fresh観測・provenance配線・
  canonical bytes）を引き受ける。

だが**下書き契約に`creates`が無かった**ため、新規fileを作るToDoの宣言を道具で作れなかった。
実害は測ってある——`closing-questions`工程で、新しいgate scriptを作るcq-005の宣言が
`affected_tests_unobserved`で断られ、既存file 2件だけで工程を進めた。新module・新doc・新testの
追加は実開発ToDoのかなりの割合を占めるので、道具が使える範囲が実際の作業から外れていた。

## sc-001 — 下書き契約へ創作宣言を足す

`lattice.todo_witness_draft.v2`。`owns`の1件が`"src/a.mjs"`（既存）または
`{ "path": "scripts/new.mjs", "creates": true }`（創作）になる。

版で線を引く。v1のstringだけの`owns`へ`creates`を持ち込めない。prefix形（末尾`/`）は
`affected`が`unresolved`を返すのでfile単位に限る（ADR 0136）。

**自動導出にはしない**（ADR 0135 Decision 3）。観測から機械的に創作境界と読むと、pathのtypoが
「必ず止まるエラー」から「黙って通る創作境界」へ変わる。

## sc-002 — 観測の三値を保って検証する

CLIは観測を`{ state: 'absent'|'present', affectedTests, changedFiles }`で渡すようになった。
**不存在は「観測できていない」ではなく「不在と観測できた」である**——fsのlstat結果であり、
未観測と混ぜると創作境界を宣言したToDoが「まだ確かめていない」側へ落ちる。

道具は宣言が実態と合っているかを確かめる側を持つ。front endの`creationBoundaryStatus`が
要求する形をここで満たしておかないと、通る宣言を作ったつもりでcompileで落ちる。

| 状況 | 返す理由 |
|---|---|
| 創作宣言 × fresh absent × blast radius空 × `changedFiles`が対象1件 | 受理 |
| 創作宣言なのにpathが在る | `creates_path_present:<path>` |
| 創作宣言だが観測の形が違う | `creates_unverified:<path>` |
| 不在なのに創作を宣言していない | `path_absent_declare_creates:<path>` |

最後の1つは案内の改善である。以前は`affected_tests_unobserved`——「観測できていない」と
言っていたが、実際には観測できていて不在だった。**次の一手は「作るならそう宣言する」**であり、
それを言えていなかった。

## sc-003 — 実データで確かめる

このrepoで、まだ存在しない`docs/evidence/2026-07-27-scaffold-creation.md`（本文書）を所有する
ToDoと、既存`src/witness-scaffold.mjs`を所有するToDoを1つの下書きに書いて道具にかけた。

```
observed_paths: ["docs/evidence/2026-07-27-scaffold-creation.md", "src/witness-scaffold.mjs"]
sc-003 owns: [{"creates":true,"kind":"path","target":"docs/evidence/2026-07-27-scaffold-creation.md"}]
sc-003 affected_tests: []
```

`todo independence compile` → **outcome compiled / unknown_count 0 / conflict_count 0**。
投影は`coverage: verified`、`parallel_groups: [["sc-001","sc-003"]]`。

直す前は、この下書きは`affected_tests_unobserved`で断られていた。

## gate

- `npm test`: 1046 pass / 0 fail
- `npm run ci`: 完全green
