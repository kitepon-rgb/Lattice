import { TodoStoreError } from './todo-store.mjs';

/**
 * 依存グラフの「直列度」を判定する既定閾値。
 *
 * `serialization_ratio = critical_path_length / task_count` がこれを超えると、
 * 依存連鎖が全task数の半分を超えて連なっている＝大半のtaskが並列候補ではなく
 * 一本の鎖に押し込まれていることを意味する。`todo start`側が既に持つ
 * `all_ready_parallel_by_default`方針をplan作成時点まで前倒しする出発点として
 * 0.5を採る。実測（parent-child-repair: task 26, critical path約20,
 * ratio≈0.77）を確実に超える一方、緩やかな分岐を持つ通常のplanまでは拾わない
 * 水準として選んだ。
 */
export const DISPATCH_SHAPE_SERIALIZATION_THRESHOLD = 0.5;

/**
 * 閾値判定の対象にする最小task数。
 * 3〜5 task程度の一直線planを毎回突き返しても再考の余地がなく
 * （並列化する意味のある規模でない）機構がノイズになるだけなので、
 * 6 task未満は常に素通りさせる。
 */
export const DISPATCH_SHAPE_MIN_TASK_COUNT_FOR_GATE = 6;

export const DISPATCH_SHAPE_SERIALIZATION_REVIEWED_FLAG = '--serialization-reviewed';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * task_id集合と（既にこの集合の内側だけへ絞り込まれた）依存辺から、
 * dispatch形状を計算する。
 *
 * 呼び出し側の責務: `edges`は「このtask集合の内側だけ」の task_id 対で渡すこと
 * （cross-plan／既存planへの依存や、joinの`after→before`展開は呼び出し側で
 * 行い、範囲外の参照はここへ渡さない）。範囲外の参照が混入した場合は
 * 呼び出し側の実装誤りとして typed error で止める。
 *
 * 循環検出は専用のロジックを別途書き足すのではなく、最長path計算
 * （Kahn法によるtopological order）が全nodeを消化できないことの自然な帰結
 * として行う。この関数はplan作成／migrateがstoreへ書き込む前（拒否時に
 * 何も書かない設計）に呼ばれるため、store側の`validateMergedGraph`による
 * cycle拒否より前に走る——結果として、循環を含む入力はここで先に
 * `DISPATCH_SHAPE_INVALID`として止まる（従来store書込み時に出ていた
 * `STORE_INCONSISTENT`/`merged_cycle`より手前で検出されるようになるという、
 * 観測可能だが意図した違いがある）。
 */
