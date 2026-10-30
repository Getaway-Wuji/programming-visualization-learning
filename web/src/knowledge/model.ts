import rawConfiguration from '../../../content/c/knowledge/map-1.0.0.json?raw';
import type { CourseReading } from '../content/reading';
import type { EntityRef, KnowledgeEntity, LessonEntity } from '../content/types';
import type { LearningCatalog } from '../learning/types';
import { isCompatibleLearningHistory } from '../learning/domain';
import { reviewedDurableSnapshot } from '../learning/reviewed-release';
import type { StorageSnapshot } from '../storage/model';

export interface KnowledgeMapConfiguration {
  mapVersion: '1.0.0';
  sources: { packageRef: EntityRef; sha256: string }[];
  nodes: { knowledgeRef: EntityRef; label: string; description: string; x: number; y: number }[];
}
export const knowledgeMapConfiguration: KnowledgeMapConfiguration = JSON.parse(rawConfiguration);
const same = (a: EntityRef, b: EntityRef) => a.id === b.id && a.version === b.version;
const requireRule = (valid: unknown) => {
  if (!valid) throw new Error('KNOWLEDGE_MAP_INVALID');
};
const keys = (value: object, allowed: string[]) =>
  Object.keys(value).sort().join(',') === [...allowed].sort().join(',');
const validRef = (ref: EntityRef) =>
  ref &&
  keys(ref, ['id', 'version']) &&
  /^[a-z][a-z0-9]*(\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(ref.id) &&
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(ref.version);

export interface KnowledgeMapNode {
  knowledge: KnowledgeEntity;
  label: string;
  description: string;
  x: number;
  y: number;
  lessons: readonly LessonEntity[];
}
export interface KnowledgeMap {
  nodes: KnowledgeMapNode[];
  edges: { from: string; to: string }[];
}

/** Relationships come only from the verified active curriculum, never from layout or titles. */
export function createKnowledgeMap(
  reading: CourseReading,
  configuration = knowledgeMapConfiguration,
): KnowledgeMap {
  requireRule(keys(configuration, ['mapVersion', 'sources', 'nodes']));
  requireRule(configuration.mapVersion === '1.0.0');
  requireRule(Array.isArray(configuration.sources) && configuration.sources.length === 2);
  for (const source of configuration.sources)
    requireRule(
      keys(source, ['packageRef', 'sha256']) &&
        validRef(source.packageRef) &&
        /^[a-f0-9]{64}$/.test(source.sha256),
    );
  requireRule(
    configuration.sources.filter(
      (source) =>
        same(source.packageRef, reading.packageRef) && source.sha256 === reading.sourceSha256,
    ).length === 1,
  );
  requireRule(Array.isArray(configuration.nodes) && configuration.nodes.length === 10);
  requireRule(reading.knowledgePoints.length === configuration.nodes.length);
  requireRule(new Set(reading.knowledgePoints.map((node) => node.id)).size === 10);
  requireRule(new Set(configuration.nodes.map((node) => node.knowledgeRef.id)).size === 10);
  const ordered = reading.chapters.flatMap((chapter) =>
    chapter.lessonRefs.map((ref) => {
      const lesson = reading.lessons.find((item) => same(item, ref));
      requireRule(lesson && same(lesson.chapterRef, chapter));
      return lesson!;
    }),
  );
  requireRule(
    ordered.length === reading.lessons.length &&
      new Set(ordered.map((lesson) => lesson.id)).size === ordered.length,
  );
  for (const lesson of ordered)
    for (const ref of lesson.knowledgeRefs)
      requireRule(
        reading.knowledgePoints.some(
          (node) => same(node, ref) && same(node.languageRef, lesson.languageRef),
        ),
      );
  const nodes = configuration.nodes.map((node) => {
    requireRule(keys(node, ['knowledgeRef', 'label', 'description', 'x', 'y']));
    requireRule(validRef(node.knowledgeRef));
    requireRule(
      typeof node.label === 'string' &&
        node.label.trim().length > 0 &&
        node.label.length <= 16 &&
        typeof node.description === 'string' &&
        node.description.trim().length > 0 &&
        node.description.length <= 180 &&
        Number.isFinite(node.x) &&
        Number.isFinite(node.y) &&
        node.x >= 72 &&
        node.x <= 636 &&
        node.y >= 60 &&
        node.y <= 300,
    );
    const knowledge = reading.knowledgePoints.find((item) => same(item, node.knowledgeRef));
    requireRule(knowledge);
    const lessons = ordered.filter((lesson) =>
      lesson.knowledgeRefs.some((ref) => same(ref, node.knowledgeRef)),
    );
    requireRule(lessons.length > 0);
    return { ...node, knowledge: knowledge!, lessons };
  });
  const edges = nodes.flatMap(({ knowledge }) => {
    requireRule(
      new Set(knowledge.prerequisiteRefs.map((ref) => ref.id)).size ===
        knowledge.prerequisiteRefs.length,
    );
    return knowledge.prerequisiteRefs.map((ref) => {
      const prerequisite = nodes.find((node) => same(node.knowledge, ref));
      requireRule(
        prerequisite &&
          prerequisite.knowledge.id !== knowledge.id &&
          same(prerequisite.knowledge.languageRef, knowledge.languageRef),
      );
      return { from: ref.id, to: knowledge.id };
    });
  });
  const visited = new Set<string>();
  const pending = new Set<string>();
  const visit = (id: string) => {
    requireRule(!pending.has(id));
    if (visited.has(id)) return;
    pending.add(id);
    for (const edge of edges.filter((edge) => edge.to === id)) visit(edge.from);
    pending.delete(id);
    visited.add(id);
  };
  nodes.forEach((node) => visit(node.knowledge.id));
  return { nodes, edges };
}

/** Only acknowledged, compatible lesson.completed rows can light a node. No writes. */
export function projectKnowledgeMap(
  map: KnowledgeMap,
  snapshot: StorageSnapshot | null,
  catalog: LearningCatalog,
  uncertain = false,
) {
  const progress = snapshot ? reviewedDurableSnapshot(snapshot, catalog).progress : [];
  const completedIds = new Set(
    catalog.lessons
      .filter((lesson) =>
        progress.some(
          (row) =>
            row.eventType === 'lesson.completed' &&
            row.result === 'completed' &&
            isCompatibleLearningHistory(row, lesson, 'lesson', snapshot?.aliases ?? []),
        ),
      )
      .map((lesson) => lesson.ref.id),
  );
  const nodes = map.nodes.map((node) => {
    const completed = node.lessons.filter((lesson) => completedIds.has(lesson.id));
    return {
      ...node,
      completed,
      state: completed.length
        ? ('lit' as const)
        : !snapshot || uncertain
          ? ('unknown' as const)
          : ('unlearned' as const),
    };
  });
  return {
    nodes,
    edges: map.edges.map((edge) => ({
      ...edge,
      lit: [edge.from, edge.to].every((id) =>
        nodes.some((node) => node.knowledge.id === id && node.state === 'lit'),
      ),
    })),
    completedIds,
    known: !!snapshot && !uncertain,
  };
}
