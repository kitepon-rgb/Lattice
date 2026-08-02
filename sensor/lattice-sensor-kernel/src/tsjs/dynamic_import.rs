//! Dynamic `import(...)` / CommonJS `require(...)` specifier folding — a
//! faithful Rust port of src/extraction/dynamic-import.ts (ADR 0048).
//!
//! Folding failure is NOT an error: an argument that isn't statically
//! determinable returns None, and the caller records a visible unresolved
//! sentinel rather than fabricating an edge.

use tree_sitter::Node;

/// Sentinel `referenceName` for an unfoldable specifier. Chosen so it can
/// never accidentally name-match a real symbol or import.
pub const DYNAMIC_IMPORT_UNRESOLVED_MARKER: &str = "<dynamic-import:unresolved>";

/// Recursion/cycle guard for identifier -> const-initializer folding.
const MAX_FOLD_DEPTH: u32 = 8;

fn text<'a>(node: Node, src: &'a str) -> &'a str {
    &src[node.byte_range()]
}

/// True when `node` is a dynamic `import(...)` call — the `function` field is
/// the bare `import` keyword node, not an identifier.
pub fn is_dynamic_import_call(node: Node) -> bool {
    node.kind() == "call_expression"
        && node.child_by_field_name("function").map(|f| f.kind()) == Some("import")
}

/// True when `node` is a bare `require(...)` call. A dotted callee
/// (`x.require(...)`) is excluded, matching the Lua precedent.
pub fn is_require_call(node: Node, src: &str) -> bool {
    if node.kind() != "call_expression" {
        return false;
    }
    let Some(f) = node.child_by_field_name("function") else { return false };
    f.kind() == "identifier" && text(f, src) == "require"
}

/// Fold the single argument of a dynamic import()/require() call to a constant
/// specifier. Zero or multiple arguments is outside what can safely be folded.
pub fn fold_dynamic_import_arg(call: Node, src: &str, file_path: &str) -> Option<String> {
    let args_node = call.child_by_field_name("arguments")?;
    let args: Vec<Node> = (0..args_node.named_child_count())
        .filter_map(|i| args_node.named_child(i))
        .collect();
    if args.len() != 1 {
        return None;
    }
    fold_expr(args[0], src, file_path, 0, &[])
}

/// Same folding for one already-selected argument, without the argument-count
/// gate — `fork(mod, args, opts)` legitimately takes more than one.
pub fn fold_constant_expr(node: Node, src: &str, file_path: &str) -> Option<String> {
    fold_expr(node, src, file_path, 0, &[])
}

fn fold_expr(
    node: Node,
    src: &str,
    file_path: &str,
    depth: u32,
    visited: &[String],
) -> Option<String> {
    if depth > MAX_FOLD_DEPTH {
        return None;
    }
    match node.kind() {
        // `string > string_fragment` gives the bare content, sidestepping
        // quote-char stripping and escape edge cases.
        "string" => {
            let fragment = (0..node.named_child_count())
                .filter_map(|i| node.named_child(i))
                .find(|c| c.kind() == "string_fragment");
            Some(fragment.map(|f| text(f, src).to_string()).unwrap_or_default())
        }

        // Fold ONLY when every named child is a plain string_fragment — a
        // `${expr}` substitution (or an escape_sequence) makes the runtime
        // value unknowable from source text alone.
        "template_string" => {
            let mut parts = String::new();
            for i in 0..node.named_child_count() {
                let Some(child) = node.named_child(i) else { continue };
                if child.kind() != "string_fragment" {
                    return None;
                }
                parts.push_str(text(child, src));
            }
            Some(parts)
        }

        "identifier" => {
            let name = text(node, src);
            if name == "__dirname" {
                return Some(project_relative_dirname(file_path));
            }
            if visited.iter().any(|v| v == name) {
                return None; // cycle guard (A = B, B = A)
            }
            let initializer = find_module_level_const_initializer(node, name, src)?;
            let mut next: Vec<String> = visited.to_vec();
            next.push(name.to_string());
            fold_expr(initializer, src, file_path, depth + 1, &next)
        }

        // `import.meta.dirname` — the ONLY member_expression shape this folds.
        // tree-sitter parses `import.meta` as a single `meta_property` node.
        "member_expression" => {
            let object = node.child_by_field_name("object")?;
            let property = node.child_by_field_name("property")?;
            if object.kind() == "meta_property"
                && text(object, src) == "import.meta"
                && text(property, src) == "dirname"
            {
                return Some(project_relative_dirname(file_path));
            }
            None
        }

        // Bare `join(...)`/`resolve(...)` or a member form (`path.join(...)`).
        // The receiver is intentionally unchecked — only the method name matters.
        "call_expression" => {
            let f = node.child_by_field_name("function")?;
            let args_node = node.child_by_field_name("arguments")?;
            let method = match f.kind() {
                "identifier" => Some(text(f, src).to_string()),
                "member_expression" => f
                    .child_by_field_name("property")
                    .map(|p| text(p, src).to_string()),
                _ => None,
            }?;
            if method != "join" && method != "resolve" {
                return None;
            }
            let mut parts: Vec<String> = Vec::new();
            for i in 0..args_node.named_child_count() {
                let Some(arg) = args_node.named_child(i) else { continue };
                parts.push(fold_expr(arg, src, file_path, depth + 1, visited)?);
            }
            fold_join_resolve(&parts)
        }

        // `(CONTROL_LIB)` — unwrap defensively.
        "parenthesized_expression" => {
            let inner = (0..node.named_child_count()).find_map(|i| node.named_child(i))?;
            fold_expr(inner, src, file_path, depth + 1, visited)
        }

        // Other calls, binary expressions (`'./y' + 'z'`), member access on
        // anything else — not statically foldable. Failure, not an error.
        _ => None,
    }
}

