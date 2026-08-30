# AI安全ToDo authoring 最終敵対的監査

- Status: In progress（結論未確定）
- Lane: Orchestrated（裁定証跡と多段受入を要する終端監査）
- Lattice plan: `ai-safe-todo-authoring`
- Lattice phase: `terminal-audit`
- 対象実装: `c96a299..c47259a` と、その後の工程状態・監査証拠

## 目的

AI安全ToDo authoring v0.39.0について、既存テストの再実行を監査と呼ばず、実装・契約・負例・公開境界を
敵対的に調べる。指摘は採用と棄却の双方を根拠付きで残し、確認できた欠陥を修正して再監査する。
合格条件が満たされるまで、Latticeの`terminal-audit`を再受理しない。

## 発端と訂正対象

2026-08-01に行った終端確認は、既存のrelease evidenceとsmokeを再掲しただけで、独立したFind、重複整理、
再現・反証、Criticを行っていなかった。それを`terminal-audit`としてacceptした判断は誤りである。
本監査は、その誤った受理をreopenして訂正する。

## 監査方法

1. **Find**: 実装diffと現在の配布物を、下記8観点からread-onlyで監査する。
2. **Dedup**: 指摘を統合し、元指摘を一件も黙って落とさない。
3. **Verify**: 各指摘を実コード、再現、test、公開面のいずれかで確認または反証する。契約上重大な指摘は
   欠陥の実在性と修正価値を別の視点で確認する。
4. **Critic**: 確認・棄却の裁定自体を独立視点で監査する。盲点が出た場合だけ第2ラウンドを行う。
5. **Remediate**: 確認済み欠陥を修正し、focused test、関連test、完全gate、必要な公開smokeを順に通す。
6. **Close**: 全指摘と裁定、修正、残存リスク、証拠commitを固定し、再review後だけ終端監査をacceptする。

## Find観点

1. authoring schema、設計メモ必須化、`NO_PLAN` sentinel、診断の完全性
2. `todo show`／`todo start`／detail API／右ペインへの設計メモ伝播とnote分離
3. migrate／phase revision／legacy plan／task id変更時の後方互換性
4. public/private境界、Markdown sanitization、秘密・絶対path・XSSの漏出
5. 動的dashboard一本化と静的HTML生成契約・参照の残存
6. project registry、root競合、cache、live plan、完了ToDoと終端監査状態の可視化
7. CLI discovery、error taxonomy、失敗時診断、fallback不在
8. npm package、release metadata、WASM/native実行経路、install後挙動

## F/A/Hと権限境界

- **F**: 監査、再現・反証、裁定、Lattice phaseのreopen／review／accept、証拠文書の統合。
- **A**: 確認済み欠陥を直す、対象限定の実装・test・文書更新。
- **H**: 新たな本番deploy、別製品の破壊的変更、scope外の仕様変更。必要になった場合は事前承認を得る。

## 成功条件

- Findの全指摘がDedupの写像に入り、Verifyで確認または棄却され、理由と証拠が残る。
- Criticの盲点がゼロ、または追加Find・Verify・修正まで完了している。
- 確認済み欠陥が修正済み、または外部依存blockerとして未充足条件が明記されている。
- 変更に直結するfocused testと`npm run ci`がgreenである。
- 配布・公開境界に影響する修正を行った場合、正規経路でrelease/install/public smokeまで確認する。
- 監査報告と実装の証拠commitが固定され、そのcommitを根拠にterminal reviewをやり直している。
- 上記を満たした後にだけ`terminal-audit`をacceptする。

## 非目標

- 指摘件数を作るために、再現できない懸念を欠陥へ昇格しない。
- 監査結果を合格へ合わせない。
- native prebuild配布など、今回の対象外機能を便乗実装しない。
- 静的HTMLを生成して動的dashboardの代替にしない。
- 既存green testの再掲だけを監査結果にしない。

## Gate

- [ ] 誤った`terminal-audit`受理をreopenし、理由を記録する
- [ ] 第1ラウンドFindを8観点で完了する
- [ ] 全指摘のDedup写像を固定する
- [ ] 全指摘を再現・反証してVerify裁定を固定する
- [ ] 独立Criticを完了し、盲点を解消する
- [ ] 確認済み欠陥の修正とfocused testを完了する
- [ ] 関連testと`npm run ci`を完了する
- [ ] 全指摘・裁定・修正・残存リスクを監査報告へ固定する
- [ ] 証拠commitを根拠にterminal reviewを再実行する
- [ ] 全成功条件を満たした場合だけ`terminal-audit`をacceptする

## Rollback

監査中の変更は対象別の独立commitに分ける。修正が回帰を起こした場合は、その修正commitだけをrevertし、
指摘は「未解消」に戻す。監査記録とreopenの履歴は削除せず、誤受理からの訂正経緯を保持する。
