/**
 * JS/TS `child_process` process-spawn detection and target folding (ADR 0048,
 * Lattice sensor correctness fix c/1 — first "call graph非可視の結合" index).
 *
 * `spawnSync(process.execPath, [BIN, ...args])` reaches `BIN` by starting a
 * brand-new OS process, not by calling a JS function — no `calls` edge can
 * ever represent it, so a spawn-driven test harness (the oracle shape:
 * `tests/orchestrate/helpers.mjs` spawning `bin/orchestrate-run.mjs`) showed
 * zero `affected` dependents even though changing the spawned file plainly
 * breaks the test. This module detects the five `child_process` launch
 * functions (`spawn`, `spawnSync`, `execFile`, `execFileSync`, `fork`) —
 * `exec`/`execSync` (shell-string parsing) are OUT OF SCOPE, see
 * `resolveChildProcessCallee`'s doc — and folds their target argument(s) to a
 * project-relative path using the same constant-folding engine as dynamic
 * `import()`/`require()` (dynamic-import.ts's `foldConstantExpr`).
 *
 * Detection REQUIRES the callee to be verified bound to `child_process` (a
 * static `import`/aliased/namespace member, or a simple
 * `const { spawnSync } = require('node:child_process')`) — a bare name match
 * on a user-defined `spawn()` must NOT produce an edge (mirrors fix (a)'s
 * no-name-match-fallback principle).
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import * as posixPath from 'path';
import { getChildByField, getNodeText } from './tree-sitter-helpers';
import { foldConstantExpr } from './dynamic-import';

/**
 * Sentinel `referenceName` for a `fork(...)` call whose module argument could
 * NOT be statically folded. Mirrors `DYNAMIC_IMPORT_UNRESOLVED_MARKER`
 * (dynamic-import.ts): illegal as both a JS identifier and a file path
 * (angle brackets, colon), so it can never coincidentally name-match a real
 * file, and is pushed as a normal unresolved reference so it surfaces as
 * `status='failed'` rather than being silently dropped. `fork`'s target is
 * ALWAYS a JS module (unlike `spawn`/`exec*`, whose target is usually an
 * external binary) — so an unfoldable `fork` argument stays visible, while
 * an unfoldable `spawn`/`execFile*` argument is a silent skip (see
 * `resolveInvokesTargets`'s case (iv) — spawn's target domain is mostly
 * external commands, so "couldn't fold" carries no useful signal there).
 */
export const SPAWN_INVOKES_UNRESOLVED_MARKER = '<spawn:unresolved>';

const CHILD_PROCESS_SPAWN_FNS = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']);

function isChildProcessSpecifier(text: string): boolean {
  return text === 'child_process' || text === 'node:child_process';
}

/** Per-file table of local names verified bound to `child_process`'s launch functions. */
export interface ChildProcessBindings {
  /** local identifier -> canonical child_process function name (`spawn`, `fork`, ...) */
  readonly localFns: ReadonlyMap<string, string>;
  /** local identifiers bound as a `child_process` namespace (`import * as cp from 'child_process'`) */
  readonly namespaces: ReadonlySet<string>;
}

const EMPTY_BINDINGS: ChildProcessBindings = { localFns: new Map(), namespaces: new Set() };

/**
 * Scan the file's top-level (Program direct-child) statements for bindings of
 * `child_process`'s spawn family. Two binding shapes, per spec:
 *   - static `import` — named (`import { spawnSync } from 'child_process'`,
 *     alias-aware), or namespace (`import * as cp from 'node:child_process'`,
 *     later matched via `cp.spawnSync(...)`).
 *   - simple CommonJS destructure — `const { spawnSync } = require('node:child_process')`
 *     (module-level only; `let`/`var` excluded like dynamic-import.ts's
 *     module-level-const fold, since a reassignable binding's declaration-site
 *     value isn't necessarily the call-site value).
 * A default import isn't a meaningful binding shape for this module (no
 * useful default export) and is intentionally not recognized.
 */
