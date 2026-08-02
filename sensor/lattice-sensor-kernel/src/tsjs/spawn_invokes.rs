//! `child_process` spawn-family `invokes` edge indexing — a faithful Rust port
//! of src/extraction/spawn-invokes.ts (ADR 0048).
//!
//! `invokes` is an ADDITIONAL edge: the generic call-reference logic still
//! emits its normal `calls` ref to the local callee name.

use super::dynamic_import::fold_constant_expr;
use std::collections::{HashMap, HashSet};
use tree_sitter::Node;

/// Sentinel for a `fork(...)` whose module argument could not be folded.
/// Illegal as both a JS identifier and a file path, so it can never
/// coincidentally name-match a real file; pushed as a normal unresolved
/// reference so it surfaces as failed rather than being silently dropped.
pub const SPAWN_INVOKES_UNRESOLVED_MARKER: &str = "<spawn:unresolved>";

const SPAWN_FNS: [&str; 5] = ["spawn", "spawnSync", "execFile", "execFileSync", "fork"];

fn is_spawn_fn(name: &str) -> bool {
    SPAWN_FNS.contains(&name)
}

fn is_child_process_specifier(text: &str) -> bool {
    text == "child_process" || text == "node:child_process"
}

fn text<'a>(node: Node, src: &'a str) -> &'a str {
    &src[node.byte_range()]
}

/// Per-file table of local names verified bound to the spawn family.
#[derive(Default)]
pub struct ChildProcessBindings {
    /// local identifier -> canonical child_process function name
    local_fns: HashMap<String, String>,
    /// locals bound as a namespace (`import * as cp from 'child_process'`)
    namespaces: HashSet<String>,
}

impl ChildProcessBindings {
    pub fn is_empty(&self) -> bool {
        self.local_fns.is_empty() && self.namespaces.is_empty()
    }
}

/// Scan Program direct children for spawn-family bindings. Two shapes: static
/// `import` (named with alias, or namespace), and a module-level CommonJS
/// destructure (`const { spawnSync } = require('node:child_process')`).
/// `let`/`var` are excluded — a reassignable binding's declaration-site value
/// isn't necessarily the call-site value. A default import isn't a meaningful
/// binding shape for this module and is intentionally not recognized.
pub fn collect_child_process_bindings(any_node: Node, src: &str) -> ChildProcessBindings {
    let mut root = any_node;
    while let Some(parent) = root.parent() {
        root = parent;
    }
    let mut bindings = ChildProcessBindings::default();

    for i in 0..root.named_child_count() {
        let Some(stmt) = root.named_child(i) else { continue };

        if stmt.kind() == "import_statement" {
            let specifier = stmt
                .child_by_field_name("source")
                .map(|s| text(s, src).replace(['\'', '"'], ""))
                .unwrap_or_default();
            if !is_child_process_specifier(&specifier) {
                continue;
            }
            let Some(clause) = (0..stmt.named_child_count())
                .filter_map(|j| stmt.named_child(j))
                .find(|c| c.kind() == "import_clause")
            else {
                continue;
            };
            for j in 0..clause.named_child_count() {
                let Some(child) = clause.named_child(j) else { continue };
                match child.kind() {
                    "named_imports" => {
                        for k in 0..child.named_child_count() {
                            let Some(spec) = child.named_child(k) else { continue };
                            if spec.kind() != "import_specifier" {
                                continue;
                            }
                            let imported = spec
                                .child_by_field_name("name")
                                .map(|n| text(n, src).to_string())
                                .unwrap_or_default();
                            if !is_spawn_fn(&imported) {
                                continue;
                            }
                            let local = spec
                                .child_by_field_name("alias")
                                .map(|a| text(a, src).to_string())
                                .unwrap_or_else(|| imported.clone());
                            if !local.is_empty() {
                                bindings.local_fns.insert(local, imported);
                            }
                        }
                    }
                    "namespace_import" => {
                        let id = (0..child.named_child_count())
                            .filter_map(|k| child.named_child(k))
                            .find(|c| c.kind() == "identifier")
                            .or_else(|| child.named_child(0));
                        if let Some(id) = id {
                            let local = text(id, src).to_string();
                            if !local.is_empty() {
                                bindings.namespaces.insert(local);
                            }
                        }
                    }
                    _ => {}
                }
            }
            continue;
        }

        if stmt.kind() == "lexical_declaration" {
            if stmt.child_by_field_name("kind").map(|k| k.kind()) != Some("const") {
                continue;
            }
            for j in 0..stmt.named_child_count() {
                let Some(declarator) = stmt.named_child(j) else { continue };
                if declarator.kind() != "variable_declarator" {
                    continue;
                }
                let Some(name_node) = declarator.child_by_field_name("name") else { continue };
                let Some(value) = declarator.child_by_field_name("value") else { continue };
                if name_node.kind() != "object_pattern" || value.kind() != "call_expression" {
                    continue;
                }
                let Some(f) = value.child_by_field_name("function") else { continue };
                if f.kind() != "identifier" || text(f, src) != "require" {
                    continue;
                }
                let Some(args_node) = value.child_by_field_name("arguments") else { continue };
                let args: Vec<Node> = (0..args_node.named_child_count())
                    .filter_map(|k| args_node.named_child(k))
                    .collect();
                if args.len() != 1 || args[0].kind() != "string" {
                    continue;
                }
                let specifier = (0..args[0].named_child_count())
                    .filter_map(|k| args[0].named_child(k))
                    .find(|c| c.kind() == "string_fragment")
                    .map(|fr| text(fr, src).to_string())
                    .unwrap_or_default();
                if !is_child_process_specifier(&specifier) {
                    continue;
                }

                for k in 0..name_node.named_child_count() {
                    let Some(prop) = name_node.named_child(k) else { continue };
                    let (imported, local) = match prop.kind() {
                        "shorthand_property_identifier_pattern" => {
                            let n = text(prop, src).to_string();
                            (n.clone(), n)
                        }
                        "pair_pattern" => {
                            let imported = prop
                                .child_by_field_name("key")
                                .map(|n| text(n, src).to_string())
                                .unwrap_or_default();
                            let local = prop
                                .child_by_field_name("value")
                                .map(|n| text(n, src).to_string())
                                .unwrap_or_else(|| imported.clone());
                            (imported, local)
                        }
                        _ => continue,
                    };
                    if !imported.is_empty() && !local.is_empty() && is_spawn_fn(&imported) {
                        bindings.local_fns.insert(local, imported);
                    }
                }
            }
        }
    }

    bindings
}

