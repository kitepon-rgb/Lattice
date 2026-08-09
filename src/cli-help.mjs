import { TODO_INDEPENDENCE_WORKFLOW } from './todo-independence-guidance.mjs';

const ROOT_HELP = `Usage: lattice <command> [options]

Commands:
  status --json                 Discover the current project and next action
  session-context --json        Session開始時の現在地を1プロセスで返す（工程状態＋並列可否）
  plan <command>                Create, compile, or verify plans
  run <command>                 Start or observe compiled runs
  event verify                  Verify a runtime event log
  todo <command>                Read and update the canonical TODO store
  sensor <command>              Initialize or synchronize the bundled sensor
  factory-diagnostics --json    Check native factory integration
  runtime-errors <command>      Inspect the local runtime error store
  bridge <command>              Configure the optional network bridge
  hooks <command>               Install and run sensor-awareness hooks

Options:
  -h, --help                    Show help
  --version                     Show the installed version
`;

const NAMESPACE_HELP = Object.freeze({
  plan: `Usage: lattice plan <command> [options]

Commands:
  create --input <file> [--serialization-reviewed]
      # 依存グラフがほぼ一直線（serialization_ratioが閾値超）なら一度突き返す。
      # 再考した上でなお直列でよいなら --serialization-reviewed を付けて再実行する
  create --schema --json             # 既定は最新版（v4）のJSON Schemaを返す
  create --schema-version <1|2|3|4> --json
  show <plan_key> --json             # task・依存・phase・状態をplan本体から1コマンドで投影する
  compile --request <request.json>
  compile --schema --json            # lattice.run_request.v1 の JSON Schema を出す
  verify --request <request.json> --plan <plan.json>
`,
  run: `Usage: lattice run <command> [options]

Commands:
  start --request <request.json> --executor <adapter>
  start --schema --json              # lattice.run_request.v1 の JSON Schema を出す
  adapter register --input <descriptor.json>
  adapter register --schema --json   # 登録入力の JSON Schema を出す
  adapter list --json
  observe --run .lattice/runs/<id>
  status --run .lattice/runs/<id>
  resume --run .lattice/runs/<id>
  close --run .lattice/runs/<id>
  abandon --run .lattice/runs/<id> --reason <reason>
  list --json
  seam profile --run .lattice/runs/<id> --finding <digest> --input <symbols.json>
      # 記録済みfindingの切断コスト内訳を投影する（read-only）。変換を試す前の安い観測で、
      # 入力は {"concern_symbols": {"T1": ["symbol"], ...}}。閾値も可否判定も返さない。
  seam resolve --run .lattice/runs/<id> --finding <digest> --input <request.json>
      # 記録済み競合を隔離worktreeで実際に変換し、五条件を通ればseam splitと後継baseを返す。
      # 入力(lattice.runtime_seam_request.v1)へ書くのは、係争fileの中で各TODOが触るsymbolと
      # 新しい面の名前だけ。branchは動かさないので、後継baseへ進めるかは呼び出し側が決める。
`,
  event: `Usage: lattice event verify --run .lattice/runs/<id>
`,
  todo: `Usage: lattice todo <command> [options]

Read commands:
  status [--json]
  show --plan <key> --task <id> --json  # 個別ToDoと最新bounded note contextを追加操作なしで返す
  note list --plan <key> [--task <id>] --json  # note全履歴の診断面（通常read/startでは不要）
  bindings [--plan <key>] [--json]   # compile_binding付きTaskをTODO identityつきで投影する
  independence [--plan <key>] [--json]  # readyを検証済み並列・要直列・未検査へ分けて投影する
  seam-profile --plan <key> --file <path> [--json]  # 係争fileの切断コスト内訳を投影する（read-only）
  seam-proposal [--plan <key>] [--json]  # 記録済みseam提案をsensor無しで投影する
  verify [--plan <key>] [--json]
  snapshot --rebuild --plan <key>
  gantt serve --port <port> [--scope live|all]  # 動的表示。静的HTML生成とstatusは廃止
  phase status --plan <key>

Write commands:
  dashboard adopt --json  # 衝突したproject_idの配信元rootを現在repoへ明示的に移す
  dashboard remove <project_id> --json  # 登録簿から1件外す（対象repoの外からも叩ける）
  note --plan <key> [--task <id>] (--message <text>|--input <file>)
      # ToDoへ作業継続に必要な方針・調査結果・注意をappend-onlyで追記する
  migrate --input <extraction.json> [--serialization-reviewed]
  migrate --input <extraction.json> --dry-run --json [--serialization-reviewed]
      # 既存storeへplanを追加する（plan createは空store初期化専用）。
      # 依存グラフがほぼ一直線なら一度突き返し、再考後の --serialization-reviewed で通す
  start --plan <key> --task <id> [--parallel-frontier|--override-reason <text> [--serial-confirmed]]
        # 既定は全ready同時dispatch。直列にするには理由の申告後、再考を経て --serial-confirmed が要る
  block --plan <key> --task <id> --reason <text>
  unblock --plan <key> --task <id>
  done --plan <key> --task <id> --evidence <file>
  reopen --plan <key> --task <id> --reason <text> [--override-reason <text>]
  evidence promote --plan <key> --task <id> --evidence <file>
  independence compile --plan <key> --input <file>  # witness setとsensorから並列可否を記録する
  independence witness migrate --plan <key>  # revision後の宣言をtask migrationで写す
  independence witness scaffold --plan <key> --input <draft>  # 下書きとfresh観測から宣言を書き出す
  seam-proposal compile --plan <key>  # 並列可否記録と実sensorからseam提案を記録する
  seam-proposal apply --plan <key>  # 記録済み提案を隔離worktreeで適用し五条件で採否を決める
  seam-proposal land --plan <key> --names <file>  # 採用された変換を本ツリーへ着地させる
  revise --plan <key> --input <file>
  revise-phase --plan <key> --input <file>
  revise-set --input <file>
  <revise|revise-phase|revise-set|migrate> --schema --json
      # 実際に受理する最新契約のJSON Schemaを返す（storeを読まない）。
      # 入力が契約に合わないときは、違反フィールドのpathがerror detailへ載る
  phase review --plan <key> --phase <id> --reason <text>
  phase <accept|reject> --plan <key> --phase <id> --input <file>
  phase reopen --plan <key> --phase <id> --reason <text> [--override-reason <text>]
  phase close-unaudited --plan <key> --phase <id> --reason <text>
      # 監査せず「監査なしで閉じた」として明示的に閉じる(ADR 0148)。前提はgate_readyで、
      # acceptedへは化けない(phase_accept_dependenciesを解錠しない)
  phase baseline --reason <text> [--except <plan_key>]...
      # 現在gate_readyかつphase eventを1つも持たないPhaseを一括でclosed_unauditedへ宣言する。
      # 自動実行はしない(明示コマンドのみ)。--exceptで指定したplanは対象から除外する

Write commands require LATTICE_TODO_ACTOR_HOST, LATTICE_TODO_ACTOR_SESSION,
and LATTICE_TODO_ACTOR_AGENT.

並列可否（依存線の不在は、書き込み境界が干渉しないことを意味しない）:
${TODO_INDEPENDENCE_WORKFLOW.join('\n')}

判定していない工程は「競合が無い」ではなく「未検査」として扱われ、
todo startのadvisoryとtodo independenceの投影が、その状況と次の一歩を返す。
`,
  sensor: `Usage: lattice sensor <init|sync> [path] --json
       lattice sensor diff <rootA> <rootB> [options] --json

diff options:
  --subtree-a <rel>     # A側をこの部分木だけに絞り、prefixを剥がしてから突き合わせる
  --subtree-b <rel>     # B側の同上（例: Latticeのsensor/とupstreamのrootを揃える）
  --map-a <from>=<to>   # A側のpath改名写像。繰り返し可（最長prefix一致で1回だけ適用）
  --map-b <from>=<to>   # B側の同上
  --limit <n>           # 明細1覧あたりの上限（既定200・0で無制限）。切った量はtruncationへ出る

突き合わせは行番号を含まない自然キー（kind|path|qualified_name|name）で行う。node idは
行番号を含むので、idで比べると数行のズレが全て偽の追加＋削除になる。辺も端点を自然キーへ
解決してから比べる。比較できなかった辺（端点がsubtree外・index不整合）はexcludedへ件数で出る。
両側のextraction versionが違う時はcomparability.statusがdegradedになる——その差分は
codeの変化だけを意味しない。
`,
  'factory-diagnostics': `Usage: lattice factory-diagnostics --json
`,
  'runtime-errors': `Usage: lattice runtime-errors <command> --json

Commands:
  snapshot [--after-cursor <n>] [--limit <n>]
  ack <cursor>
  diagnostics
  resolve <fingerprint>
  reopen <fingerprint>
  compact
`,
  bridge: `Usage: lattice bridge <command> [options] --json

Commands:
  setup --listen <IP> [--port <49152..65535|auto>] [--dashboard|--upstream <URL>] [--allow-host <host>...]
  reconfigure [--listen <IP>] [--port <49152..65535|auto>] [--dashboard|--upstream <URL>] [--allow-host <host>...]
  status
  disable
  register    # 現在のlisten portをreverse proxy hostへ自己登録する

registerはLATTICE_BRIDGE_REGISTRAR_SSH_HOSTとLATTICE_BRIDGE_REGISTRAR_SCRIPTが
両方設定されている時だけ動く。アドレスは送らず、remote側がssh送信元から決める。
`,
  hooks: `Usage: lattice hooks <install|status|uninstall|emit> --host <claude|codex>
`,
});

