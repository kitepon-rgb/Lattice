const ROOT_HELP = `Usage: lattice <command> [options]

Commands:
  status --json                 Discover the current project and next action
  plan <command>                Create, compile, or verify plans
  run <command>                 Start or observe compiled runs
  event verify                  Verify a runtime event log
  todo <command>                Read and update the canonical TODO store
  sensor <command>              Initialize or synchronize the bundled sensor
  factory-diagnostics --json    Check native factory integration
  runtime-errors <command>      Inspect the local runtime error store
  bridge <command>              Configure the optional network bridge

Options:
  -h, --help                    Show help
  --version                     Show the installed version
`;

const NAMESPACE_HELP = Object.freeze({
  plan: `Usage: lattice plan <command> [options]

Commands:
  create --input <file>
  create --schema --json
  create --schema-version <2|3> --json
  compile --request <request.json>
  compile --schema --json            # lattice.run_request.v1 の JSON Schema を出す
  verify --request <request.json> --plan <plan.json>
`,
  run: `Usage: lattice run <command> [options]

Commands:
  start --request <request.json> --executor <adapter>
  start --schema --json              # lattice.run_request.v1 の JSON Schema を出す
  observe --run .lattice/runs/<id>
  status --run .lattice/runs/<id>
  resume --run .lattice/runs/<id>
  close --run .lattice/runs/<id>
  abandon --run .lattice/runs/<id> --reason <reason>
  list --json
`,
  event: `Usage: lattice event verify --run .lattice/runs/<id>
`,
  todo: `Usage: lattice todo <command> [options]

Read commands:
  status [--json]
  verify [--plan <key>] [--json]
  snapshot --rebuild --plan <key>
  gantt [--out <file>] [--scope live|all]  # 既定live: 完走した工程を図から除く（一覧には残る）
  gantt status [--out <file>]
  gantt serve --port <port> [--scope live|all]  # /projects/<project_id>/ をforeground配信
  phase status --plan <key>

Write commands:
  start --plan <key> --task <id> [--parallel-frontier|--override-reason <text>]
  block --plan <key> --task <id> --reason <text>
  unblock --plan <key> --task <id>
  done --plan <key> --task <id> --evidence <file>
  reopen --plan <key> --task <id> --reason <text> [--override-reason <text>]
  evidence promote --plan <key> --task <id> --evidence <file>
  revise --plan <key> --input <file>
  revise-phase --plan <key> --input <file>
  revise-set --input <file>
  phase review --plan <key> --phase <id> --reason <text>
  phase <accept|reject> --plan <key> --phase <id> --input <file>
  phase reopen --plan <key> --phase <id> --reason <text> [--override-reason <text>]

Write commands require LATTICE_TODO_ACTOR_HOST, LATTICE_TODO_ACTOR_SESSION,
and LATTICE_TODO_ACTOR_AGENT.
`,
  sensor: `Usage: lattice sensor <init|sync> [path] --json
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
});

const SUBCOMMAND_USAGE = Object.freeze({
  'plan create': 'plan create --input <file> | --schema --json | --schema-version <2|3> --json',
  'plan compile': 'plan compile --request <request.json> | --schema --json',
  'plan verify': 'plan verify --request <request.json> --plan <plan.json>',
  'run start': 'run start --request <request.json> --executor <adapter> | --schema --json',
  'run observe': 'run observe --run .lattice/runs/<id>',
  'run status': 'run status --run .lattice/runs/<id>',
  'run resume': 'run resume --run .lattice/runs/<id>',
  'run close': 'run close --run .lattice/runs/<id>',
  'run abandon': 'run abandon --run .lattice/runs/<id> --reason <reason>',
  'run list': 'run list --json',
  'event verify': 'event verify --run .lattice/runs/<id>',
  'todo status': 'todo status [--json]',
  'todo verify': 'todo verify [--plan <key>] [--json]',
  'todo snapshot': 'todo snapshot --rebuild --plan <key>',
  'todo gantt': 'todo gantt [--out <file>] [--scope live|all] | status [--out <file>] | serve --port <port> [--scope live|all]',
  'todo phase': 'todo phase <status|review|accept|reject|reopen> --plan <key> [options]',
  'todo phase status': 'todo phase status --plan <key>',
  'todo phase review': 'todo phase review --plan <key> --phase <id> --reason <text>',
  'todo phase accept': 'todo phase accept --plan <key> --phase <id> --input <file>',
  'todo phase reject': 'todo phase reject --plan <key> --phase <id> --input <file>',
  'todo phase reopen': 'todo phase reopen --plan <key> --phase <id> --reason <text> [--override-reason <text>]',
  'todo start': 'todo start --plan <key> --task <id> [--parallel-frontier|--override-reason <text>]',
  'todo block': 'todo block --plan <key> --task <id> --reason <text>',
  'todo unblock': 'todo unblock --plan <key> --task <id>',
  'todo done': 'todo done --plan <key> --task <id> --evidence <file>',
  'todo reopen': 'todo reopen --plan <key> --task <id> --reason <text> [--override-reason <text>]',
  'todo evidence': 'todo evidence promote --plan <key> --task <id> --evidence <file>',
  'todo evidence promote': 'todo evidence promote --plan <key> --task <id> --evidence <file>',
  'todo revise': 'todo revise --plan <key> --input <file>',
  'todo revise-phase': 'todo revise-phase --plan <key> --input <file>',
  'todo revise-set': 'todo revise-set --input <file>',
  'sensor init': 'sensor init [path] --json',
  'sensor sync': 'sensor sync [path] --json',
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
  return namespace === null ? null : NAMESPACE_HELP[namespace] ?? null;
}
