import {
  canonicalizeTodoArtifact,
  exactRecord,
  isStrictTodoTimestamp,
  isTodoDigest,
  isTodoIdentifier,
  isTodoRef,
  todoSelfDigest,
} from './todo-contracts.mjs';

export const TODO_STRUCTURE_SET_SCHEMA = 'lattice.todo_structure_set.v1';
export const TODO_STRUCTURE_REALIZATION_SCHEMA = 'lattice.todo_structure_realization.v1';
export const TODO_STRUCTURE_BINDING_SCHEMA = 'lattice.todo_structure_binding.v1';
export const TODO_STRUCTURE_PROFILE = 'code-dataflow';
export const TODO_STRUCTURE_CONTRACT_ERROR = 'TODO_STRUCTURE_CONTRACT_INVALID';

export const TODO_STRUCTURE_LIMITS = Object.freeze({
  tasks: 512,
  externalContracts: 256,
  portsPerTask: 256,
  operationsPerTask: 256,
  anchorsPerTask: 256,
  sinksPerOutput: 256,
  identifiersPerList: 256,
  textList: 128,
  textBytes: 4_096,
  constantBytes: 16_384,
  commitsPerRealization: 256,
});

const GIT_SHA = /^[0-9a-f]{40}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const JSON_POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/u;

const isGitSha = (value) => typeof value === 'string' && GIT_SHA.test(value);
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const boundedText = (value, maximumBytes = TODO_STRUCTURE_LIMITS.textBytes) => typeof value === 'string'
  && value.length > 0 && Buffer.byteLength(value, 'utf8') <= maximumBytes && !CONTROL.test(value);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const strictlySorted = (values, key = (value) => value) => values.every((value, index) => index === 0
  || compareText(key(values[index - 1]), key(value)) < 0);
const boundedList = (value, limit, predicate) => Array.isArray(value) && value.length <= limit
  && value.every(predicate);
const pointerPart = (value) => String(value).replaceAll('~', '~0').replaceAll('/', '~1');

function rejection(reason, path = '', detail = undefined) {
  return {
    valid: false,
    code: TODO_STRUCTURE_CONTRACT_ERROR,
    reason,
    path,
    ...(detail === undefined ? {} : { detail }),
  };
}

function sortedIdentifiers(value, { minimum = 0, maximum = TODO_STRUCTURE_LIMITS.identifiersPerList } = {}) {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum
    && value.every(isTodoIdentifier) && strictlySorted(value);
}

function sortedText(value) {
  return boundedList(value, TODO_STRUCTURE_LIMITS.textList, (entry) => boundedText(entry))
    && strictlySorted(value);
}

function dataContract(value, at) {
  if (!exactRecord(value, [
    'shape_id', 'schema_ref', 'identity_fields', 'lifecycle', 'cardinality',
    'compatible_shape_ids',
  ])) return rejection('unexpected_or_missing_keys', at);
  if (!isTodoIdentifier(value.shape_id)) return rejection('invalid_identifier', `${at}/shape_id`);
  if (!['snapshot', 'event', 'stream', 'mutable_state', 'immutable_artifact'].includes(value.lifecycle)) {
    return rejection('invalid_enum', `${at}/lifecycle`);
  }
  if (!['one', 'optional', 'many'].includes(value.cardinality)) {
    return rejection('invalid_enum', `${at}/cardinality`);
  }
  if (!sortedIdentifiers(value.identity_fields)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/identity_fields`);
  }
  if (!sortedIdentifiers(value.compatible_shape_ids)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/compatible_shape_ids`);
  }
  if (value.compatible_shape_ids.includes(value.shape_id)) {
    return rejection('self_compatibility_redundant', `${at}/compatible_shape_ids`);
  }
  if (value.schema_ref !== null) {
    if (!exactRecord(value.schema_ref, ['path', 'symbol', 'json_pointer'])) {
      return rejection('unexpected_or_missing_keys', `${at}/schema_ref`);
    }
    if (!isTodoRef(value.schema_ref.path)) return rejection('invalid_repo_relative_path', `${at}/schema_ref/path`);
    if (!(value.schema_ref.symbol === null || boundedText(value.schema_ref.symbol, 1_024))) {
      return rejection('invalid_symbol', `${at}/schema_ref/symbol`);
    }
    if (!(value.schema_ref.json_pointer === null
      || (typeof value.schema_ref.json_pointer === 'string' && JSON_POINTER.test(value.schema_ref.json_pointer)))) {
      return rejection('invalid_json_pointer', `${at}/schema_ref/json_pointer`);
    }
  }
  return { valid: true };
}

