# sdp-002: 束縛失敗のunknownへguidance codeとnext_actionを与えた

- 日付: 2026-07-27
- plan: `self-description-parity` / task `sdp-002`

## 何が欠けていたか

`lattice.seam_proposal_projection.v1`の`guidance`は**記録の鮮度しか述べていなかった**。
`SEAM_PROPOSAL_GUIDANCE_CODES`は`unrecorded／superseded／stale／verified`の4つで、これは
「記録が現在のcodeを指しているか」の話である。したがって記録が現在と一致していれば、
componentが`concern_anchor_unresolved`や`semantic_owner_binding_missing`で束縛できていなくても、
投影は「seam提案の記録は現在のplan、並列可否記録、HEADと一致している」としか言わなかった。

機械が「束縛できませんでした」と言う瞬間——解決法が一番必要な瞬間——に、次の一歩を返す口が無い。
ADR 0130「Latticeが自分の並列化面を自分で説明する／案内文言の単一正本」の履行漏れである。

## 直した内容

1. 束縛失敗6種別へcodeとnext_actionを与えた。

   | unknown kind | guidance code | next_action |
   |---|---|---|
   | `concern_anchor_overlap` | `seam_proposal_binding_overlap` | `split_overlapping_concern_anchors_then_recompile` |
   | `concern_anchor_outside_resource` | `seam_proposal_binding_outside_resource` | `correct_concern_anchors_then_recompile` |
   | `concern_anchor_unresolved` | `seam_proposal_binding_symbol_unresolved` | `correct_concern_anchors_then_recompile` |
   | `concern_anchor_resource_unresolved` | `seam_proposal_binding_resource_unresolved` | `correct_concern_anchors_then_recompile` |
   | `semantic_owner_binding_ambiguous` | `seam_proposal_binding_ambiguous` | `narrow_concern_anchors_then_recompile` |
   | `semantic_owner_binding_missing` | `seam_proposal_binding_missing` | `declare_concern_anchors_then_recompile` |

   優先順は表の上から下。**壊れた宣言を、宣言が無い状況より先に述べる**——前者は直す対象が一意に
   決まるのに対し、後者は何をどう宣言するかから決めることになるからである。既存の
   `selectIndependenceGuidance`が「記録が無い＜古い＜衝突している」と並べたのと同じ原則。

2. 鮮度を束縛失敗より先に見る。`stale`／`superseded`な記録に載るunknownは現在のcodeについての
   事実ではないので、先に再compileが要る。束縛失敗の案内は`verified`の時だけ出る。

3. 全案内へ「宣言はwitness setにあり、independence compileとseam-proposal compileを通し直すまで
   提案へ写らない」を添えた。concern_anchorsはwitness setにあり、seam提案は
   `witness_set_digest`が一致する宣言しか読まない。ここまで述べないと「直したのに同じunknownが出る」で止まる。

4. 契約側（`validateSeamProposalProjection`）が案内codeを規則正本へ引き直して照合するようにした。
   従来は`PROJECTION_GUIDANCE_BY_COVERAGE`という契約側だけの表と突き合わせており、規則が2箇所にあった。
   `seamProposalGuidanceCode()`を正本にして表を削除したので、投影が状況と噛み合わない案内を載せると
   契約が落ちる。

## 検証

- `node --test test/todo-independence-guidance.test.mjs test/seam-proposal-cli.test.mjs` — 23 pass。
  優先順、鮮度が先に来ること、束縛失敗に対応しないunknown（`candidate_exploration_incomplete`等）が
  案内を動かさないこと、契約が噛み合わない案内を拒否することをpinした。
- `npm run check` — 通過。
- `npm test` — **953 pass / 0 fail**。
- 既存fixture `storeはproposalをplan versionへ並置し、read投影はexact targetを返す` が
  `seam_proposal_verified`から`seam_proposal_binding_missing`へ変わった。これは回帰ではなく
  **直したかった取り違えそのもの**である——記録は一致しているが、componentは所有者へ束縛できていない。
  この試験はCLIバイナリを実際にspawnして投影を読むので、実行経路ごと確認できている。

## 範囲外にしたもの

束縛失敗以外のunknown種別（`raw_graph_unavailable`、`raw_graph_incomplete`、
`candidate_exploration_incomplete`、`multiple_incomparable_candidates`、`new_surface_assumption_missing`、
`virtual_witness_surface_mismatch`、`exact_surface_evidence_missing`）には案内を与えていない。
これらはconcern_anchorsでは解けない別系統の状況で、次の一歩も別である。載っていても案内は
`seam_proposal_verified`のままなので、**そこはまだ機械が黙っている**。
