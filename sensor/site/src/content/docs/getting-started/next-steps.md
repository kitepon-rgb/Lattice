---
title: Next Steps
description: Where to go once CodeGraph is installed and indexing.
---

> **旧上流documentation（未配布）**: このページの名称、URL、CLI、設定、効果量は現行Latticeの仕様ではありません。現行仕様はroot `README.md` と `docs/00_product-contract.md` を参照してください。

You've got CodeGraph installed and a graph built. Here's where to go next.

## Understand the model

- [How It Works](/codegraph/core-concepts/how-it-works/) — the extraction → storage → resolution → sync pipeline.
- [The Knowledge Graph](/codegraph/core-concepts/knowledge-graph/) — the node and edge kinds the graph is built from.
- [Resolution & Frameworks](/codegraph/core-concepts/resolution/) — how references and framework routes get connected.

## Put it to work

- [Indexing a Project](/codegraph/guides/indexing/) — full index, incremental sync, and the file watcher.
- [Framework Routes](/codegraph/guides/framework-routes/) — link URL patterns to their handlers.
- [Affected Tests in CI](/codegraph/guides/affected-tests/) — run only the tests a change touches.

## Reference

- [MCP Server](/codegraph/reference/mcp-server/) — the tools agents call.
- [CLI](/codegraph/reference/cli/) — every command and flag.
- [API](/codegraph/reference/api/) — use CodeGraph as a TypeScript library.
- [Integrations](/codegraph/reference/integrations/) — supported agents and manual setup.
