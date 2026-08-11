# ADR 0175 — realization envelopeはLatticeが生成する

日付: 2026-08-12
状態: Accepted

## Decision

工程完了時にAIが判断する入力を、次のいずれかへ限定する。

- 実装後の構造がplannedと同じである、という明示的な`--planned`選択
- plannedと異なる場合の、実体構造transformだけを収めた`--realized <file>`

Latticeはactive structure sourceとGitから、project／plan／task identity、planned digest、現在HEAD、
commit OID、sequence、previous digest、supersedes、actor、記録時刻、realization digestを生成する。
`--commit`省略時は現在HEADを使い、複数commitを所有する工程だけ明示的な`--commit`を繰り返す。

完全な`lattice.todo_structure_realization.v1`を受け取る既存`--input`入口は、移送・再生・互換用途として残す。

## Boundary

機械は「実装がplannedどおりか」「実体のinput／operation／output等が何か」を推定しない。
それは実装を行ったAIが判断する。機械が持つのは、その判断を履歴・Git・actorへ結合し、既存の
commit reachability、重複claim、mutating anchor、freshness、done／finalization gateで検証する責務である。

## Reason

従来はAIが16 fieldのrealization envelopeを手で再構成していた。このうち意味判断を含むのは
`realized`とcommit所有宣言だけで、残りはactive store、current HEAD、既存chain、actor環境から一意に決まる。
定型metadataをAIへ転記させることは判断能力を使わず、欠落・古いHEAD・digest計算ミスだけを増やす。