function codeAnchor(value, at) {
  if (!exactRecord(value, ['anchor_id', 'effect', 'path', 'symbol', 'expected_at'])) {
    return rejection('unexpected_or_missing_keys', at);
  }
  if (!isTodoIdentifier(value.anchor_id)) return rejection('invalid_identifier', `${at}/anchor_id`);
  if (!['read', 'modify', 'create', 'delete'].includes(value.effect)) {
    return rejection('invalid_enum', `${at}/effect`);
  }
  if (!isTodoRef(value.path)) return rejection('invalid_repo_relative_path', `${at}/path`);
  if (!(value.symbol === null || boundedText(value.symbol, 1_024))) {
    return rejection('invalid_symbol', `${at}/symbol`);
  }
  if (!['baseline', 'current', 'after_task'].includes(value.expected_at)) {
    return rejection('invalid_enum', `${at}/expected_at`);
  }
  return { valid: true };
}

function sourceRef(value, at) {
  if (!isPlain(value) || typeof value.kind !== 'string') return rejection('invalid_source_ref', at);
  if (value.kind === 'code') {
    if (!exactRecord(value, ['kind', 'anchor_id']) || !isTodoIdentifier(value.anchor_id)) {
      return rejection('invalid_source_ref', at);
    }
  } else if (value.kind === 'task_output') {
    if (!exactRecord(value, ['kind', 'task_id', 'port_id'])
      || !isTodoIdentifier(value.task_id) || !isTodoIdentifier(value.port_id)) {
      return rejection('invalid_source_ref', at);
    }
  } else if (value.kind === 'external') {
    if (!exactRecord(value, ['kind', 'contract_id']) || !isTodoIdentifier(value.contract_id)) {
      return rejection('invalid_source_ref', at);
    }
  } else if (value.kind === 'constant') {
    if (!exactRecord(value, ['kind', 'constant_id', 'value']) || !isTodoIdentifier(value.constant_id)) {
      return rejection('invalid_source_ref', at);
    }
    try {
      if (Buffer.byteLength(canonicalizeTodoArtifact(value.value), 'utf8')
        > TODO_STRUCTURE_LIMITS.constantBytes) return rejection('constant_too_large', `${at}/value`);
    } catch {
      return rejection('invalid_json_tree', `${at}/value`);
    }
  } else {
    return rejection('invalid_enum', `${at}/kind`);
  }
  return { valid: true };
}

function inputPort(value, at) {
  if (!exactRecord(value, ['port_id', 'source', 'access', 'contract'])) {
    return rejection('unexpected_or_missing_keys', at);
  }
  if (!isTodoIdentifier(value.port_id)) return rejection('invalid_identifier', `${at}/port_id`);
  if (!['read', 'consume', 'observe'].includes(value.access)) return rejection('invalid_enum', `${at}/access`);
  const source = sourceRef(value.source, `${at}/source`);
  if (!source.valid) return source;
  return dataContract(value.contract, `${at}/contract`);
}

function outputSink(value, at) {
  if (!isPlain(value) || typeof value.kind !== 'string') return rejection('invalid_output_sink', at);
  if (value.kind === 'task') {
    if (!exactRecord(value, ['kind', 'task_id', 'port_id'])
      || !isTodoIdentifier(value.task_id) || !isTodoIdentifier(value.port_id)) {
      return rejection('invalid_output_sink', at);
    }
  } else if (value.kind === 'code') {
    if (!exactRecord(value, ['kind', 'anchor_id']) || !isTodoIdentifier(value.anchor_id)) {
      return rejection('invalid_output_sink', at);
    }
  } else if (value.kind === 'external') {
    if (!exactRecord(value, ['kind', 'contract_id']) || !isTodoIdentifier(value.contract_id)) {
      return rejection('invalid_output_sink', at);
    }
  } else if (value.kind === 'final_product') {
    if (!exactRecord(value, ['kind', 'product_id']) || !isTodoIdentifier(value.product_id)) {
      return rejection('invalid_output_sink', at);
    }
  } else {
    return rejection('invalid_enum', `${at}/kind`);
  }
  return { valid: true };
}

