/**
 * Dynamic import() / require() detection and constant-folding for JS/TS.
 *
 * The JS/TS extractors only recognized STATIC `import ... from '...'`
 * (importTypes: ['import_statement']) — dynamic `import(<expr>)` and
 * CommonJS `require(<expr>)` were invisible, producing false-negative
 * `imports` edges (ADR 0048, Lattice sensor correctness fix b). The oracle
 * shape this exists to solve:
 *
 *   import { dirname, join, resolve } from "node:path";
 *   export const ROOT = resolve(import.meta.dirname, "..", "..");
 *   export const CONTROL_LIB = join(ROOT, "lib", "orchestrate", "control-record.mjs");
 *   export const loadControl = () => import(CONTROL_LIB);
 *
 * which requires 3 folding steps: `import.meta.dirname` -> a project-relative
 * dirname, `resolve`/`join` -> path arithmetic, and identifier -> a same-file
 * module-level `const` binding (recursively, since CONTROL_LIB itself refers
 * to ROOT).
 *
 * This module is PURE detection/folding logic — no side effects, no
 * ExtractionContext dependency — so it's usable from (and unit-testable
 * independent of) the core extractor's `extractCall` dispatch, which is the
 * single choke point both AST walkers (the declaration-level `visitNode`
 * ladder AND the function-body-only `visitForCallsAndStructure`) funnel
 * every `call_expression` through. See the call site in tree-sitter.ts for
 * why: a `visitNode`-only hook (the Lua/Ruby `require()` precedent) never
 * fires for a call nested inside a function body — which is exactly where
 * `() => import(CONTROL_LIB)` lives.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import * as posixPath from 'path';
import { getChildByField, getNodeText } from './tree-sitter-helpers';

/**
 * Sentinel `referenceName` for a dynamic import/require whose argument could
 * NOT be statically folded (a variable, a non-`join`/`resolve` function call,
 * a template literal with substitutions, etc.). Deliberately illegal as both
 * a JS identifier and a file basename (angle brackets, colon) so it can NEVER
 * coincidentally equal a real symbol/import-local name — `hasAnyPossibleMatch`
 * and `matchesAnyImport` in the resolver are both name-equality checks, so an
 * unmatchable sentinel guarantees this never resolves via name-matching into
 * an accidental wrong edge. It is pushed as a normal unresolved reference so
 * it goes through the standard resolve-attempt -> mark `status='failed'`
 * lifecycle (ADR 0048's "no silent fallback" requirement) — a `codegraph
 * status`/`unresolved_refs` query surfaces it exactly like any other
 * unresolvable ref, grouped under this one name.
 */
export const DYNAMIC_IMPORT_UNRESOLVED_MARKER = '<dynamic-import:unresolved>';

/** Recursion/cycle guard for identifier -> const-initializer folding. */
const MAX_FOLD_DEPTH = 8;

/** True when `node` is a dynamic `import(...)` call (`function` field is the bare `import` keyword node, not an identifier). */
export function isDynamicImportCall(node: SyntaxNode): boolean {
  if (node.type !== 'call_expression') return false;
  const fn = getChildByField(node, 'function');
  return fn?.type === 'import';
}

/**
 * True when `node` is a bare `require(...)` call. The callee must be a plain
 * `identifier` reading "require" — `x.require(...)` / `foo.require(...)`
 * (a `member_expression` callee) is excluded, matching the Lua precedent's
 * dotted-callee exclusion.
 */
export function isRequireCall(node: SyntaxNode, source: string): boolean {
  if (node.type !== 'call_expression') return false;
  const fn = getChildByField(node, 'function');
  if (!fn || fn.type !== 'identifier') return false;
  return getNodeText(fn, source) === 'require';
}

