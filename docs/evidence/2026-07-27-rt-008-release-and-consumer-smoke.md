# rt-008: 閉ループをreleaseまで通し、消費側projectで1周させた

- 日付: 2026-07-27
- plan: `real-transform` / task `rt-008`
- release: `@quolu/lattice@0.21.2`

## 消費側projectでの実行（公開ビルド）

Lattice自身のrepositoryではない、新しく作ったprojectで通した。

```
lattice todo seam-proposal land --plan main --names .lattice/names.json

decision: accepted / landed: true
conditions: 五条件すべて true
着地: src/page-left.mjs / src/page-shared.mjs / src/page-style.mjs / src/page.mjs
```

着地後:

```
node --test test/page.test.mjs        → 1 pass 0 fail
lattice todo independence compile ... → outcome compiled / conflict_count 0
```

**競合1件が0件になった。** 提案でも仮定でもなく、公開ビルドが他所のprojectのソースを実際に
書き換えた結果である。

## 実機smokeでしか出なかった欠陥2件

| 版 | 欠陥 |
|---|---|
| 0.21.1 | 隔離runnerで、mountのために作った親ディレクトリがgit statusへ1エントリで報告されると変更として弾かれる。`.lattice/`全体をgitignoreしているprojectで踏む。親ごと除外すると中身の別の変更まで隠れるので、展開して子を同じ規律で見る形にした |
| 0.21.2 | 変換適用時の再indexが、配布物内の自分自身でなく**対象project配下の`bin/lattice.mjs`**を起動しようとしていた。**Lattice自身のrepositoryでしか動かない**欠陥で、消費側では`sensor_fresh`が必ず落ちる |

どちらも自分のrepoでは通っていた。**「自分のところで動く」は「届いている」ではない**という、
完了の定義そのものの実例である。

## release

| 版 | 内容 |
|---|---|
| 0.21.0 | 変換の適用・着地面と五条件 |
| 0.21.1 | mount親ディレクトリの展開 |
| 0.21.2 | 配布物内の自分自身を起動する |

`npm run ci` 985 pass / 0 fail、push済み、publish済み、global install済み、消費側smoke通過。

## この記録が主張しないこと

- 変換が並列開発を実際に速くしたことは測っていない。測ったのは競合の消滅と実行段階数の見積りである。
- 計画段階で完全な分断は得られていない。残りは実行段階の境界検知が持つ。
- 共有面の粒度は裁定していない（ADR 0137 Open question 1）。