/// Module-level `const NAME = <expr>` initializer, honouring an `export`
/// wrapper. Program's direct children only — `let`/`var` are excluded since
/// they can be reassigned and the declaration-site value is not necessarily
/// the call-site value.
fn find_module_level_const_initializer<'t>(
    any_node: Node<'t>,
    name: &str,
    src: &str,
) -> Option<Node<'t>> {
    // The Rust binding has no Node::tree(); walk up to the root instead.
    let mut root = any_node;
    while let Some(parent) = root.parent() {
        root = parent;
    }
    for i in 0..root.named_child_count() {
        let Some(mut decl) = root.named_child(i) else { continue };
        if decl.kind() == "export_statement" {
            if let Some(inner) = decl.child_by_field_name("declaration") {
                decl = inner;
            }
        }
        if decl.kind() != "lexical_declaration" {
            continue;
        }
        if decl.child_by_field_name("kind").map(|k| k.kind()) != Some("const") {
            continue;
        }
        for j in 0..decl.named_child_count() {
            let Some(declarator) = decl.named_child(j) else { continue };
            if declarator.kind() != "variable_declarator" {
                continue;
            }
            let Some(name_node) = declarator.child_by_field_name("name") else { continue };
            if text(name_node, src) == name {
                return declarator.child_by_field_name("value");
            }
        }
    }
    None
}

/// Project-relative dirname (posix, root as `""` not `"."`).
fn project_relative_dirname(file_path: &str) -> String {
    let normalized = file_path.replace('\\', "/");
    match normalized.rfind('/') {
        // posix.dirname("/a") is "/", and "a/" behaves as its own parent —
        // both collapse to the leading segment the same way node's does.
        Some(0) => "/".to_string(),
        Some(i) => normalized[..i].to_string(),
        None => String::new(), // dirname → "." → ""
    }
}

/// Fold `join`/`resolve` arguments into one project-relative path. Both are
/// treated identically: there is no filesystem CWD at extraction time, so
/// `resolve`'s absolute semantics and `join`'s relative semantics collapse to
/// the same segment arithmetic. A result escaping the project root is a
/// folding failure — guessing would risk a wrong edge.
fn fold_join_resolve(parts: &[String]) -> Option<String> {
    let mut result = parts.first().cloned().unwrap_or_default();
    for part in parts.iter().skip(1) {
        // A real filesystem-absolute segment can't be mapped into
        // project-relative space.
        if part.starts_with('/') {
            return None;
        }
        result = if result.is_empty() { part.clone() } else { format!("{result}/{part}") };
    }
    let normalized = posix_normalize(&result);
    if normalized == ".." || normalized.starts_with("../") {
        return None;
    }
    Some(if normalized == "." { String::new() } else { normalized })
}

/// `path.posix.normalize` for the subset this folding produces: resolves `.`
/// and `..`, collapses repeated separators, preserves a leading `/` and a
/// leading `..` run, and returns `.` for an empty relative result.
pub(super) fn posix_normalize_for_spawn(input: &str) -> String {
    posix_normalize(input)
}

fn posix_normalize(input: &str) -> String {
    let absolute = input.starts_with('/');
    let trailing_slash = input.len() > 1 && input.ends_with('/');
    let mut out: Vec<&str> = Vec::new();
    for segment in input.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                match out.last() {
                    Some(&last) if last != ".." => {
                        out.pop();
                    }
                    _ => {
                        // Leading `..` survives only in relative paths; above
                        // the root of an absolute path it is dropped.
                        if !absolute {
                            out.push("..");
                        }
                    }
                }
            }
            other => out.push(other),
        }
    }
    let mut joined = out.join("/");
    if joined.is_empty() {
        return if absolute { "/".to_string() } else { ".".to_string() };
    }
    if trailing_slash {
        joined.push('/');
    }
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}
