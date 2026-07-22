# Lattice Sensor

Lattice Sensor is the structural code index bundled with Lattice. It is not a
standalone product and has no independent installation or host-integration path.

Use it only through the Lattice CLI or Lattice MCP server:

```sh
lattice sensor init /path/to/project --json
lattice sensor sync /path/to/project --json
lattice-mcp
```

When an AI agent encounters an unindexed project, it may decide that the
one-time indexing cost is justified by fewer repeated reads and searches. If
its host grants workspace writes and shell execution, it may run
`lattice sensor init <projectPath> --json` itself; otherwise it should continue
with built-in tools and give the user the exact command.

Project state is owned by Lattice at `.lattice/sensor/`. The runtime never reads
or migrates a retired external cache, executable, package, environment variable,
daemon registry, or MCP tool name.

Initialization creates `.lattice/sensor/.gitignore` as the local-state guard.
That guard may be tracked by the project; the database, daemon files, sockets,
and logs remain ignored.

The embedded fork retains its upstream license and attribution in `LICENSE` and
`NOTICE`. Those files document provenance only; they are not runtime contracts.
