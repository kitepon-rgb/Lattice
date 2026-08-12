import { projectTodoChainV1 } from './todo-chain.mjs';
import { projectTodoCrossPlanDependencies } from './todo-store.mjs';

const ROOT = Symbol('todo-gantt-root');

function refKey(ref) {
  return JSON.stringify([ref.project_id, ref.plan_key, ref.task_id]);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message, detail = null) {
  const error = new Error(message);
  error.code = 'TODO_LAYOUT_INVALID_HIERARCHY';
  error.detail = detail;
  throw error;
}

function taskRef(member, taskId) {
  return {
    project_id: member.plan.project_id,
    plan_key: member.plan.plan_key,
    task_id: taskId,
  };
}

function normalizeHierarchy(readModel) {
  const tasks = new Map();
  const parentByKey = new Map();
  const childrenByParent = new Map([[ROOT, []]]);
  let hasHierarchy = false;

  for (const member of readModel.members) {
    const ids = new Set(member.plan.tasks.map(({ task_id: taskId }) => taskId));
    for (const task of member.plan.tasks) {
      const ref = taskRef(member, task.task_id);
      const key = refKey(ref);
      const parentId = task.parent_task_id ?? null;
      if (parentId !== null && (typeof parentId !== 'string' || !ids.has(parentId))) {
        fail(`parent_task_id must reference a task in the same plan: ${task.task_id}`, {
          ref, parent_task_id: parentId,
        });
      }
      const parentKey = parentId === null ? ROOT : refKey(taskRef(member, parentId));
      tasks.set(key, { ref, task, member });
      parentByKey.set(key, parentKey);
      if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
      childrenByParent.get(parentKey).push(key);
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      hasHierarchy ||= parentId !== null;
    }
  }
  if (!hasHierarchy) return null;

  for (const key of tasks.keys()) {
    const seen = new Set([key]);
    let cursor = parentByKey.get(key);
    while (cursor !== ROOT) {
      if (seen.has(cursor)) {
        fail('parent_task_id hierarchy contains a cycle', {
          task: tasks.get(key).ref,
          parent: tasks.get(cursor)?.ref ?? null,
        });
      }
      seen.add(cursor);
      cursor = parentByKey.get(cursor);
      if (cursor === undefined) fail('parent_task_id hierarchy is disconnected');
    }
  }
  for (const children of childrenByParent.values()) children.sort(compareText);
  return { tasks, parentByKey, childrenByParent };
}

function branchUnder(hierarchy, containerKey, taskKey) {
  let cursor = taskKey;
  while (cursor !== ROOT) {
    const parent = hierarchy.parentByKey.get(cursor);
    if (parent === containerKey) return cursor;
    cursor = parent;
  }
  return null;
}

function projectRef(hierarchy, containerKey, value) {
  if (value === null || typeof value !== 'object') return null;
  const branch = branchUnder(hierarchy, containerKey, refKey(value));
  return branch === null ? null : { ...hierarchy.tasks.get(branch).ref };
}

function uniqueRefs(refs) {
  const byKey = new Map(refs.map((ref) => [refKey(ref), ref]));
  return [...byKey.values()].sort((left, right) => compareText(refKey(left), refKey(right)));
}

function projectMember(member, hierarchy, containerKey, selectedKeys) {
  const tasks = member.plan.tasks.filter((task) => selectedKeys.has(refKey(taskRef(member, task.task_id))));
  if (tasks.length === 0) return null;

  const hardDependencies = [];
  const seenHard = new Set();
  for (const edge of member.plan.hard_dependencies) {
    const from = projectRef(hierarchy, containerKey, edge.from);
    const to = projectRef(hierarchy, containerKey, edge.to);
    if (from === null || to === null || !selectedKeys.has(refKey(from))
      || !selectedKeys.has(refKey(to)) || refKey(from) === refKey(to)) continue;
    const key = JSON.stringify([refKey(from), refKey(to)]);
    if (seenHard.has(key)) continue;
    seenHard.add(key);
    hardDependencies.push({ from, to });
  }

  const joins = [];
  for (const join of member.plan.joins) {
    const before = projectRef(hierarchy, containerKey, join.before);
    if (before === null || !selectedKeys.has(refKey(before))) continue;
    const after = uniqueRefs(join.after.map((ref) => projectRef(hierarchy, containerKey, ref))
      .filter((ref) => ref !== null && selectedKeys.has(refKey(ref))
        && refKey(ref) !== refKey(before)));
    if (after.length > 0) joins.push({ ...join, after, before });
  }

  const phaseAcceptDependencies = [];
  const seenPhaseAccept = new Set();
  for (const dependency of member.plan.phase_accept_dependencies ?? []) {
    const to = projectRef(hierarchy, containerKey, dependency.to);
    if (to === null || !selectedKeys.has(refKey(to))) continue;
    const key = JSON.stringify([dependency.from, refKey(to)]);
    if (seenPhaseAccept.has(key)) continue;
    seenPhaseAccept.add(key);
    phaseAcceptDependencies.push({ ...dependency, to });
  }

  // plan-scopedのcross-plan edgeも階層levelのtaskへ射影する。子task同士の接続を
  // root levelで捨てると、nested表示だけ依存線とwaveが消えるため、hard edgeと同じく
  // 各endpointをそのlevel直下のbranchへ束縛し直す。
  const planScopedEventsIn = member.plan_scoped?.events ?? [];
  const supersededPlanScopedEvents = new Set(planScopedEventsIn
    .filter((event) => event.kind === 'cross_plan_dependency_rebind')
    .map((event) => event.payload.supersedes));
  const planScopedEvents = planScopedEventsIn.flatMap((event) => {
    if (supersededPlanScopedEvents.has(event.event_digest)) return [];
    if (!['cross_plan_dependency', 'cross_plan_dependency_rebind'].includes(event.kind)) return [event];
    const from = projectRef(hierarchy, containerKey, event.payload.from);
    const to = projectRef(hierarchy, containerKey, event.payload.to);
    if (from === null || to === null || !selectedKeys.has(refKey(from))
      || !selectedKeys.has(refKey(to)) || refKey(from) === refKey(to)) return [];
    return [{ ...event, payload: { ...event.payload, from, to } }];
  });

  return {
    ...member,
    plan: {
      ...member.plan,
      tasks,
      hard_dependencies: hardDependencies,
      joins,
      phase_accept_dependencies: phaseAcceptDependencies,
    },
    ...(member.plan_scoped === undefined ? {} : {
      plan_scoped: { ...member.plan_scoped, events: planScopedEvents },
    }),
    tasks: member.tasks.filter(({ task_id: taskId }) => tasks.some((task) => task.task_id === taskId)),
  };
}