export function computeTodoDispatchShape({ taskIds, edges }) {
  if (!Array.isArray(taskIds) || taskIds.length === 0
    || !taskIds.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new TodoStoreError('DISPATCH_SHAPE_INVALID', 'dispatch_shape_task_ids_invalid');
  }
  const idSet = new Set(taskIds);
  if (idSet.size !== taskIds.length) {
    throw new TodoStoreError('DISPATCH_SHAPE_INVALID', 'dispatch_shape_task_ids_duplicate');
  }
  if (!Array.isArray(edges) || edges.some((edge) => edge === null || typeof edge !== 'object'
    || typeof edge.from !== 'string' || typeof edge.to !== 'string'
    || !idSet.has(edge.from) || !idSet.has(edge.to))) {
    throw new TodoStoreError('DISPATCH_SHAPE_INVALID', 'dispatch_shape_edge_out_of_scope');
  }
  if (edges.some((edge) => edge.from === edge.to)) {
    throw new TodoStoreError('DISPATCH_SHAPE_INVALID', 'dispatch_shape_self_edge');
  }

  const successors = new Map([...idSet].map((id) => [id, []]));
  const indegree = new Map([...idSet].map((id) => [id, 0]));
  const edgeKeys = new Set();
  for (const { from, to } of edges) {
    const key = `${from}\0${to}`;
    if (edgeKeys.has(key)) continue; // hard_dependenciesとjoin由来で同じ辺が重複しても一度だけ数える
    edgeKeys.add(key);
    successors.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  for (const list of successors.values()) list.sort(compareText);

  // Kahn法によるtopological order。dist[node] = nodeで終わる最長path長（辺数）は、
  // 「nodeを、その全先行taskが処理済みになった時点で処理する」という不変条件から
  // 標準的なlongest-path-in-DAG漸化式（dist[v] = max(dist[v], dist[u]+1)）として導かれる。
  const dist = new Map([...idSet].map((id) => [id, 0]));
  const predecessor = new Map();
  const queue = [...idSet].filter((id) => indegree.get(id) === 0).sort(compareText);
  const order = [];
  while (queue.length > 0) {
    queue.sort(compareText);
    const node = queue.shift();
    order.push(node);
    for (const successor of successors.get(node)) {
      if (dist.get(node) + 1 > dist.get(successor)) {
        dist.set(successor, dist.get(node) + 1);
        predecessor.set(successor, node);
      }
      indegree.set(successor, indegree.get(successor) - 1);
      if (indegree.get(successor) === 0) queue.push(successor);
    }
  }
  if (order.length !== idSet.size) {
    throw new TodoStoreError('DISPATCH_SHAPE_INVALID', 'dispatch_shape_dependency_cycle');
  }

  const taskCount = idSet.size;
  const maxDist = Math.max(...order.map((id) => dist.get(id)));
  const criticalPathLength = maxDist + 1;
  const widthByDist = new Map();
  for (const id of idSet) widthByDist.set(dist.get(id), (widthByDist.get(dist.get(id)) ?? 0) + 1);
  const maxFrontierWidth = Math.max(...widthByDist.values());

  // critical path（人向けヒント）の復元: distが最大のnodeから、決定的に選んだpredecessorを
  // 遡って根まで辿る。表示専用でありdigest対象ではないため、決定性は再現性のためだけに要る。
  const deepest = [...idSet].filter((id) => dist.get(id) === maxDist).sort(compareText)[0];
  const criticalPathTaskIds = [];
  for (let cursor = deepest; cursor !== undefined; cursor = predecessor.get(cursor)) {
    criticalPathTaskIds.push(cursor);
  }
  criticalPathTaskIds.reverse();

  return {
    task_count: taskCount,
    critical_path_length: criticalPathLength,
    max_frontier_width: maxFrontierWidth,
    // canonical digest（todoSelfDigest→digestTodoArtifact）はsafe integer以外の数値を
    // TypeErrorで拒否する（todo-contracts.mjsのcanonicalPart）。dispatch_shapeは
    // plan create/migrateの結果にそのまま埋め込まれ digest対象になるため、比率は
    // 固定小数のstringで持つ（判定側はNumber()で復元する）。
    serialization_ratio: (criticalPathLength / taskCount).toFixed(4),
    critical_path_task_ids: criticalPathTaskIds,
  };
}

/** dispatch_shapeが、再考なしで直列のまま通してよい規模・度合いかを判定する。 */
export function isTodoDispatchShapeSerializationExcessive(shape) {
  return shape.task_count >= DISPATCH_SHAPE_MIN_TASK_COUNT_FOR_GATE
    && Number(shape.serialization_ratio) > DISPATCH_SHAPE_SERIALIZATION_THRESHOLD;
}

/**
 * dispatch_shapeが直列に寄りすぎているplanを、再考なしでは通さない。
 *
 * `todo start`の`PARALLEL_DISPATCH_RECONSIDER`と同じ二段階（一度突き返し、
 * 再考を経たflagが無ければ通さない）をplan作成時点へ前倒しする。ここで
 * 拒否する場合、呼び出し側はまだstoreへ何も書いていないこと（初期化／追加を
 * この呼び出しより後で行うこと）。
 */
export function assertTodoDispatchShapeReviewed({ shape, reviewed }) {
  if (!isTodoDispatchShapeSerializationExcessive(shape) || reviewed) return;
  throw new TodoStoreError('PARALLEL_DISPATCH_RECONSIDER', 'plan_shape_too_serial', undefined, {
    task_count: shape.task_count,
    critical_path_length: shape.critical_path_length,
    max_frontier_width: shape.max_frontier_width,
    serialization_ratio: shape.serialization_ratio,
    critical_path_task_ids: shape.critical_path_task_ids,
    default_policy: 'all_ready_parallel_by_default',
    serialization_reviewed_flag: DISPATCH_SHAPE_SERIALIZATION_REVIEWED_FLAG,
    guidance: `並列を検討しなさい。task ${shape.task_count}件のうちcritical pathが`
      + `${shape.critical_path_length}段（serialization_ratio ${shape.serialization_ratio}）で、`
      + '大半のtaskが並列候補ではなく一本の依存鎖に押し込まれている。'
      + 'critical_path_task_idsに沿った依存のうち、実際には干渉しない組を'
      + 'hard_dependencies/joinsから外せないか見直す'
      + '（実行主体が足りないなら増やす。増やせないことは直列化の理由にならない）。'
      + `検討した上でなお直列でよいなら ${DISPATCH_SHAPE_SERIALIZATION_REVIEWED_FLAG} を付けて再実行する。`,
  });
}

/**
 * plan/extractionの`tasks`・`hard_dependencies`・`joins`（nodeRef形式）から、
 * 「このproject_id/plan_keyの内側だけ」に絞ったdispatch形状を計算する高レベル入口。
 *
 * cross-plan参照やdanglingな参照はここで検証しない（既存のstore書込み経路が
 * 別途検証する）。単に形状計算の対象から外すだけであり、それらの妥当性判断は
 * 呼び出し側の後続処理（実際のstore書込み）に委ねる。
 */
export function computeTodoDispatchShapeForPlan({
  projectId, planKey, taskIds, hardDependencies, joins,
}) {
  const idSet = new Set(taskIds);
  const isLocal = (ref) => ref?.project_id === projectId && ref?.plan_key === planKey
    && idSet.has(ref?.task_id);
  const edges = [];
  for (const edge of hardDependencies ?? []) {
    if (isLocal(edge.from) && isLocal(edge.to)) edges.push({ from: edge.from.task_id, to: edge.to.task_id });
  }
  for (const join of joins ?? []) {
    if (!isLocal(join.before)) continue;
    for (const after of join.after) {
      if (isLocal(after)) edges.push({ from: after.task_id, to: join.before.task_id });
    }
  }
  return computeTodoDispatchShape({ taskIds, edges });
}