/**
 * Attempt to fold the single argument of a dynamic import()/require() call
 * to a constant specifier string. Returns null (folding failure, NOT an
 * error) when the argument isn't statically determinable — a bare variable,
 * a function call other than `join`/`resolve`, a template literal with
 * substitutions, multiple/zero arguments, etc.
 *
 * The returned string is used AS-IS as the `imports` unresolved reference's
 * `referenceName` — a relative literal (`./x.mjs`) resolves through the same
 * relative-specifier path static `import` statements use (Strategy 2,
 * resolveViaImport); a project-relative path produced by `join`/`resolve`
 * arithmetic (`lib/orchestrate/control-record.mjs`) instead lands via
 * Strategy 3's `matchByFilePath` exact `filePath` match. Both are legitimate,
 * pre-existing resolution paths — this function doesn't need to know which
 * one a given result will take.
 */
export function foldDynamicImportArg(
  callNode: SyntaxNode,
  source: string,
  filePath: string
): string | null {
  const argsNode = getChildByField(callNode, 'arguments');
  if (!argsNode) return null;
  const args = argsNode.namedChildren.filter((n): n is SyntaxNode => !!n);
  // A dynamic import/require legitimately takes exactly one argument. Zero
  // or multiple (e.g. a webpack magic-comment second arg, which parses as a
  // comment, not a real 2nd arg, so this is effectively "not exactly one
  // real argument") is outside what we can safely fold — bail rather than
  // guess which argument matters.
  if (args.length !== 1) return null;
  return foldExpr(args[0]!, source, filePath, 0, new Set());
}

function foldExpr(
  node: SyntaxNode,
  source: string,
  filePath: string,
  depth: number,
  visitedIdentifiers: ReadonlySet<string>
): string | null {
  if (depth > MAX_FOLD_DEPTH) return null;

  switch (node.type) {
    case 'string': {
      // `string > string_fragment` gives the bare content, sidestepping
      // quote-char stripping/escaping edge cases (mirrors lua.ts's
      // requireModule, which reads string_content the same way).
      const fragment = node.namedChildren.find((c) => c?.type === 'string_fragment');
      return fragment ? getNodeText(fragment, source) : '';
    }

    case 'template_string': {
      // Fold ONLY when every named child is a plain string_fragment — a
      // `template_substitution` (`${expr}`) OR any other child (e.g. an
      // `escape_sequence`) makes the literal's runtime value unknowable
      // from source text alone, so bail rather than approximate.
      const parts: string[] = [];
      for (const child of node.namedChildren) {
        if (!child) continue;
        if (child.type !== 'string_fragment') return null;
        parts.push(getNodeText(child, source));
      }
      return parts.join('');
    }

    case 'identifier': {
      const name = getNodeText(node, source);
      if (name === '__dirname') return projectRelativeDirname(filePath);
      if (visitedIdentifiers.has(name)) return null; // cycle guard (A = B, B = A)
      const initializer = findModuleLevelConstInitializer(node, name, source);
      if (!initializer) return null;
      return foldExpr(initializer, source, filePath, depth + 1, new Set([...visitedIdentifiers, name]));
    }

    case 'member_expression': {
      // `import.meta.dirname` — the ONLY member_expression shape this folds.
      // tree-sitter-javascript parses `import.meta` as a single `meta_property`
      // node (not a nested member_expression), so this is a one-level check.
      const object = getChildByField(node, 'object');
      const property = getChildByField(node, 'property');
      if (
        object?.type === 'meta_property' &&
        getNodeText(object, source) === 'import.meta' &&
        property &&
        getNodeText(property, source) === 'dirname'
      ) {
        return projectRelativeDirname(filePath);
      }
      return null;
    }

    case 'call_expression': {
      // Bare `join(...)`/`resolve(...)` OR a member form (`path.join(...)`,
      // `nodePath.resolve(...)`) — the receiver identifier is intentionally
      // unchecked (spec: "裸 or path.join / path.resolve member 形"), only
      // the invoked method name matters.
      const fn = getChildByField(node, 'function');
      const argsNode = getChildByField(node, 'arguments');
      if (!fn || !argsNode) return null;
      let methodName: string | null = null;
      if (fn.type === 'identifier') {
        methodName = getNodeText(fn, source);
      } else if (fn.type === 'member_expression') {
        const property = getChildByField(fn, 'property');
        methodName = property ? getNodeText(property, source) : null;
      }
      if (methodName !== 'join' && methodName !== 'resolve') return null;

      const parts: string[] = [];
      for (const arg of argsNode.namedChildren) {
        if (!arg) continue;
        const folded = foldExpr(arg, source, filePath, depth + 1, visitedIdentifiers);
        if (folded === null) return null;
        parts.push(folded);
      }
      return foldJoinResolve(parts);
    }

    case 'parenthesized_expression': {
      // `(CONTROL_LIB)` — unwrap defensively; harmless if the grammar never
      // actually nests one here for our shapes.
      const inner = node.namedChildren.find((c) => !!c);
      return inner ? foldExpr(inner, source, filePath, depth + 1, visitedIdentifiers) : null;
    }

    default:
      // Function calls other than join/resolve, binary expressions
      // (`'./y' + 'z'`), member access on anything else, etc. — not
      // statically foldable. Folding failure, not an error.
      return null;
  }
}

