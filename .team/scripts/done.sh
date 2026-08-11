#!/bin/bash
# usage: .team/scripts/done.sh <task_id> [--evidence-from <隔離worktreeの証跡の絶対path>]
#        .team/scripts/done.sh --landing-run <run_ref>
# evidence/<plan_key>/<task_id>.md（commit 済みであること）から記述子を作り lattice todo done を実行する。
# plan key は環境変数 PEERTABLE_PLAN から取る。
# 証跡を plan key で仕切るのは、task_id が campaign を跨いで再利用される（t1, t2, …）ため。
# 平置きだと次の campaign の t1 が前の campaign の t1 の監査証跡を上書きで消す（2026-08-08 実測）。
#
# **`--evidence-from` は pull 型の実行層で使う。** 席は隔離 worktree の中だけを触るので、
# 証跡もそこにしか無い。一方 `todo done` は **canonical の store** へ打たないと、run の accept が
# その done を見ない。cwd 1つで両方を兼ねると必ずどちらかが外れる（mio の監査で実測・room [1012]）:
#   canonical で打つ → worktree にしか無い証跡を読めない
#   worktree で打つ → worktree 側の `.lattice/todo` を書き、canonical の accept が見ない
# なので **証跡の blob/digest は worktree の file から、`todo done` は canonical の cwd/store へ**、と
# 明示的に分ける。**canonical へ証跡を別書きして通すのは禁止**——「worktree の中だけ」の契約を
# 破りながら green にする偽装になる。
#
# 成立する理由: linked worktree は canonical と object DB を共有するので、canonical の cwd から
# `git hash-object -w <worktree の絶対path>` で書いた blob はそのまま canonical で読める。
# evidence verifier は descriptor.path の working tree 実在を見ず、object DB の blob と digest、
# 読み出し時の `rev-list --all` 到達性を見る（mio が実 repo で確認・room [1016]）。
set -e
# `todo done` と run receipt の accept は別の正本を持つ。landing-only mode は accept の直後に
# 同じ run ref を受け取り、受理済み receipt の着地だけを表示する。accept 自体はここへ吸収しない。
if [ "${1:-}" = "--landing-run" ]; then
  [ "$#" = 2 ] || {
    echo "ERROR: --landing-run には run ref を1つ渡すこと（usage: done.sh --landing-run <run_ref>）" >&2
    exit 1
  }
  run_ref="$2"
  [ -n "$run_ref" ] || { echo "ERROR: --landing-run には run ref を渡すこと" >&2; exit 1; }
  lattice_cli="${LATTICE_CLI:-$(command -v lattice 2>/dev/null || true)}"
  if [ -z "$lattice_cli" ] || [ ! -x "$lattice_cli" ]; then
    echo "着地状態を読めない: LATTICE_CLIが実行可能fileを指さない（${lattice_cli:-未設定}）" >&2
    exit 0
  fi
  landing_report=""
  landing_rc=0
  landing_report=$("$lattice_cli" run landing --run "$run_ref" 2>&1) || landing_rc=$?
  if [ "$landing_rc" != 0 ]; then
    echo "着地状態を読めない: run landing が rc=${landing_rc} で失敗: ${landing_report}" >&2
    exit 0
  fi
  unlanded_count=""
  if ! unlanded_count=$(printf '%s' "$landing_report" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    report = json.loads(raw)
except json.JSONDecodeError as error:
    sys.exit(f"run landing がJSONでない: {error}")
if not isinstance(report, dict):
    sys.exit(f"run landing がobjectでない: {type(report).__name__}")
actual_schema = report.get("schema")
if actual_schema != "lattice.run_landing_report.v1":
    sys.exit(f"run landing の schema が違う: {actual_schema}")
receipts = report.get("accepted_receipts")
if not isinstance(receipts, list):
    sys.exit("run landing に accepted_receipts 配列が無い")
for index, receipt in enumerate(receipts):
    if not isinstance(receipt, dict) or not isinstance(receipt.get("landed"), bool):
        sys.exit(f"accepted_receipts[{index}] の landed が真偽値でない")
print(sum(1 for receipt in receipts if not receipt["landed"]))
' 2>&1); then
    echo "着地状態を読めない: ${unlanded_count}" >&2
    exit 0
  fi
  if [ "$unlanded_count" != 0 ]; then
    echo "未着地 ${unlanded_count}本: run ${run_ref} の受理済み成果が canonical default branch へ着地していない" >&2
  fi
  exit 0
fi
# **引数の形を exact に要求する。** 緩く受けると、`--evidnce-from` のような typo が
# 「option 無し」として通り、**canonical 側の同名証跡を黙って hash する**——別 file を
# 受理させておいて green に見える（kanade の監査で実測・room [1029]）。
# 1引数（既定経路）か、3引数（`<task> --evidence-from <絶対path>`）だけを許す。
case $# in
  1) ;;
  3) [ "$2" = "--evidence-from" ] || {
       echo "ERROR: 未知のoption: $2（使えるのは --evidence-from だけ）" >&2; exit 1; } ;;
  *) echo "ERROR: 引数の形が違う（usage: done.sh <task_id> [--evidence-from <絶対path>] | done.sh --landing-run <run_ref>）" >&2; exit 1 ;;
