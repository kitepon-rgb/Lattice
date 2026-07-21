import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';

export const PROJECT_IDENTITY_REF = '.lattice/project.json';
const MAX_BYTES = 65_536;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function fail(reason) {
  const error = new Error(reason);
  error.code = 'PROJECT_IDENTITY_INVALID';
  error.detail = { reason };
  throw error;
}

function displayName(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    && !CONTROL.test(value) && Buffer.byteLength(value, 'utf8') <= 256;
}

function duplicateKey(node) {
  if (node?.type === 'object') {
    const keys = new Set();
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? [];
      if (keys.has(key?.value) || duplicateKey(value)) return true;
      keys.add(key?.value);
    }
  } else if (node?.type === 'array') return (node.children ?? []).some(duplicateKey);
  return false;
}

export async function resolveProjectIdentity({ repoRoot, projectId, env = process.env }) {
  if (!path.isAbsolute(repoRoot) || typeof projectId !== 'string' || projectId.length === 0
    || env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('project identity options invalid');
  }
  const override = env.LATTICE_PROJECT_DISPLAY_NAME;
  if (override !== undefined) {
    if (!displayName(override)) fail('environment_display_name_invalid');
    return Object.freeze({ projectId, displayName: override, source: 'environment' });
  }
  const canonicalRoot = await realpath(repoRoot);
  const ref = path.join(canonicalRoot, PROJECT_IDENTITY_REF);
  let stats;
  try { stats = await lstat(ref); } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({ projectId, displayName: projectId, source: 'project_id' });
    }
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_BYTES) fail('identity_file_unsafe');
  const resolved = await realpath(ref);
  if (resolved !== ref) fail('identity_file_alias');
  const bytes = await readFile(ref);
  if (bytes.length > MAX_BYTES) fail('identity_file_too_large');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('identity_utf8_invalid'); }
  const errors = [];
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
  if (errors.length > 0 || tree === undefined || duplicateKey(tree)) fail('identity_json_invalid');
  let document;
  try { document = JSON.parse(text); } catch { fail('identity_json_invalid'); }
  if (document === null || typeof document !== 'object' || Array.isArray(document)
    || Object.keys(document).sort().join(',') !== 'display_name,project_id,schema'
    || document.schema !== 'lattice.project_identity.v1'
    || document.project_id !== projectId || !displayName(document.display_name)) {
    fail('identity_schema_invalid');
  }
  return Object.freeze({ projectId, displayName: document.display_name, source: 'project_file' });
}
