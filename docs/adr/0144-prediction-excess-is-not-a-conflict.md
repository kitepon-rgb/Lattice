# ADR 0144: 予測超過は競合ではない

- 状態: 採択（2026-07-28）
- supersedes: [ADR 0044](0044-rc3-runtime-contract.md) Decision 2の`scope_violation`行
- 関連: [ADR 0143](0143-io-sentinel-is-an-early-warning-not-a-finding.md)

## 文脈

ADR 0044 Decision 2は、宣言write scope外への書き込み（当時`scope_violation`、現
`undeclared_write`）に対して**「offender＋affected closure hold」**を定めた。RC3 campaignと
RC4 Stage 1はこの経路をhold発行まで実証している。

だが、その先が無い。**holdした後にlegalな再計画が作れない。**

`validateRuntimeRecompileRequest`はmodeを`seam_split`か`intentional_serial`のどちらかへ限る。
どちらも当事者を2つ要求する。

| mode | 要求 |
|---|---|
| `intentional_serial` | `todo_ids.length >= 2`（`validateRuntimeIntentionalSerial`） |
| `seam_split` | 2つの面へ切る操作であり、1者の変換は`edge_diff.removed`を空にする |

したがって、1者しか名指していないfindingでfreezeすると、抜け道が無い。実際に出せるのは
「観測していない競合を宣言する」（無関係なTODOを巻き込んだ`intentional_serial`）か
「変換していない変換を宣言する」のどちらかであり、どちらも記録を嘘にする。

RC3 campaignの当該条件がhold止まりで再計画まで行っていないのは、この壁に当たっていた
ことの痕跡である。

## 裁定

**予測超過は競合ではない。** 記録はする。freezeへは運ばない。

境界は計画時の**予測**であって、workerを閉じ込める制約ではない（ADR 0143）。予測を超えた
のは予測が狭かったからであり、作業が不正だったからではない。誰の領分とも重なっていない
書き込みは、誰も止めなくてよい。

1. `conflict`操作は、`todo_ids`が2未満のfindingを`FINDING_NOT_A_CONFLICT`で拒否する。
2. `finding_record`は従来どおり受理する。**予測が外れた事実を捨てない。**
3. 正しい応答は、次のcompileで宣言を実態へ合わせることである（翻訳段）。

**区別しているのは書き込みの善し悪しではなく当事者の数である。** 同じ1つの書き込みが
2つの観測を生むことがある——他TODOの領分と重なった事実（`observed_write_conflict`）と、
自分の予測が狭かった事実（`undeclared_write`）である。前者は処置へ運ばれ、後者は運ばれない。
受入testはこの2つを同じrunに並べて示す。

## ADR 0044を覆す理由

ADR 0044の裁定が誤っていたのではなく、**処置の側が後から2者を要求するように固まった**。
請求項7（片方を止め、他方を確定し、止めた方を再開する）も請求項8（双方を止め、限定的な
変換を施し、双方を再開する）も、2者いて初めて意味を持つ。1者の処置は最初から無い。

0044は「holdする」とだけ書き、その後の再計画がどう成立するかを述べていない。書いた時点で
再計画契約がまだ無かったからである。契約が固まった今、両立しないことが確定した。

## この裁定が主張しないこと

- **宣言外の書き込みを見逃してよい、とは言っていない。** 観測も記録も従来どおり行う。
  変わるのは、それ単独でrunを止める経路が無くなることだけである。
- **予測超過が無害だ、とは言っていない。** 宣言と実態がずれたままなら、次の計画の前提が
  壊れる。だから記録を残し、翻訳段で宣言を観測へ合わせる。
- 2者以上を名指すfindingの扱いは変えていない。
