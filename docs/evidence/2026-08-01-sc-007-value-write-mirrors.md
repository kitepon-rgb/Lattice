# sc-007 — valueRef write mirror 実装証拠

対象: `seam-cost/sc-007`「read/write の区別を go/python/java のミラーへ広げる」

## 実装

- Go／Python／JavaのWASM抽出で、代入・複合代入・member／subscript mutation・updateを
  `references.metadata.write`へ出す。
- TS/JSを含むRust kernel 4 mirrorも同じmetadataを出す。scope内でread後にwriteした場合は
  最初のreadで確定せず、全走査後にwriteを合成する。
- Pythonのattribute／subscript assignmentをlocal shadowの宣言数へ含めない。Goの
  `short_var_declaration`が使う`expression_list`はshadow patternとして維持する。
- Rust wire contractの`EDGE_KINDS`へ既存の`invokes`をappendし、loaderのcontract rejectを解消する。
- `seam profile`の申告を`ts-js-arkts-go-python-java-all-routes`へ更新する。その他の
  valueRef対応言語では`metadata.write`のabsenceをread-onlyと解釈しない。

## 実環境

- `cargo 1.97.1 (c980f4866 2026-06-30)`
- `rustc 1.97.1 (8bab26f4f 2026-07-14)`
- `npm --prefix sensor run build:kernel`: darwin-arm64 native addonを実build・stage、exit 0

## gate

- `cargo test --manifest-path sensor/lattice-sensor-kernel/Cargo.toml`: 7 pass / 0 fail
- `value-reference-edges.test.ts`: 33 pass / 0 fail
- `kernel-tsjs-parity.test.ts -t 'value-reference write metadata parity'`: 4 pass / 0 fail
- `node --test test/seam-cost.test.mjs test/integration/runtime-seam-resolve-cli.integration.mjs`:
  11 pass / 0 fail
- `npm --prefix sensor run build`: exit 0
- `npm run ci`: canonical配布経路（任意native prebuildなし）でexit 0。product、sensor、syntax、
  CLI surface、open questions、reachability、ToDo storeの全gateがgreen。

`cargo fmt --check`はrustfmt 1.97が今回未変更のcrate全域へ数千行の既存format差分を要求するため、
greenとは記録しない。今回の変更箇所は`git diff --check`を通す。

## 分離した既存drift

native prebuildを有効にした全抽出parity 21件は、今回追加したwrite fixture 4件を含む7件がpass、
14件が既存の`extentStartLine`／dynamic import／function-ref／Go edge等のmirror driftでfailした。
sc-007のwrite metadata同値性は4言語すべてgreenだが、kernel全体がgreenとは扱わない。この事実は
ToDo note sequence 2にも保存した。