function filterIndependence(independence, selectedKeys) {
  if (!Array.isArray(independence)) return independence;
  const selectedByPlan = new Map();
  for (const key of selectedKeys) {
    const [projectId, planKey, taskId] = JSON.parse(key);
    selectedByPlan.set(JSON.stringify([projectId, planKey]),
      new Set([...(selectedByPlan.get(JSON.stringify([projectId, planKey])) ?? []), taskId]));
  }
  return independence.flatMap((projection) => {
    const selected = selectedByPlan.get(JSON.stringify([projection.project_id, projection.plan_key]));
    if (selected === undefined) return [];
    const frontier = projection.frontier;
    return [{
      ...projection,
      frontier: {
        ...frontier,
        parallel_groups: (frontier.parallel_groups ?? []).map((group) => ({
          ...group, task_ids: group.task_ids.filter((taskId) => selected.has(taskId)),
        })).filter((group) => group.task_ids.length > 0),
        serialize_pairs: (frontier.serialize_pairs ?? [])
          .filter((pair) => pair.task_ids.every((taskId) => selected.has(taskId))),
        conflicts_with_active: (frontier.conflicts_with_active ?? []).filter((entry) =>
          selected.has(entry.ready_task_id) && selected.has(entry.active_task_id)),
        unknown: (frontier.unknown ?? []).filter((entry) => selected.has(entry.task_id)),
      },
    }];
  });
}

function topologyOf(readModel) {
  const crossPlanDependencies = projectTodoCrossPlanDependencies(readModel.members);
  return {
    nodes: readModel.members.flatMap((member) => member.plan.tasks
      .map(({ task_id: taskId }) => taskRef(member, taskId))),
    hard_edges: [
      ...readModel.members.flatMap((member) => member.plan.hard_dependencies),
      ...crossPlanDependencies.map(({ from, to }) => ({ from, to })),
    ],
    joins: readModel.members.flatMap((member) => member.plan.joins),
  };
}

function buildLevel(readModel, hierarchy, containerKey, options, layoutFlat, includesSubtree) {
  const selected = (hierarchy.childrenByParent.get(containerKey) ?? []).filter(includesSubtree);
  const selectedKeys = new Set(selected);
  const members = readModel.members.map((member) =>
    projectMember(member, hierarchy, containerKey, selectedKeys)).filter(Boolean);
  const projectedRead = { ...readModel, members };
  const levelOptions = {
    ...options,
    // live foldingは元のfull graphで一度だけ行い、下で選んだtask集合へ反映済み。
    // 縮約levelでもう一度foldすると、可視な子を持つdone親containerが消える。
    scope: 'all',
    independence: filterIndependence(options.independence ?? null, selectedKeys),
    seamProposals: containerKey === ROOT ? options.seamProposals ?? null : null,
  };
  const layout = layoutFlat(projectedRead, projectTodoChainV1(topologyOf(projectedRead)), levelOptions);
  const children = selected.flatMap((parentKey) => {
    if ((hierarchy.childrenByParent.get(parentKey) ?? []).length === 0) return [];
    const childLevel = buildLevel(
      readModel, hierarchy, parentKey, options, layoutFlat, includesSubtree,
    );
    if (childLevel.layout.nodes.length === 0 && childLevel.children.length === 0) return [];
    return [{
      parent_ref: { ...hierarchy.tasks.get(parentKey).ref },
      level: childLevel,
    }];
  });
  return { layout, children };
}

function levelMetrics(level, depth = 1) {
  let taskCount = level.layout.nodes.length;
  let visibleNodeCount = level.layout.metrics.visible_node_count;
  let visibleEdgeCount = level.layout.metrics.visible_edge_count;
  let maximumDepth = depth;
  for (const child of level.children) {
    const nested = levelMetrics(child.level, depth + 1);
    taskCount += nested.taskCount;
    visibleNodeCount += nested.visibleNodeCount;
    visibleEdgeCount += nested.visibleEdgeCount;
    maximumDepth = Math.max(maximumDepth, nested.maximumDepth);
  }
  return { taskCount, visibleNodeCount, visibleEdgeCount, maximumDepth };
}

export function buildTodoGanttHierarchy(readModel, options, layoutFlat, visibleTaskKeys = null) {
  const hierarchy = normalizeHierarchy(readModel);
  if (hierarchy === null) return null;
  const memo = new Map();
  const includesSubtree = (key) => {
    if (visibleTaskKeys === null) return true;
    if (memo.has(key)) return memo.get(key);
    const included = visibleTaskKeys.has(key)
      || (hierarchy.childrenByParent.get(key) ?? []).some(includesSubtree);
    memo.set(key, included);
    return included;
  };
  const root = buildLevel(readModel, hierarchy, ROOT, options, layoutFlat, includesSubtree);
  return { root, metrics: levelMetrics(root) };
}