function sinkKey(value) {
  if (value.kind === 'task') return `task\0${value.task_id}\0${value.port_id}`;
  if (value.kind === 'code') return `code\0${value.anchor_id}`;
  if (value.kind === 'external') return `external\0${value.contract_id}`;
  return `final_product\0${value.product_id}`;
}

function outputPort(value, at) {
  if (!exactRecord(value, ['port_id', 'data_id', 'contract', 'sinks'])) {
    return rejection('unexpected_or_missing_keys', at);
  }
  if (!isTodoIdentifier(value.port_id)) return rejection('invalid_identifier', `${at}/port_id`);
  if (!isTodoIdentifier(value.data_id)) return rejection('invalid_identifier', `${at}/data_id`);
  const contract = dataContract(value.contract, `${at}/contract`);
  if (!contract.valid) return contract;
  if (!boundedList(value.sinks, TODO_STRUCTURE_LIMITS.sinksPerOutput, () => true)) {
    return rejection('bounded_collection_violation', `${at}/sinks`);
  }
  for (const [index, sink] of value.sinks.entries()) {
    const result = outputSink(sink, `${at}/sinks/${index}`);
    if (!result.valid) return result;
  }
  if (!strictlySorted(value.sinks, sinkKey)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/sinks`);
  }
  return { valid: true };
}

function operation(value, at) {
  if (!exactRecord(value, ['operation_id', 'input_port_ids', 'output_port_ids', 'summary'])) {
    return rejection('unexpected_or_missing_keys', at);
  }
  if (!isTodoIdentifier(value.operation_id)) return rejection('invalid_identifier', `${at}/operation_id`);
  if (!sortedIdentifiers(value.input_port_ids)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/input_port_ids`);
  }
  if (!sortedIdentifiers(value.output_port_ids, { minimum: 1 })) {
    return rejection('unsorted_or_duplicate_collection', `${at}/output_port_ids`);
  }
  if (!boundedText(value.summary)) return rejection('invalid_text', `${at}/summary`);
  return { valid: true };
}

