## 背景

`bingo-capacity-retest`の未着手ToDoはnote 0件、anchor nullだが、元のarchitecture Markdownには実装方針が残っている。

## 実装方針

- `docs/architecture/capacity-retest-plan.md`の各節を対応taskへ一度だけ移送する。
- `retest-03-wave1-generator-clock`には20回以上のmidpoint採取、offset/uncertainty、50ms無効gate、単調時計利用を記録する。
- 他の未着手taskも題名の言い換えで済ませず、変更対象、計測方法、artifact、失敗分類、受入を入れる。
- 移送後はMarkdownから暗黙同期せず、ToDo本文を正本にする。

## 受入

bingoの全未着手taskをshowして空メモがなく、公開右ペインで詳細を読める。