const SUBCOMMAND_USAGE = Object.freeze({
  status: 'status --json',
  'session-context': 'session-context --json',
  'plan create': 'plan create --input <file> [--serialization-reviewed] | --schema --json | --schema-version <1|2|3|4> --json',
  'plan show': 'plan show <plan_key> --json',
  'plan compile': 'plan compile --request <request.json> | --schema --json',
  'plan verify': 'plan verify --request <request.json> --plan <plan.json>',
  'run start': 'run start --request <request.json> --executor <adapter> | --schema --json',
  'run adapter register': 'run adapter register --input <descriptor.json> | --schema --json',
  'run adapter list': 'run adapter list --json',
  'run observe': 'run observe --run .lattice/runs/<id>',
  'run status': 'run status --run .lattice/runs/<id>',
  'run resume': 'run resume --run .lattice/runs/<id>',
  'run landing': 'run landing --run .lattice/runs/<id>',
  'run close': 'run close --run .lattice/runs/<id>',
  'run abandon': 'run abandon --run .lattice/runs/<id> --reason <reason>',
  'run list': 'run list --json',
  'run activate': 'run activate --run .lattice/runs/<id>',
  'run conflict': 'run conflict --run .lattice/runs/<id> --finding <digest>',
  'run hold': 'run hold --run .lattice/runs/<id> --finding <digest>',
  'run recompile': 'run recompile --run .lattice/runs/<id> --input <recompile-request.json>',
  'run reprocess': 'run reprocess --run .lattice/runs/<id>',
  'run finding record': 'run finding record --run .lattice/runs/<id> --checkpoint <digest> --input <candidate.json>',
  'run seam profile': 'run seam profile --run .lattice/runs/<id> --finding <digest> --input <symbols.json>',
  'run seam resolve': 'run seam resolve --run .lattice/runs/<id> --finding <digest> --input <seam-request.json>',
  'event verify': 'event verify --run .lattice/runs/<id>',
  'todo status': 'todo status [--json]',
  'todo show': 'todo show --plan <key> --task <id> --json',
  'todo note': 'todo note --plan <key> [--task <id>] (--message <text>|--input <file>) | list --plan <key> [--task <id>] --json',
  'todo note list': 'todo note list --plan <key> [--task <id>] --json',
  'todo bindings': 'todo bindings [--plan <key>] [--json]',
  'todo independence': 'todo independence [--plan <key>] [--json] | compile --plan <key> --input <file> | witness migrate --plan <key>',
  'todo seam-profile': 'todo seam-profile --plan <key> --file <path> [--json]',
  'todo seam-proposal': 'todo seam-proposal [--plan <key>] [--json] | compile --plan <key>',
  'todo verify': 'todo verify [--plan <key>] [--json]',
  'todo snapshot': 'todo snapshot --rebuild --plan <key>',
  'todo gantt': 'todo gantt serve --port <port> [--scope live|all]  # 動的表示のみ。静的HTML生成は廃止',
  'todo gantt serve': 'todo gantt serve --port <0..65535> [--scope live|all]  # loopback動的viewer',
  'todo dashboard': 'todo dashboard adopt --json | remove <project_id> --json'
    + '  # 配信元rootの衝突を明示的に解消／登録簿から1件外す',
  'todo dashboard adopt': 'todo dashboard adopt --json  # 現在repoをproject_idの配信元として明示採用',
  'todo dashboard remove': 'todo dashboard remove <project_id> --json  # 登録簿から1件外す（対象repo不在でも可）',
  'todo phase': 'todo phase <status|review|accept|reject|reopen|close-unaudited> --plan <key> [options]'
    + ' | baseline --reason <text> [--except <plan_key>]...',
  'todo phase status': 'todo phase status --plan <key>',
  'todo phase review': 'todo phase review --plan <key> --phase <id> --reason <text>',
  'todo phase accept': 'todo phase accept --plan <key> --phase <id> --input <file>',
  'todo phase reject': 'todo phase reject --plan <key> --phase <id> --input <file>',
  'todo phase reopen': 'todo phase reopen --plan <key> --phase <id> --reason <text> [--override-reason <text>]',
  'todo phase close-unaudited': 'todo phase close-unaudited --plan <key> --phase <id> --reason <text>',
  'todo phase baseline': 'todo phase baseline --reason <text> [--except <plan_key>]...',
  'todo start': 'todo start --plan <key> --task <id> [--parallel-frontier|--override-reason <text>]',
  'todo block': 'todo block --plan <key> --task <id> --reason <text>',
  'todo unblock': 'todo unblock --plan <key> --task <id>',
  'todo done': 'todo done --plan <key> --task <id> --evidence <file>',
  'todo reopen': 'todo reopen --plan <key> --task <id> --reason <text> [--override-reason <text>]',
  'todo evidence': 'todo evidence promote --plan <key> --task <id> --evidence <file>',
  'todo evidence promote': 'todo evidence promote --plan <key> --task <id> --evidence <file>',
  'todo revise': 'todo revise --plan <key> --input <file> | --schema --json',
  'todo revise-phase': 'todo revise-phase --plan <key> --input <file> | --schema --json',
  'todo revise-set': 'todo revise-set --input <file> | --schema --json',
  'todo migrate': 'todo migrate --input <extraction.json> [--serialization-reviewed] | --input <extraction.json> --dry-run --json [--serialization-reviewed] | --schema --json',
  'sensor init': 'sensor init [path] --json',
  'sensor sync': 'sensor sync [path] --json',
  'sensor diff': 'sensor diff <rootA> <rootB> [--subtree-a <rel>] [--subtree-b <rel>]'
    + ' [--map-a <from>=<to>] [--map-b <from>=<to>] [--limit <n>] --json',
  'runtime-errors snapshot': 'runtime-errors snapshot [--after-cursor <n>] [--limit <n>] --json',
  'runtime-errors ack': 'runtime-errors ack <cursor> --json',
  'runtime-errors diagnostics': 'runtime-errors diagnostics --json',
  'runtime-errors resolve': 'runtime-errors resolve <fingerprint> --json',
  'runtime-errors reopen': 'runtime-errors reopen <fingerprint> --json',
  'runtime-errors compact': 'runtime-errors compact --json',
  'bridge setup': 'bridge setup --listen <IP> [--port <49152..65535|auto>] [--dashboard|--upstream <URL>] [--allow-host <host>...] --json',
  'bridge reconfigure': 'bridge reconfigure [--listen <IP>] [--port <49152..65535|auto>] [--dashboard|--upstream <URL>] [--allow-host <host>...] --json',
  'bridge status': 'bridge status --json',
  'bridge disable': 'bridge disable --json',
  'bridge register': 'bridge register --json',
  'hooks install': 'hooks install --host <claude|codex>',
  'hooks status': 'hooks status --host <claude|codex>',
  'hooks uninstall': 'hooks uninstall --host <claude|codex>',
  'hooks emit': 'hooks emit --host <claude|codex>',
});

