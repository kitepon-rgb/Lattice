// RC3 runtime state projection（ADR 0044 Decision 3.3）。
// runtime stateは保存event prefixからのprojectionとしてのみ再構成し、可変summary、
// executor自己申告、in-memory stateを証拠にしない。本moduleはevent列を唯一の入力に
// した純関数であり、producer（runtime本体）にもverifierにも依存しない。

function invalidProjection(reason) {
  throw new TypeError(`runtime projection契約違反: ${reason}`);
}

function sortedArray(iterable) {
  return [...iterable].sort();
}

/**
 * event prefixからruntime stateを再構成する。
 * @param {{ events: Array<object> }} options
 * @returns {object} 再構成されたstate（全collectionは決定論的順序）
 */
export function projectRuntimeState(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || !Array.isArray(options.events)) {
    invalidProjection('eventsの配列が必要');
  }
  const { events } = options;

  const dispatched = new Set();
  const dispatches = new Map();
  const running = new Set();
  const accepted = new Set();
  const terminal = new Set();
  const receipts = [];
  const checkpoints = [];
  const conflicts = [];
  const holds = [];
  const witnesses = new Map();
  const rebinds = new Map();
  const invalidatedContexts = [];
  let freeze = null;
  const freezeHistory = [];
  let closed = false;

  let previousSequence = -1;
  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      invalidProjection('eventはplain objectでなければならない');
    }
    // 順序judgementはsequenceが正であり、配列順との不一致を黙ってsortで直さない
    // （ADR 0044 Decision 3.4のfail-loud側）。
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) {
      invalidProjection('event列がsequence昇順で保存されていない');
    }
    previousSequence = event.sequence;
    const todoRef = event.subject?.kind === 'todo' ? event.subject.ref : null;
    switch (event.kind) {
      case 'executor_dispatched':
        if (todoRef === null) invalidProjection('executor_dispatchedはtodo subjectが必要');
        dispatched.add(todoRef);
        running.add(todoRef);
        dispatches.set(todoRef, {
          sequence: event.sequence,
          payload: structuredClone(event.payload),
        });
        break;
      case 'checkpoint_observed':
        if (todoRef === null) invalidProjection('checkpoint_observedはtodo subjectが必要');
        checkpoints.push({
          todo_id: todoRef,
          sequence: event.sequence,
          payload: event.payload,
        });
        break;
      case 'receipt_recorded':
        if (todoRef === null) invalidProjection('receipt_recordedはtodo subjectが必要');
        receipts.push({
          receipt_id: typeof event.payload?.receipt_id === 'string'
            ? event.payload.receipt_id
            : `${todoRef}#seq${event.sequence}`,
          todo_id: todoRef,
          sequence: event.sequence,
          plan_epoch: event.plan_epoch,
          payload: structuredClone(event.payload),
          accepted_sequence: null,
          rejected_sequence: null,
        });
        break;
      case 'receipt_accepted': {
        if (todoRef === null) invalidProjection('receipt_acceptedはtodo subjectが必要');
        const pending = receipts.findLast((receipt) => (
          receipt.todo_id === todoRef
          && receipt.accepted_sequence === null
          && receipt.rejected_sequence === null
        ));
        if (pending !== undefined) pending.accepted_sequence = event.sequence;
        accepted.add(todoRef);
        running.delete(todoRef);
        break;
      }
      case 'receipt_rejected': {
        if (todoRef === null) invalidProjection('receipt_rejectedはtodo subjectが必要');
        const pending = receipts.findLast((receipt) => (
          receipt.todo_id === todoRef
          && receipt.accepted_sequence === null
          && receipt.rejected_sequence === null
        ));
        if (pending !== undefined) pending.rejected_sequence = event.sequence;
        break;
      }
      case 'conflict_found':
        conflicts.push({ sequence: event.sequence, ...structuredClone(event.payload) });
        break;
      case 'intake_frozen':
        freeze = {
          sequence: event.sequence,
          frozen_prefix_digest: event.payload?.frozen_prefix_digest ?? null,
        };
        break;
      case 'intake_resumed':
        if (freeze !== null) {
          freezeHistory.push({ ...freeze, resumed_sequence: event.sequence });
          freeze = null;
        }
        break;
      case 'hold_decided':
        holds.push({ sequence: event.sequence, ...structuredClone(event.payload) });
        break;
      case 'carry_over_witnessed':
        if (todoRef === null) invalidProjection('carry_over_witnessedはtodo subjectが必要');
        witnesses.set(todoRef, {
          sequence: event.sequence,
          payload: structuredClone(event.payload),
        });
        break;
      case 'epoch_rebound':
        if (todoRef === null) invalidProjection('epoch_reboundはtodo subjectが必要');
        rebinds.set(todoRef, {
          sequence: event.sequence,
          payload: structuredClone(event.payload),
        });
        break;
      case 'context_invalidated':
        invalidatedContexts.push({ sequence: event.sequence, todo_id: todoRef });
        break;
      case 'executor_terminal':
        if (todoRef !== null) {
          running.delete(todoRef);
          terminal.add(todoRef);
        }
        break;
      case 'run_closed':
        closed = true;
        break;
      case 'run_initialized':
      case 'plan_compiled':
      case 'plan_verified':
      case 'dispatch_decided':
      case 'plan_recompiled':
        break;
      default:
        invalidProjection(`未知のevent kind: ${String(event.kind)}`);
    }
  }

  return {
    dispatched: sortedArray(dispatched),
    dispatches: Object.fromEntries([...dispatches.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    running: sortedArray(running),
    accepted: sortedArray(accepted),
    terminal: sortedArray(terminal),
    receipts,
    checkpoints,
    conflicts,
    holds,
    witnesses: Object.fromEntries([...witnesses.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    rebinds: Object.fromEntries([...rebinds.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    invalidated_contexts: invalidatedContexts,
    freeze,
    freeze_history: freezeHistory,
    closed,
  };
}

/**
 * managed runの一時状態をevent prefixだけから表示用に投影する。
 *
 * TODO本体の状態機械とは独立したoverlayであり、hold/carry-over/redispatchを
 * 相互排他的に保つ。receipt accepted後は運用上の一時状態ではなくなるため
 * overlayから除く。intake_frozenはevent prefix上の論理状態だけを表し、中央
 * write gateまで含むmanaged runtimeの実効freeze判定は所有しない。
 */
export function projectRuntimeStatusOverlays(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || !Array.isArray(options.events)) {
    invalidProjection('eventsの配列が必要');
  }
  const { events } = options;
  // sequence順、未知event、subject等の既存projection契約を先に検証する。
  const runtimeState = projectRuntimeState({ events });
  const overlays = new Map();

  const setOverlay = (todoId, state) => {
    if (typeof todoId !== 'string' || todoId.length === 0) {
      invalidProjection(`${state} overlayのtodo idが不正`);
    }
    overlays.set(todoId, state);
  };

  for (const event of events) {
    const todoRef = event.subject?.kind === 'todo' ? event.subject.ref : null;
    switch (event.kind) {
      case 'hold_decided':
        for (const todoId of event.payload?.hold_set ?? []) setOverlay(todoId, 'held');
        for (const todoId of event.payload?.continue_set ?? []) setOverlay(todoId, 'carry_over');
        break;
      case 'carry_over_witnessed':
      case 'epoch_rebound':
        if (todoRef === null) invalidProjection(`${event.kind}はtodo subjectが必要`);
        setOverlay(todoRef, 'carry_over');
        break;
      case 'context_invalidated':
        if (todoRef === null) invalidProjection('context_invalidatedはtodo subjectが必要');
        if (event.payload?.reauthorized_via === 'epoch_rebind') setOverlay(todoRef, 'carry_over');
        else if (event.payload?.reauthorized_via === 'redispatch') setOverlay(todoRef, 'redispatch');
        break;
      case 'receipt_accepted':
        if (todoRef === null) invalidProjection('receipt_acceptedはtodo subjectが必要');
        overlays.delete(todoRef);
        break;
      default:
        break;
    }
  }

  const members = (state) => sortedArray(
    [...overlays.entries()].filter(([, value]) => value === state).map(([todoId]) => todoId),
  );
  return {
    held: members('held'),
    carry_over: members('carry_over'),
    redispatch: members('redispatch'),
    intake_frozen: runtimeState.freeze !== null,
  };
}
