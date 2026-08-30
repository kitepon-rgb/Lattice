# 工程の義務を機械に持たせる — plan note と witness選択

Lane: Orchestrated（多段の受入連鎖・複数repo書込調整・裁定証跡）
状態と依存の正本はLattice store（plan key `machine-held-obligations`）。本書は散文だけを持つ。
前campaign（audit-pending-surface・終端監査accepted・v0.47.0出荷）の実行中に発見された議題への、
オーナー裁定（2026-08-08・room [96]〜）を実装する。実施主体は同じPeertable円卓。

**完了（2026-08-08）**: 全8 ToDo done・終端監査accepted（証跡は
[docs/evidence/2026-08-08-machine-held-obligations-terminal-audit.md](../evidence/2026-08-08-machine-held-obligations-terminal-audit.md)、
evidence束縛つきphase accept）。受入はLattice 1408/1408・dotagents 252/252の2 repo green。
v0.48.0として出荷。円卓は4人（frontier幅4に合わせてkoharuが途中着卓）。

## 背景

前campaignで「工程の途中で発見された義務が、どこにも定着しない」形が3件実測された
（room [96]の議題・証跡は`docs/evidence/2026-08-08-audit-pending-surface-terminal-audit.md`の特記事項）。

1. task間の順序制約（ap08先行）が散文にしか置けなかった
2. 一度しか取れない観測の存在が機械に記録できず、4者が独立重複実行した
3. witness未宣言の案内（`coverage: missing`・手順名まで正確）を4者が8件で素通りした

オーナー裁定はA〜Dの4点（room [124]で伝達済み）: A採用・B棄却・C修正採用・D棄却。

## 目的

- **A**: 工程（plan／phase）単位の申し送りを機械に書けるようにする。読み出しは既にplan単位で
  通るのに書き込みだけtask必須という片側実装を対称化する。
- **C**: witnessを「全planの暗黙義務」から「起票時の明示選択」へ変える。未判定はdispatchを
  塞がないことを契約に固定し、並列したい組だけをその場で判定する逐次経路を配線する。

## 非目的

- 観測・作業の担当割りを機械に載せない（裁定B。担当の死を検知できない永久ロックの再発）。
- witnessの判定内容・宣言の正直さを機械が採点しない。
- dispatch／readinessの判定規則を変えない。未判定を「不可」へ倒さない（これは非目的であると
  同時にCの受入条件でもある）。
- plan起票作法のguide文書化（裁定D棄却。正しい核はAとCの機構が吸収する）。

## 決定

- 実装場所はLattice。記録は所有境界の宣言済み範囲であり、会話面（Peertable）に恒久記録を
  置くと「会話＝揮発」の公理が壊れる。
- 調整方式の宣言は起票後の明示コマンドで行い、extraction schemaはbumpしない。
- `todo_status_result`はv5→v6へbumpする（plan note・調整方式・並列候補の表出）。
  ADR 0054のprotocolに従い、dotagents側消費者の追従を先に着地させる。
- この campaign 自身は会話調整方式で走る（ob03実装前なので機械への宣言はまだできない。
  その事実自体がob03の動機の実例である）。

## ToDo

詳細な実装方針と受入条件は、Lattice storeの各taskのdesign memoが持つ。

- ob01: plan／phase単位のnote書き込み（store・contracts・CLI）
- ob02: plan noteのstatus表出（v6の一部）
- ob03: 調整方式（witness／会話）の起票時宣言と未宣言の表出
- ob04: 「未判定はdispatchを塞がない」のProtected behavior化
- ob05: 並列候補の逐次判定の配線（部分witness→compile→次候補の導線）
- ob06: E2E test（v6・宣言・逐次判定・不変条件）
- ob07: ADR 0160・公開契約・CHANGELOG
- ob08: dotagents側消費者のv6追従（Lattice側v6化より先に着地）

## 受入ゲート

全ToDo doneでは完了ではない。`npm run ci` green、実storeでのplan note書込→status表出の実測、
調整方式宣言の実測、既存planのdispatch不変の確認を証跡に固定し、終端監査をacceptして閉じる。
publish（v0.48.0）とglobal installと実機確認まで。
