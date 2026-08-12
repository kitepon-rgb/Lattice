# cpe-01 Rei 限定監査・候補修復証跡

## 対象

- Rei 監査メッセージ: room [1046]
- Akari 再照合メッセージ: room [1047]
- 修復後の監査対象候補: `7ade0dd6c0567c3c5ca7d4816b034d1fbf0ca63b`
- cpe 固定実装: `0cfee98723a2297a7e07d0916fc37f7d4b5f146f`

## 指摘への対応

1. 欠落していた `docs/plan_cross-plan-edge-rebind-20260812.md` を、固定側の導入コミット `98844fc14b99d54801946359b195392e0032e31c` と同一内容で候補へ追加した。
2. 既存の cpe 実装証跡は改変せず、本証跡を別ファイルとして追加し、候補側 Lattice store の `cpe-01` 完了イベントへコミット済み blob の descriptor で束縛する。
3. 候補の新 SHA で `npm run ci` を実行した。

## 監査結果

- cpe の fixed/candidate 各 path の stable patch-id は一致した。
- 新 test と実装 evidence の blob は fixed/candidate で一致した。
- spr-01 の先行差分がある path を含め、cpe patch は一致した。
- focused は 78/78、10/10、29/29、合同 117/117 が成功した。
- 保持確認は spr-01 7コミット、cr4-retire、0.58.5 metadata、`todo verify`、`todo status`、各 check、sensor、pack の既存監査結果を満たしている。

## clean full gate

修復後候補 `7ade0dd6c0567c3c5ca7d4816b034d1fbf0ca63b` で `npm run ci` は exit 0。
product gate は 1768/1768 pass、sensor および check・CLI surface・open questions・reachability・todo store verify も同一コマンド内で完了した。

候補はまだ `origin/main` の祖先ではないため、publish は行わない。これは候補の到達性に関する release gate であり、cpe 実装および本監査の判定とは分離する。