function transform(value, at) {
  if (!exactRecord(value, [
    'outcome', 'inputs', 'operations', 'outputs', 'code_anchors', 'failures',
    'first_live_e2e', 'non_goals',
  ])) return rejection('unexpected_or_missing_keys', at);
  if (!boundedText(value.outcome)) return rejection('invalid_text', `${at}/outcome`);
  if (!boundedText(value.first_live_e2e)) return rejection('invalid_text', `${at}/first_live_e2e`);
  if (!boundedList(value.inputs, TODO_STRUCTURE_LIMITS.portsPerTask, () => true)) {
    return rejection('bounded_collection_violation', `${at}/inputs`);
  }
  for (const [index, entry] of value.inputs.entries()) {
    const result = inputPort(entry, `${at}/inputs/${index}`);
    if (!result.valid) return result;
  }
  if (!strictlySorted(value.inputs, (entry) => entry.port_id)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/inputs`);
  }
  if (!boundedList(value.operations, TODO_STRUCTURE_LIMITS.operationsPerTask, () => true)) {
    return rejection('bounded_collection_violation', `${at}/operations`);
  }
  for (const [index, entry] of value.operations.entries()) {
    const result = operation(entry, `${at}/operations/${index}`);
    if (!result.valid) return result;
  }
  if (!strictlySorted(value.operations, (entry) => entry.operation_id)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/operations`);
  }
  if (!boundedList(value.outputs, TODO_STRUCTURE_LIMITS.portsPerTask, () => true)) {
    return rejection('bounded_collection_violation', `${at}/outputs`);
  }
  for (const [index, entry] of value.outputs.entries()) {
    const result = outputPort(entry, `${at}/outputs/${index}`);
    if (!result.valid) return result;
  }
  if (!strictlySorted(value.outputs, (entry) => entry.port_id)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/outputs`);
  }
  if (!boundedList(value.code_anchors, TODO_STRUCTURE_LIMITS.anchorsPerTask, () => true)) {
    return rejection('bounded_collection_violation', `${at}/code_anchors`);
  }
  for (const [index, entry] of value.code_anchors.entries()) {
    const result = codeAnchor(entry, `${at}/code_anchors/${index}`);
    if (!result.valid) return result;
  }
  if (!strictlySorted(value.code_anchors, (entry) => entry.anchor_id)) {
    return rejection('unsorted_or_duplicate_collection', `${at}/code_anchors`);
  }
  if (!sortedText(value.failures)) return rejection('unsorted_or_duplicate_collection', `${at}/failures`);
  if (!sortedText(value.non_goals)) return rejection('unsorted_or_duplicate_collection', `${at}/non_goals`);

  const inputIds = new Set(value.inputs.map(({ port_id: id }) => id));
  const outputIds = new Set(value.outputs.map(({ port_id: id }) => id));
  for (const outputId of outputIds) {
    if (inputIds.has(outputId)) return rejection('duplicate_port_id', `${at}/outputs`);
  }
  for (const [index, entry] of value.operations.entries()) {
    for (const inputId of entry.input_port_ids) {
      if (!inputIds.has(inputId)) return rejection('input_port_reference_missing', `${at}/operations/${index}/input_port_ids`);
    }
    for (const outputId of entry.output_port_ids) {
      if (!outputIds.has(outputId)) return rejection('output_port_reference_missing', `${at}/operations/${index}/output_port_ids`);
    }
  }
  return { valid: true };
}

function externalContract(value, at) {
  if (!exactRecord(value, ['contract_id', 'description', 'contract'])) {
    return rejection('unexpected_or_missing_keys', at);
  }
  if (!isTodoIdentifier(value.contract_id)) return rejection('invalid_identifier', `${at}/contract_id`);
  if (!boundedText(value.description)) return rejection('invalid_text', `${at}/description`);
  return dataContract(value.contract, `${at}/contract`);
}

function taskEntry(value, at) {
  if (!isPlain(value) || !isTodoIdentifier(value.task_id)) {
    return rejection('invalid_task_entry', at);
  }
  if (value.applicability === 'graph') {
    if (!exactRecord(value, ['task_id', 'applicability', 'planned'])) {
      return rejection('unexpected_or_missing_keys', at);
    }
    return transform(value.planned, `${at}/planned`);
  }
  if (value.applicability === 'excluded') {
    if (!exactRecord(value, ['task_id', 'applicability', 'excluded_reason'])) {
      return rejection('unexpected_or_missing_keys', at);
    }
    if (!boundedText(value.excluded_reason)) return rejection('invalid_text', `${at}/excluded_reason`);
    return { valid: true };
  }
  return rejection('invalid_enum', `${at}/applicability`);
}

function validateStructureReferences(value) {
  const tasks = new Map(value.tasks.map((entry) => [entry.task_id, entry]));
  const externals = new Set(value.external_contracts.map(({ contract_id: id }) => id));
  const dataIds = new Set();
  for (const [taskIndex, task] of value.tasks.entries()) {
    if (task.applicability !== 'graph') continue;
    const at = `/tasks/${taskIndex}/planned`;
    const anchors = new Set(task.planned.code_anchors.map(({ anchor_id: id }) => id));
    for (const [inputIndex, input] of task.planned.inputs.entries()) {
      const sourceAt = `${at}/inputs/${inputIndex}/source`;
      if (input.source.kind === 'code' && !anchors.has(input.source.anchor_id)) {
        return rejection('code_anchor_reference_missing', sourceAt);
      }
      if (input.source.kind === 'external' && !externals.has(input.source.contract_id)) {
        return rejection('external_contract_reference_missing', sourceAt);
      }
      if (input.source.kind === 'task_output') {
        const producer = tasks.get(input.source.task_id);
        if (producer?.applicability !== 'graph') return rejection('task_output_reference_missing', sourceAt);
        if (!producer.planned.outputs.some(({ port_id: id }) => id === input.source.port_id)) {
          return rejection('task_output_reference_missing', sourceAt);
        }
      }
    }
    for (const [outputIndex, output] of task.planned.outputs.entries()) {
      if (dataIds.has(output.data_id)) return rejection('duplicate_data_id', `${at}/outputs/${outputIndex}/data_id`);
      dataIds.add(output.data_id);
      for (const [sinkIndex, sink] of output.sinks.entries()) {
        const sinkAt = `${at}/outputs/${outputIndex}/sinks/${sinkIndex}`;
        if (sink.kind === 'code' && !anchors.has(sink.anchor_id)) {
          return rejection('code_anchor_reference_missing', sinkAt);
        }
        if (sink.kind === 'external' && !externals.has(sink.contract_id)) {
          return rejection('external_contract_reference_missing', sinkAt);
        }
        if (sink.kind === 'task') {
          const consumer = tasks.get(sink.task_id);
          if (consumer?.applicability !== 'graph'
            || !consumer.planned.inputs.some(({ port_id: id }) => id === sink.port_id)) {
            return rejection('task_input_reference_missing', sinkAt);
          }
        }
      }
    }
  }
  return { valid: true };
}

/**
 * AI-authored structure setを検証する。expectedTaskIdsを渡した時だけactive planとのcoverageを
 * 照合する。storeを読まない純粋contractなので、sg04のdry-runとCLI schema取得の双方で使える。
 */
export function explainTodoStructureSet(value, { expectedTaskIds = null } = {}) {
  try {
    if (!exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'topology_digest', 'profile',
      'baseline_sha', 'external_contracts', 'tasks', 'structure_set_digest',
    ])) return rejection('unexpected_or_missing_keys');
    if (value.schema !== TODO_STRUCTURE_SET_SCHEMA) return rejection('unsupported_schema', '/schema');
    if (!isTodoIdentifier(value.project_id)) return rejection('invalid_identifier', '/project_id');
    if (!isTodoIdentifier(value.plan_key)) return rejection('invalid_identifier', '/plan_key');
    if (!isTodoIdentifier(value.plan_version)) return rejection('invalid_identifier', '/plan_version');
    if (!isTodoDigest(value.topology_digest)) return rejection('invalid_digest', '/topology_digest');
    if (value.profile !== TODO_STRUCTURE_PROFILE) return rejection('invalid_enum', '/profile');
    if (!isGitSha(value.baseline_sha)) return rejection('invalid_git_sha', '/baseline_sha');
    if (!boundedList(value.external_contracts, TODO_STRUCTURE_LIMITS.externalContracts, () => true)) {
      return rejection('bounded_collection_violation', '/external_contracts');
    }
    for (const [index, entry] of value.external_contracts.entries()) {
      const result = externalContract(entry, `/external_contracts/${index}`);
      if (!result.valid) return result;
    }
    if (!strictlySorted(value.external_contracts, (entry) => entry.contract_id)) {
      return rejection('unsorted_or_duplicate_collection', '/external_contracts');
    }
    if (!Array.isArray(value.tasks) || value.tasks.length < 1
      || value.tasks.length > TODO_STRUCTURE_LIMITS.tasks) {
      return rejection('bounded_collection_violation', '/tasks');
    }
    for (const [index, entry] of value.tasks.entries()) {
      const result = taskEntry(entry, `/tasks/${index}`);
      if (!result.valid) return result;
    }
    if (!strictlySorted(value.tasks, (entry) => entry.task_id)) {
      return rejection('unsorted_or_duplicate_collection', '/tasks');
    }
    const references = validateStructureReferences(value);
    if (!references.valid) return references;
    if (expectedTaskIds !== null) {
      if (!Array.isArray(expectedTaskIds) || !expectedTaskIds.every(isTodoIdentifier)) {
        throw new TypeError('expectedTaskIds must be an identifier array');
      }
      const expected = [...new Set(expectedTaskIds)].sort(compareText);
      if (expected.length !== expectedTaskIds.length) throw new TypeError('expectedTaskIds must be unique');
      const actual = value.tasks.map(({ task_id: id }) => id);
      const actualSet = new Set(actual); const expectedSet = new Set(expected);
      const missing = expected.filter((id) => !actualSet.has(id));
      const extra = actual.filter((id) => !expectedSet.has(id));
      if (missing.length > 0) return rejection('coverage_missing', '/tasks', { task_ids: missing });
      if (extra.length > 0) return rejection('coverage_extra', '/tasks', { task_ids: extra });
    }
    if (!isTodoDigest(value.structure_set_digest)) return rejection('invalid_digest', '/structure_set_digest');
    if (value.structure_set_digest !== todoSelfDigest(value, 'structure_set_digest')) {
      return rejection('structure_set_digest_mismatch', '/structure_set_digest');
    }
    return { valid: true };
  } catch (error) {
    if (error instanceof TypeError && String(error.message).startsWith('expectedTaskIds')) throw error;
    return rejection('invalid_json_tree');
  }
}

export const validateTodoStructureSet = (value, options) => explainTodoStructureSet(value, options).valid;
export const digestTodoStructureTransform = (value) => todoSelfDigest(
  { schema: 'lattice.todo_structure_transform.v1', transform: value, digest: '' }, 'digest',
);

export function explainTodoStructureRealization(value, { structureSet = null, previous = null,
  priorDigests = null } = {}) {
  try {
    if (!exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'task_id', 'sequence',
      'previous_digest', 'structure_set_digest', 'planned_digest', 'head_sha', 'commit_oids',
      'realized', 'supersedes', 'actor', 'recorded_at', 'realization_digest',
    ])) return rejection('unexpected_or_missing_keys');
    if (value.schema !== TODO_STRUCTURE_REALIZATION_SCHEMA) return rejection('unsupported_schema', '/schema');
    for (const field of ['project_id', 'plan_key', 'plan_version', 'task_id']) {
      if (!isTodoIdentifier(value[field])) return rejection('invalid_identifier', `/${field}`);
    }
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) return rejection('invalid_sequence', '/sequence');
    if (value.sequence === 1 ? value.previous_digest !== null : !isTodoDigest(value.previous_digest)) {
      return rejection('invalid_previous_digest', '/previous_digest');
    }
    if (!isTodoDigest(value.structure_set_digest)) return rejection('invalid_digest', '/structure_set_digest');
    if (!isTodoDigest(value.planned_digest)) return rejection('invalid_digest', '/planned_digest');
    if (!isGitSha(value.head_sha)) return rejection('invalid_git_sha', '/head_sha');
    if (!Array.isArray(value.commit_oids) || value.commit_oids.length < 1
      || value.commit_oids.length > TODO_STRUCTURE_LIMITS.commitsPerRealization
      || !value.commit_oids.every(isGitSha)) return rejection('bounded_collection_violation', '/commit_oids');
    if (!strictlySorted(value.commit_oids)) return rejection('unsorted_or_duplicate_collection', '/commit_oids');
    const realized = transform(value.realized, '/realized');
    if (!realized.valid) return realized;
    if (!(value.supersedes === null || isTodoDigest(value.supersedes))) {
      return rejection('invalid_digest', '/supersedes');
    }
    if (value.supersedes === value.realization_digest) return rejection('self_supersedes', '/supersedes');
    if (!exactRecord(value.actor, ['host', 'session', 'agent'])
      || ![value.actor.host, value.actor.session, value.actor.agent].every(isTodoIdentifier)) {
      return rejection('invalid_actor', '/actor');
    }
    if (!isStrictTodoTimestamp(value.recorded_at)) return rejection('invalid_timestamp', '/recorded_at');
    if (previous !== null) {
      if (!validateTodoStructureRealization(previous)) throw new TypeError('previous must be a valid realization');
      if (value.sequence !== previous.sequence + 1) return rejection('chain_sequence_mismatch', '/sequence');
      if (value.previous_digest !== previous.realization_digest) {
        return rejection('chain_previous_digest_mismatch', '/previous_digest');
      }
    }
    if (priorDigests !== null) {
      if (!(priorDigests instanceof Set) || ![...priorDigests].every(isTodoDigest)) {
        throw new TypeError('priorDigests must be a Set of digests');
      }
      if (value.supersedes !== null && !priorDigests.has(value.supersedes)) {
        return rejection('supersedes_target_missing', '/supersedes');
      }
    }
    if (structureSet !== null) {
      const setResult = explainTodoStructureSet(structureSet);
      if (!setResult.valid) throw new TypeError('structureSet must be valid');
      for (const field of ['project_id', 'plan_key', 'plan_version']) {
        if (value[field] !== structureSet[field]) return rejection('structure_identity_mismatch', `/${field}`);
      }
      if (value.structure_set_digest !== structureSet.structure_set_digest) {
        return rejection('structure_identity_mismatch', '/structure_set_digest');
      }
      const task = structureSet.tasks.find(({ task_id: id }) => id === value.task_id);
      if (task?.applicability !== 'graph') return rejection('realization_task_not_applicable', '/task_id');
      if (value.planned_digest !== digestTodoStructureTransform(task.planned)) {
        return rejection('planned_digest_mismatch', '/planned_digest');
      }
    }
    if (!isTodoDigest(value.realization_digest)) return rejection('invalid_digest', '/realization_digest');
    if (value.realization_digest !== todoSelfDigest(value, 'realization_digest')) {
      return rejection('realization_digest_mismatch', '/realization_digest');
    }
    return { valid: true };
  } catch (error) {
    if (error instanceof TypeError && ['previous must', 'priorDigests must', 'structureSet must']
      .some((prefix) => String(error.message).startsWith(prefix))) throw error;
    return rejection('invalid_json_tree');
  }
}

export const validateTodoStructureRealization = (value, options) => explainTodoStructureRealization(value, options).valid;

export function explainTodoStructureBinding(value) {
  try {
    if (!exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'topology_digest', 'profile',
      'baseline_sha', 'structure_set_digest', 'compiled_head_sha', 'compile_artifact_digest',
      'activated_at', 'actor', 'binding_digest',
    ])) return rejection('unexpected_or_missing_keys');
    if (value.schema !== TODO_STRUCTURE_BINDING_SCHEMA) return rejection('unsupported_schema', '/schema');
    for (const field of ['project_id', 'plan_key', 'plan_version']) {
      if (!isTodoIdentifier(value[field])) return rejection('invalid_identifier', `/${field}`);
    }
    if (!isTodoDigest(value.topology_digest)) return rejection('invalid_digest', '/topology_digest');
    if (value.profile !== TODO_STRUCTURE_PROFILE) return rejection('invalid_enum', '/profile');
    if (!isGitSha(value.baseline_sha)) return rejection('invalid_git_sha', '/baseline_sha');
    if (!isTodoDigest(value.structure_set_digest)) return rejection('invalid_digest', '/structure_set_digest');
    if (!isGitSha(value.compiled_head_sha)) return rejection('invalid_git_sha', '/compiled_head_sha');
    if (!isTodoDigest(value.compile_artifact_digest)) return rejection('invalid_digest', '/compile_artifact_digest');
    if (!isStrictTodoTimestamp(value.activated_at)) return rejection('invalid_timestamp', '/activated_at');
    if (!exactRecord(value.actor, ['host', 'session', 'agent'])
      || ![value.actor.host, value.actor.session, value.actor.agent].every(isTodoIdentifier)) {
      return rejection('invalid_actor', '/actor');
    }
    if (!isTodoDigest(value.binding_digest)) return rejection('invalid_digest', '/binding_digest');
    if (value.binding_digest !== todoSelfDigest(value, 'binding_digest')) {
      return rejection('binding_digest_mismatch', '/binding_digest');
    }
    return { valid: true };
  } catch {
    return rejection('invalid_json_tree');
  }
}

export const validateTodoStructureBinding = (value) => explainTodoStructureBinding(value).valid;

/** fixture／writerがcontractと同じcanonical orderを作るための公開比較key。 */
export const todoStructureSinkKey = sinkKey;
export const todoStructurePointerPart = pointerPart;
