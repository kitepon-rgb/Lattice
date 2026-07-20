# Lattice Sensor

Lattice Sensor is the structural code index bundled with Lattice. It is not a
standalone product and has no independent installation or host-integration path.

Use it only through the Lattice CLI or Lattice MCP server:

```sh
lattice sensor init /path/to/project
lattice sensor status /path/to/project --json
lattice-mcp
```

Project state is owned by Lattice at `.lattice/sensor/`. The runtime never reads
or migrates a retired external cache, executable, package, environment variable,
daemon registry, or MCP tool name.

The embedded fork retains its upstream license and attribution in `LICENSE` and
`NOTICE`. Those files document provenance only; they are not runtime contracts.
