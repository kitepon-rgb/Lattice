# ADR 0156: 2つのtreeの構造差分はLattice本体が持ち、自然キーで突き合わせる

- Status: Accepted
- Date: 2026-08-03
- 関連: [ADR 0154](0154-native-kernel-follows-the-wasm-contract.md)、
  [ADR 0155](0155-upstream-sync-is-full-three-way-merge.md)

## Context

upstream追従（54コミット・201ファイル）の作業本体は「現在のsensor/」と「upstreamのtree」の
突き合わせだった。sensorは両側を別々に索引でき、MCP側も`projectPath`で任意のrootを引ける。
にもかかわらず作業の中盤以降sensorは使われず、人のgrepとdiffに落ちた。

原因は「両側に聞ける」と「突き合わせられる」が別だったことである。欲しかったのは
「この54コミットでどのsymbolのグラフが変わったか」「Lattice独自機能が出す辺のうち
upstream側に無いもの」で、これは2つのindexの差集合だが、それを1回で出す入口が無かった。

素朴にnode idで突き合わせる実装は成立しない。node idは
`<kind>:` + sha256(`相対path:kind:name:start_line`) であり**行番号を含む**。関数が数行ずれた
だけで両側のidが変わり、そのnodeも、そのnodeを端点に持つ全ての辺も、偽の追加＋削除になる。
54コミット級では差分全体が偽陽性で埋まる。

## Decision

1. **入口は`lattice sensor diff <rootA> <rootB> --json`とし、実装はLattice本体
   （`src/sensor-diff.mjs`）が持つ。`sensor/`配下は変更しない。** sensor/はupstream追従面で
   あり、そこへLattice固有機能を足すと以後の3-way mergeで永続的な衝突源になる。差分はDBを
   readOnlyで読むだけなので、sensor/の改修もparity義務（ADR 0154）も発生しない。
2. **突き合わせは行番号を含まない自然キー `kind|file_path|qualified_name|name` で行う。**
   辺も端点idを自然キーへ解決してから比べる。属性差は`changed`（変わった属性名を返す）、
   属性同一で行だけ違うものは`moved`へ落とす。行ズレを変化として報告しない。
3. **同一自然キーが複数ある集団（overload・無名関数・同名の重複定義）は、両側をstart_line順に
   並べて先頭から対にする。** この対応付けは発見的であり、集団の何番目が消えたかは主張しない。
   主張するのは件数と、その集団に起きたことの種別だけである。
4. **比較しなかったものは件数で必ず出す。** 端点を解決できない辺（index不整合）とsubtree外へ
   出る辺は分けて数え、明細を`--limit`で切った時は切った量を`truncation`へ出す。件数summaryは
   常に正確に保つ。「差分なし」と「まだ見ていない」を同じ顔にしない。
5. **両側のindexの素性が違う時は`comparability.status`を`degraded`にして理由を返す。**
   見るのは3つ——schema version、**同じfileどうしの**extraction version、抽出errorを記録した
   fileの件数である。extraction versionを集合で比べない：A={x:24,y:25}／B={x:25,y:24}は
   集合が一致するのに対応が入れ替わっており、中断したincremental syncが実際に作る状態である。
   抽出errorを持つfileはnodeが欠けたまま正常な顔で並ぶので、数えないと「削除された」と
   区別できない。degradedは「比べるな」ではない——比較自体は止めない。止めると、揃えるために
   何が違うかを見る手段が無くなる。
6. **止まるべき入力では止まる。** 片側の未索引、必要な列を欠く古いindex、写像が2つの実在fileを
   同じpathへ潰す指定は、いずれもtyped errorで止める。勝手に索引せず（差分を見に来た依頼に
   repoを書き換える権限は含まれない）、片方を黙って捨てない（捨てた側の全symbolが
   「無かったこと」になり、差分が静かに嘘をつく）。schemaは読み出す**前**に確かめる——
   読んでから落ちると、素性を返す機会そのものを失う。
7. **片側の読み出しは読み取りtransactionで囲う。** 囲わないと、並行するsyncのcommitが
   node読出しとedge読出しの間へ割り込み、実在しないdanglingを作る。A側とB側は別DBなので、
   両者が同一時刻の断面である保証はここでは得られない（保証するのは片側ずつの内部整合だけ）。
8. **キー文字列を割って名前を復元しない。** POSIXのfile名は `/` とNUL以外の制御文字を許すので、
   区切りに選んだ文字がpathへ現れた瞬間に復元が壊れる。出力の名前・pathは読み出し時に控えた
   構造をそのまま返す。
9. **MCPツール化はしない。** MCP serverは`sensor/src/mcp`にあり、そこはupstream衝突面である。
   操作するAIはCLIの`--json`を直接叩ける（ADR 0154の所有境界と同じ理由——AIが既にできることを
   製品コードへ足さない）。

## Consequences

- 追従作業の手順が変わる。対象refをworktreeへ出して`lattice sensor init`し、
  `lattice sensor diff`で差分を取る。`--subtree-a`／`--map-a|-b`が2つのtreeの階層と改名を吸収する
  （`sensor/UPSTREAM.json`の`path_map`をそのまま写せる）。
- 初回の実弾で、本番indexが旧extraction versionのまま残っていたことが`degraded`で露見した。
  さらに、`sensor sync`で揃えた直後にまた旧versionへ戻ることから、公開版より古い常駐daemonが
  索引を書き戻し続けていることが判った。この判定は装飾ではなく、実際に2つの誤読を防いだ。
- **`--limit`が切るのは出力の明細だけで、読み込み量ではない。** 件数summaryを正確に出す以上、
  両側を全件メモリへ載せる必要がある。桁が2つ上がるindexではこの前提ごと見直しが要る
  （streaming差分は別設計になる）。黙って近似へ落とさないための明示的な線引きである。
- 用途はupstream追従に限らない。変換前後・branch間・fork間など、2つのtreeの構造を突き合わせる
  面はすべて同じ入口を使う。
