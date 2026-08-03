# ADR 0155: upstream追従は全量3-way mergeを既定にする

- Status: Accepted
- Date: 2026-08-03
- Supersedes: ADR 0048 Decision 4の消化として書かれたNOTICE旧方針（選択的cherry-pick・監視の必要駆動）

## Context

sensor/の吸収（04ab45c、2026-07-17）以降、追従方針は「選択的cherry-pick・定期監視なし・
必要駆動」だった。結果として54コミット・201ファイル（うち63が抽出・言語解釈）が
気づかれないまま溜まり、オーナーが対応言語を尋ねるまで誰も差分を見ていなかった。
吸収点SHAはNOTICEの散文にしか無く、差分を測る仕組みへ繋がっていなかった。

cherry-pick方針の前提「Lattice側の改良とupstreamは意図的に分岐しており、全量mergeは
衝突が重すぎる」は、実測で崩れた。synced_atをbaseにした3-way mergeなら、Latticeの
選択的改名（一部CODEGRAPH_*を意図的に残す）は通常のローカル変更としてgitが解き、
54コミット分でもauto-merge 306／手決着13に収まる。置換規則は要らず、作れない
（改名が選択的なので規則では再現不能）。

## Decision

1. **追従は全量3-way mergeを既定にする（オーナー裁定 2026-08-03「貰えるものは全部貰う」）。**
   baseは`sensor/UPSTREAM.json`の`synced_at`（前回同期点）。absorbed_atは由来の記録であり
   mergeには使わない——固定baseは手動解決を毎回再衝突させ、解決が成功状態へ遷移できない。
2. **取り込まない面はskipで宣言する。** site／telemetry／installerなどLatticeが運用しない面は
   manifestの`skip`に列挙し、暗黙に落とさない。衝突の決着は`conflict_policy`へ理由つきで
   記録し、一度決めたことを毎回解き直さない（oursで捨てたupstream変更は毎回報告する）。
3. **監視は週次の定期ジョブにする。** `.github/workflows/upstream-check.yml`が差分を測り、
   新しいkernel言語・wasm extractorを名指しで報告する。「必要駆動」は「覚えていない期間が
   そのまま溜める期間になる」ことが実証されたので廃止する。
4. **手動解決の完了は`--mark-synced`で宣言する。** markerを進めずに同じrefへ`--apply`を
   再実行すると、解決済みtreeへ衝突マーカーが再注入される（実際に起きた）。
5. **schema・版番号は両側が独立採番である前提で扱う。** EXTRACTION_VERSIONは両者の
   どちらでもなく上へ（別内容の同番号を残さない）。KERNEL_ABI_VERSIONはupstreamと同番を
   使わず、追いついた時は必ずその上へ進める（ADR 0154も参照）。
6. **kernelの新言語は「取り込み＋Lattice独自機能の追従＋parity green」までが1単位。**
   取り込んだ瞬間からADR 0154の追従義務の対象になる。

## Consequences

- NOTICEの「upstream追従方針」節は本ADRを指す短文になり、cherry-pick手順と追従記録の
  詳細はmanifest（UPSTREAM.json）とgit履歴が持つ。
- 週次checkが赤くなったら、それは作業項目である。溜めた場合のコストは今回実証済み
  （54コミット分の消化に、kernel追従とtest修復を含め1営業日相当を要した）。
- upstreamがforce-pushで履歴を書き換えた場合、checkは`HISTORY_REWRITTEN`で止まり
  人へ渡す。自動では追わない。