/// True when `node` is `process.execPath` — not something `fold_constant_expr`
/// handles (its only member_expression shape is `import.meta.dirname`), and
/// recognizing it is what routes `spawn(process.execPath, [...])` into the
/// array-element branch instead of failing to fold argv[0].
fn is_process_exec_path(node: Node, src: &str) -> bool {
    if node.kind() != "member_expression" {
        return false;
    }
    let (Some(object), Some(property)) =
        (node.child_by_field_name("object"), node.child_by_field_name("property"))
    else {
        return false;
    };
    object.kind() == "identifier" && text(object, src) == "process" && text(property, src) == "execPath"
}

/// The canonical spawn-family function a call invokes, or None when the callee
/// isn't verified bound to one. `exec`/`execSync` are deliberately excluded —
/// their argument is a whole shell command line, which needs shell grammar
/// parsing rather than the argv-array shape this module folds.
pub fn resolve_child_process_callee(
    node: Node,
    src: &str,
    bindings: &ChildProcessBindings,
) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let f = node.child_by_field_name("function")?;

    if f.kind() == "identifier" {
        return bindings.local_fns.get(text(f, src)).cloned();
    }

    if f.kind() == "member_expression" {
        let object = f.child_by_field_name("object")?;
        let property = f.child_by_field_name("property")?;
        if object.kind() != "identifier" || !bindings.namespaces.contains(text(object, src)) {
            return None;
        }
        let prop = text(property, src);
        return is_spawn_fn(prop).then(|| prop.to_string());
    }

    None
}

/// Fold to a constant, then — ONLY for a `./`/`../` relative specifier —
/// rewrite into the project-relative path space the resolver's exact match
/// expects. A join/resolve-folded result is already in that form and passes
/// through; a bare command name (`git`) also passes through untouched, since
/// the resolver's exact match on a real file node is what turns "didn't fold
/// to a real file" into "no edge". Escaping the project root is a failure.
fn fold_to_project_path(node: Node, src: &str, file_path: &str) -> Option<String> {
    let folded = fold_constant_expr(node, src, file_path)?;
    if !folded.starts_with("./") && !folded.starts_with("../") {
        return Some(folded);
    }
    let normalized_path = file_path.replace('\\', "/");
    let base = match normalized_path.rfind('/') {
        Some(i) => &normalized_path[..i],
        None => "",
    };
    let joined = if base.is_empty() { folded } else { format!("{base}/{folded}") };
    let normalized = super::dynamic_import::posix_normalize_for_spawn(&joined);
    if normalized == ".." || normalized.starts_with("../") {
        return None;
    }
    Some(normalized)
}

/// Fold a call's target argument(s) into zero or more `invokes` reference
/// names.
///
/// `fork(modulePath, …)` folds argv[0] and is ALWAYS pushed — its target is
/// always a JS module, so an unfoldable argument stays visible via the
/// sentinel. For `spawn`/`execFile*`: argv[0] that folds is pushed; argv[0]
/// that is `process.execPath` or the literal `"node"` means the real targets
/// are argv[1]'s array elements, each folded independently (a spread or an
/// unfoldable element is skipped without abandoning the rest); an argv[0] that
/// doesn't fold at all is skipped entirely, since spawn's target domain is
/// mostly external commands and "couldn't fold" carries no signal there.
pub fn resolve_invokes_targets(
    canonical_fn: &str,
    call: Node,
    src: &str,
    file_path: &str,
) -> Vec<String> {
    let Some(args_node) = call.child_by_field_name("arguments") else { return Vec::new() };
    let args: Vec<Node> = (0..args_node.named_child_count())
        .filter_map(|i| args_node.named_child(i))
        .collect();
    if args.is_empty() {
        return Vec::new();
    }

    if canonical_fn == "fork" {
        let folded = fold_to_project_path(args[0], src, file_path)
            .unwrap_or_else(|| SPAWN_INVOKES_UNRESOLVED_MARKER.to_string());
        return vec![folded];
    }

    let first = args[0];
    let exec_path = is_process_exec_path(first, src);
    let folded_first =
        if exec_path { None } else { fold_to_project_path(first, src, file_path) };
    let node_self_invocation = exec_path || folded_first.as_deref() == Some("node");

    if node_self_invocation {
        let Some(second) = args.get(1) else { return Vec::new() };
        if second.kind() != "array" {
            return Vec::new();
        }
        let mut targets = Vec::new();
        for i in 0..second.named_child_count() {
            let Some(el) = second.named_child(i) else { continue };
            if el.kind() == "spread_element" {
                continue; // skip the element, not the whole array
            }
            if let Some(folded) = fold_to_project_path(el, src, file_path) {
                targets.push(folded);
            }
        }
        return targets;
    }

    match folded_first {
        // Let the resolver's exact match decide whether this names a real file.
        Some(folded) => vec![folded],
        // Unfoldable argv[0] — skip, no ref.
        None => Vec::new(),
    }
}
