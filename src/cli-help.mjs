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
  verify --request <request.json> --plan <plan.json>
`,
  run: `Usage: lattice run <command> [options]

Commands:
  start --request <request.json> --executor <adapter>
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
  gantt [--out <file>]
  gantt status [--out <file>]
  gantt serve --port <port>  # /projects/<project_id>/ をforeground配信
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
});

function requestedNamespace(argv) {
  if (argv.length === 2 && ['-h', '--help'].includes(argv[1])) return argv[0];
  if (argv.length === 2 && argv[0] === 'help') return argv[1];
  return null;
}

export function renderCliHelp(argv) {
  if (argv.length === 1 && ['-h', '--help', 'help'].includes(argv[0])) return ROOT_HELP;
  const namespace = requestedNamespace(argv);
  return namespace === null ? null : NAMESPACE_HELP[namespace] ?? null;
}
