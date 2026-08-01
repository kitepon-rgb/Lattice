## 実装結果

plan create v4、todo extraction v3、todo plan v6／v7へ`design_memo`を追加した。空欄・空白・参照だけは拒否し、`NO_PLAN`だけを明示的な計画不在として受理する。固定prompt、legacy read、revisionでの保持まで回帰test済み。
