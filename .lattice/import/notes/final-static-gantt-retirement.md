## 実装結果

`todo gantt`、`todo gantt status`、`--out`は`STATIC_GANTT_RETIRED`で拒否し、helpと画面内案内は`gantt serve`へ統一した。静的writer／status helperを削除し、Bingoの`docs/bingo-gantt.html`とsidecarも削除した。以後、個別HTMLの再生成は不要。