export function collectChildProcessBindings(anyNodeInTree: SyntaxNode, source: string): ChildProcessBindings {
  const root = anyNodeInTree.tree.rootNode;
  const localFns = new Map<string, string>();
  const namespaces = new Set<string>();

  for (let i = 0; i < root.namedChildCount; i++) {
    let stmt = root.namedChild(i);
    if (!stmt) continue;

    if (stmt.type === 'import_statement') {
      const sourceField = getChildByField(stmt, 'source');
      const specifierText = sourceField ? getNodeText(sourceField, source).replace(/['"]/g, '') : '';
      if (!isChildProcessSpecifier(specifierText)) continue;
      const clause = stmt.namedChildren.find((c) => c?.type === 'import_clause');
      if (!clause) continue;
      for (const child of clause.namedChildren) {
        if (!child) continue;
        if (child.type === 'named_imports') {
          for (const spec of child.namedChildren) {
            if (!spec || spec.type !== 'import_specifier') continue;
            const nameNode = getChildByField(spec, 'name');
            const aliasNode = getChildByField(spec, 'alias');
            const imported = nameNode ? getNodeText(nameNode, source) : '';
            if (!CHILD_PROCESS_SPAWN_FNS.has(imported)) continue;
            const local = aliasNode ? getNodeText(aliasNode, source) : imported;
            if (local) localFns.set(local, imported);
          }
        } else if (child.type === 'namespace_import') {
          const idNode = child.namedChildren.find((c) => c?.type === 'identifier') ?? child.namedChild(0);
          const local = idNode ? getNodeText(idNode, source) : '';
          if (local) namespaces.add(local);
        }
      }
      continue;
    }

    if (stmt.type === 'lexical_declaration') {
      const kindNode = getChildByField(stmt, 'kind');
      if (kindNode?.type !== 'const') continue;
      for (let j = 0; j < stmt.namedChildCount; j++) {
        const declarator = stmt.namedChild(j);
        if (declarator?.type !== 'variable_declarator') continue;
        const nameNode = getChildByField(declarator, 'name');
        const valueNode = getChildByField(declarator, 'value');
        if (!nameNode || nameNode.type !== 'object_pattern' || !valueNode) continue;
        if (valueNode.type !== 'call_expression') continue;
        const fn = getChildByField(valueNode, 'function');
        if (!fn || fn.type !== 'identifier' || getNodeText(fn, source) !== 'require') continue;
        const argsNode = getChildByField(valueNode, 'arguments');
        const args = argsNode ? argsNode.namedChildren.filter((n): n is SyntaxNode => !!n) : [];
        if (args.length !== 1 || args[0]!.type !== 'string') continue;
        const fragment = args[0]!.namedChildren.find((c) => c?.type === 'string_fragment');
        const specifierText = fragment ? getNodeText(fragment, source) : '';
        if (!isChildProcessSpecifier(specifierText)) continue;

        for (let k = 0; k < nameNode.namedChildCount; k++) {
          const prop = nameNode.namedChild(k);
          if (!prop) continue;
          let imported = '';
          let local = '';
          if (prop.type === 'shorthand_property_identifier_pattern') {
            imported = getNodeText(prop, source);
            local = imported;
          } else if (prop.type === 'pair_pattern') {
            const keyNode = getChildByField(prop, 'key');
            const valNode = getChildByField(prop, 'value');
            imported = keyNode ? getNodeText(keyNode, source) : '';
            local = valNode ? getNodeText(valNode, source) : imported;
          } else {
            continue;
          }
          if (imported && local && CHILD_PROCESS_SPAWN_FNS.has(imported)) localFns.set(local, imported);
        }
      }
    }
  }

  return localFns.size === 0 && namespaces.size === 0 ? EMPTY_BINDINGS : { localFns, namespaces };
}

/**
 * True when `node` is `process.execPath` (a `member_expression`, not folded
 * by `foldConstantExpr` — its only member_expression shape is
 * `import.meta.dirname`). Distinguishing this from a general expression fold
 * is what lets `spawn(process.execPath, [...])` route into the array-element
 * folding branch (case (ii) below) instead of failing to fold argv[0].
 */
function isProcessExecPath(node: SyntaxNode, source: string): boolean {
  if (node.type !== 'member_expression') return false;
  const object = getChildByField(node, 'object');
  const property = getChildByField(node, 'property');
  return (
    !!object &&
    object.type === 'identifier' &&
    getNodeText(object, source) === 'process' &&
    !!property &&
    getNodeText(property, source) === 'execPath'
  );
}

/**
 * Given a `call_expression` node, return the canonical `child_process`
 * function name (`spawn`/`spawnSync`/`execFile`/`execFileSync`/`fork`) it
 * invokes, or null when the callee isn't verified bound to one. Two callee
 * shapes: a bare identifier bound via `localFns` (static named import or the
 * `require` destructure), or a `<namespace>.<fn>` member access where
 * `<namespace>` is a verified `import * as cp from 'child_process'` binding.
 *
 * `exec`/`execSync` are deliberately excluded — their single argument is a
 * whole shell command line (`"git status && ls"`), which requires shell
 * grammar parsing (quoting, pipes, `&&`, env vars) to extract a target file,
 * not the argv-array shape this module folds. Out of scope for this fix.
 */
export function resolveChildProcessCallee(
  node: SyntaxNode,
  source: string,
  bindings: ChildProcessBindings
): string | null {
  if (node.type !== 'call_expression') return null;
  const fn = getChildByField(node, 'function');
  if (!fn) return null;

  if (fn.type === 'identifier') {
    return bindings.localFns.get(getNodeText(fn, source)) ?? null;
  }

  if (fn.type === 'member_expression') {
    const object = getChildByField(fn, 'object');
    const property = getChildByField(fn, 'property');
    if (!object || object.type !== 'identifier' || !property) return null;
    if (!bindings.namespaces.has(getNodeText(object, source))) return null;
    const propName = getNodeText(property, source);
    return CHILD_PROCESS_SPAWN_FNS.has(propName) ? propName : null;
  }

  return null;
}

/**
 * Fold `node` to a constant string (`foldConstantExpr`), then — ONLY when the
 * result is a `./`/`../`-relative specifier — rewrite it into the same
 * project-relative, extension-included path space the resolver's exact-match
 * expects (import-resolver.ts's `invokes` branch does plain path equality,
 * no module resolution). A `join(ROOT, ...)`/`resolve(...)`-folded result is
 * already project-relative (dynamic-import.ts's `foldJoinResolve` produces
 * that form) and passes through untouched; a bare command name (`'git'`) has
 * no `./`/`../` prefix and also passes through untouched — the resolver's
 * exact match on a real file node is what turns "didn't fold to a real
 * file" into "no edge", not this function. A relative specifier that
 * resolves outside the project root is a fold failure (can't represent
 * "outside the project" as a project-relative path) — mirrors
 * `foldJoinResolve`'s same rule for `join`/`resolve` arithmetic.
 */
function foldToProjectPath(node: SyntaxNode, source: string, filePath: string): string | null {
  const folded = foldConstantExpr(node, source, filePath);
  if (folded === null) return null;
  if (!folded.startsWith('./') && !folded.startsWith('../')) return folded;

  const dir = posixPath.posix.dirname(filePath.replace(/\\/g, '/'));
  const base = dir === '.' ? '' : dir;
  const joined = base ? `${base}/${folded}` : folded;
  const normalized = posixPath.posix.normalize(joined);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

/** One candidate `invokes` target: a folded path (real or not — the resolver decides) or the fork sentinel. */
export interface InvokesTarget {
  readonly referenceName: string;
}

/**
 * Fold `callNode`'s target argument(s) into zero or more `invokes` reference
 * names, per `canonicalFn`:
 *
 *  - `fork(modulePath, args?, options?)`: fold `modulePath` (argv[0] only —
 *    `fork`'s target is always a JS module, so it is ALWAYS pushed, using the
 *    unresolved sentinel on a folding failure rather than staying silent).
 *  - `spawn`/`spawnSync`/`execFile`/`execFileSync`(cmd, args?, options?):
 *      (i)   `cmd` folds to a path — push it. The resolver's exact-file-path
 *            match is the real filter: a project file resolves, an external
 *            command (`git`) or arbitrary string simply never matches a file
 *            node and silently stays unresolved (case iii from spec, "正しい
 *            挙動" — no special-casing needed here).
 *      (ii)  `cmd` is `process.execPath` (AST shape) or folds to the literal
 *            string `'node'` — argv[0] is the current runtime, so the REAL
 *            target is argv[1]'s array-literal elements. Each element is
 *            folded independently; a `...spread` or an unfoldable element is
 *            skipped WITHOUT abandoning the rest of the array.
 *      (iv)  `cmd` doesn't fold at all — skip entirely (no ref pushed).
 *            Unlike `fork`, spawn's target domain is mostly external
 *            commands, so an unfoldable argv[0] carries no signal that
 *            visibility would improve on.
 */
export function resolveInvokesTargets(
  canonicalFn: string,
  callNode: SyntaxNode,
  source: string,
  filePath: string
): InvokesTarget[] {
  const argsNode = getChildByField(callNode, 'arguments');
  if (!argsNode) return [];
  const args = argsNode.namedChildren.filter((n): n is SyntaxNode => !!n);
  if (args.length < 1) return [];

  if (canonicalFn === 'fork') {
    const folded = foldToProjectPath(args[0]!, source, filePath);
    return [{ referenceName: folded ?? SPAWN_INVOKES_UNRESOLVED_MARKER }];
  }

  const first = args[0]!;
  const foldedFirst = isProcessExecPath(first, source) ? null : foldToProjectPath(first, source, filePath);
  const isNodeSelfInvocation = isProcessExecPath(first, source) || foldedFirst === 'node';

  if (isNodeSelfInvocation) {
    const second = args[1];
    if (!second || second.type !== 'array') return [];
    const targets: InvokesTarget[] = [];
    for (const el of second.namedChildren) {
      if (!el || el.type === 'spread_element') continue; // 個別スキップ、配列全体は諦めない
      const foldedEl = foldToProjectPath(el, source, filePath);
      if (foldedEl !== null) targets.push({ referenceName: foldedEl });
    }
    return targets;
  }

  if (foldedFirst === null) return []; // case (iv): unfoldable argv[0] — skip, no ref
  return [{ referenceName: foldedFirst }]; // case (i)/(iii): let the resolver's exact-match decide
}