function requestedNamespace(argv) {
  if (argv.length === 2 && ['-h', '--help'].includes(argv[1])) return argv[0];
  if (argv.length === 2 && argv[0] === 'help') return argv[1];
  return null;
}

function requestedSubcommand(argv) {
  if (argv.length >= 3 && ['-h', '--help'].includes(argv.at(-1))) {
    return argv.slice(0, -1).join(' ');
  }
  if (argv.length >= 3 && argv[0] === 'help') return argv.slice(1).join(' ');
  return null;
}

export function renderCliHelp(argv) {
  if (argv.length === 1 && ['-h', '--help', 'help'].includes(argv[0])) return ROOT_HELP;
  const subcommand = requestedSubcommand(argv);
  if (subcommand !== null) {
    const usage = SUBCOMMAND_USAGE[subcommand];
    return usage === undefined ? null : `Usage: lattice ${usage}\n`;
  }
  const namespace = requestedNamespace(argv);
  if (namespace === null) return null;
  // namespaceを持たない1語コマンド（status等）は、SUBCOMMAND_USAGEへ落ちる。
  // 落とさないと「存在するのに使い方を知る手段が無い」コマンドになる。
  if (NAMESPACE_HELP[namespace] !== undefined) return NAMESPACE_HELP[namespace];
  const usage = SUBCOMMAND_USAGE[namespace];
  return usage === undefined ? null : `Usage: lattice ${usage}\n`;
}