esac
t="$1"
[ -n "$t" ] || { echo "ERROR: task_id が空" >&2; exit 1; }
evidence_from=""
if [ "$#" = 3 ]; then
  evidence_from="$3"
  [ -n "$evidence_from" ] || { echo "ERROR: --evidence-from には証跡fileの絶対pathを渡すこと" >&2; exit 1; }
  case "$evidence_from" in
    /*) ;;
    *) echo "ERROR: --evidence-from は絶対pathでなければならない: $evidence_from" >&2; exit 1 ;;
  esac
  # **黙って canonical の証跡へ落ちない。** 落ちると「worktree の成果を done した」と見えるのに
  # 実際は別の file を hash することになり、受理された内容と成果物が食い違う
  [ -f "$evidence_from" ] || { echo "ERROR: --evidence-from の証跡が存在しない: $evidence_from" >&2; exit 1; }
  # **object DB を共有していない木の file は hash-object できても意味が無い。** 別 repo の
  # 証跡を渡された時に「書けたから成立した」と読まないよう、common git dir の一致を要求する
  # （kanade の設計指摘・room [1018]）。linked worktree なら両者は同じ絶対 path を指す。
  here_common=$(git rev-parse --path-format=absolute --git-common-dir)
  from_common=$(git -C "$(dirname "$evidence_from")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  [ -n "$from_common" ] && [ "$here_common" = "$from_common" ] || {
    echo "ERROR: --evidence-from が同じrepoのworktreeでない（object DBを共有していない）" >&2
    echo "  canonical: ${here_common}" >&2
    echo "  evidence : ${from_common:-（git worktree ではない）}" >&2
    exit 1
  }
fi

# descriptor の path は repo 内の相対（repo 外の絶対 path は --evidence が INVALID_ARGUMENTS で弾く）。
# worktree でも canonical でも同じ相対 path に置く規約なので、この値は両者で一致する。
f="evidence/$PEERTABLE_PLAN/$t.md"
src="${evidence_from:-$f}"
[ -f "$src" ] || { echo "ERROR: 証跡が見つからない: $src" >&2; exit 1; }
oid=$(git hash-object -w "$src")
digest=$(shasum -a 256 "$src" | cut -d' ' -f1)
tmp=".ev-$t.json"
# **失敗しても記述子を残さない。** `set -e` の下で `todo done` が落ちると、後段の `rm` へ
# 到達せず repo に `.ev-<task>.json` が残る（自分の負側 test で実測。TASK_NOT_FOUND の後に
# untracked file が残った）。次に `git status` を撮った人が、それを誰かの作業中変更と読む。
trap 'rm -f "$tmp"' EXIT
printf '{"evidence_id":"ev-%s","repo_id":"self","path":"%s","git_blob_oid":"%s","content_digest":"%s","media_type":"text/markdown","anchor_digest":null}\n' "$t" "$f" "$oid" "$digest" > "$tmp"
# **PATH の `lattice` へ黙って逸れない。** setup が解決した CLI を席 env の `LATTICE_CLI` で受け、
# 無い時だけ PATH を使う（bridge の `--lattice` / teardown の `LATTICE_CLI` と同じ選択規律）。
"${LATTICE_CLI:-lattice}" todo done --plan "$PEERTABLE_PLAN" --task "$t" --evidence "$tmp"
rm -f "$tmp"

# 完了の定義は「repo 内の変更は push まで」。done を打つ瞬間はそれが成り立っていなければ
# ならない唯一の時点で、かつ全員が必ず通る場所である。publish 経路の機械 gate は tarball
# しか見ないので、docs・証跡・experiments はその外側にある——黙ると誰も見ていない場所へ
# 成果物が取り残される（2026-08-08 実測。卓の全員が立っていた穴で、親の監査が見つけた）。
# 出すだけで止めない: push 既定でない repo も、まとめて push する運用も壊さないため。
# upstream 未設定・git 管理外でも done.sh 自体は死なせない（set -e の下なので必ずガードする）。
unpushed=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || true)
if [ -n "$unpushed" ] && [ "$unpushed" != 0 ]; then
  echo "未push ${unpushed}本: この done の成果物はまだ upstream へ着地していない" >&2
fi

# 外部ペインの喪失検出。Lattice 併用モードの卓は、公開工程表の右ペインに円卓が出ているのが正常。
# 2026-08-08、受入検証が本番のコネクタを「外して痕跡ゼロ」まで確かめて終わり、差し直しが人の記憶
# 頼みで漏れて、公開工程表から円卓が消えたままになった（オーナー発見）。**外したことは誰も間違えて
# いない——戻し忘れを誰も見ていなかった**ので、全員が必ず通る done の一点で見る。
# 未push 警告と同じ作法: 出すだけで止めない・読めない時は黙って継続する（この警告のために done.sh を殺さない）。
pane_missing=$(python3 - <<'PY' 2>/dev/null || true
import json
try:
    state = json.load(open('.team/setup-state.json'))
except Exception:
    raise SystemExit          # 卓が無い/読めない＝判定しない
if state.get('mode') != 'lattice':
    raise SystemExit          # 単独円卓モードには工程表が無い
try:
    identity = json.load(open('.lattice/project.json'))
except Exception:
    identity = {}
if not identity.get('external_pane'):
    print('yes')
PY
)
if [ "$pane_missing" = yes ]; then
  echo "外部ペインが未設置か読めない: 公開工程表に円卓が出ていない（差し直す: node <skill>/scripts/external-pane.mjs . <room> <public_base>）" >&2
fi