/**
 * Find a module-level (top-of-file) `const NAME = <expr>` declarator's
 * initializer, honouring an `export` wrapper. Deliberately scoped to
 * Program's direct children only (not nested inside functions/blocks) —
 * matches the spec's "module-level const" requirement. `let`/`var` are
 * excluded (spec: "再代入されうる let/var は畳まない") since they can be
 * reassigned and the declaration-site value is not necessarily the
 * call-site value.
 */
function findModuleLevelConstInitializer(
  anyNodeInTree: SyntaxNode,
  name: string,
  source: string
): SyntaxNode | null {
  const root = anyNodeInTree.tree.rootNode;
  for (let i = 0; i < root.namedChildCount; i++) {
    let decl = root.namedChild(i);
    if (!decl) continue;
    if (decl.type === 'export_statement') {
      const inner = getChildByField(decl, 'declaration');
      if (inner) decl = inner;
    }
    if (decl.type !== 'lexical_declaration') continue;
    const kindNode = getChildByField(decl, 'kind');
    if (kindNode?.type !== 'const') continue;

    for (let j = 0; j < decl.namedChildCount; j++) {
      const declarator = decl.namedChild(j);
      if (declarator?.type !== 'variable_declarator') continue;
      const nameNode = getChildByField(declarator, 'name');
      if (nameNode && getNodeText(nameNode, source) === name) {
        return getChildByField(declarator, 'value');
      }
    }
  }
  return null;
}

/** Project-relative dirname of `filePath` (posix, root as `''` not `'.'`). */
function projectRelativeDirname(filePath: string): string {
  const dir = posixPath.posix.dirname(filePath.replace(/\\/g, '/'));
  return dir === '.' ? '' : dir;
}

/**
 * Fold `join`/`resolve` arguments into one project-relative path. Both are
 * treated identically — we operate purely in project-relative "pseudo-
 * absolute" path space (there's no real filesystem CWD at extraction time),
 * so `resolve`'s "absolute result" semantics and `join`'s "relative to first
 * arg" semantics collapse to the same segment-join-and-normalize arithmetic.
 * `..` is resolved (per spec); a result that escapes the project root is a
 * folding failure — we can't represent "outside the project" as a valid
 * project-relative file path, and guessing would risk a wrong edge.
 */
function foldJoinResolve(parts: string[]): string | null {
  let result = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    // A real filesystem-absolute segment (rare in this idiom, and not
    // something we can map into project-relative space) — bail.
    if (part.startsWith('/')) return null;
    result = result ? `${result}/${part}` : part;
  }
  const normalized = posixPath.posix.normalize(result);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized === '.' ? '' : normalized;
}
