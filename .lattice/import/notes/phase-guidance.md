## 背景

Phase無しで移送したplanにdone/evidenceを保ったままPhaseを付ける`acquire_phase`は既に存在するが、migrate成功後のAIが発見できない。

## 実装方針

- migrate resultへphase capabilityと正規next actionを構造化して返す。
- schemaの取得方法と`acquire_phase`入力作成手順をhelp/errorから辿れるようにする。
- `preserve_completed`のような重複オプションは追加せず、既存のruntime task migration契約を説明する。

## 受入

Phase無しplanのmigrate結果だけから、完了証拠を失わずPhaseを獲得する正規commandへ到達できる。
