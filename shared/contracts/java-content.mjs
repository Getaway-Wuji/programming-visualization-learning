import { isTeachingEditorial, compareTeachingVersions } from './teaching-editorial.mjs';

export const javaCourseBudgets = Object.freeze({
  manifest: 262144,
  chunk: 1048576,
  total: 20971520,
  source: 32768,
});

export const javaCourseCounts = Object.freeze({
  sourceArticles: 56,
  sourceSubheadings: 752,
  teachingTexts: 521,
  teachingLeaves: 390,
  captionContexts: 264,
  referenceTexts: 23,
  supplementarySidebarLinks: 1,
  activities: 390,
  understandingActivities: 378,
  examples: 390,
  readingExamples: 378,
  runnableExamples: 12,
  executionQuestions: 12,
  judgeCases: 48,
});

const shaPattern = /^[a-f0-9]{64}$/u;
const decoder = new globalThis.TextDecoder('utf-8', { fatal: true });
const encoder = new globalThis.TextEncoder();
const packageRef = { id: 'content.java.runoob', version: '1.0.0' };
const catalogRef = { id: 'catalog-set.c-python-java', version: '1.0.0' };
const sourceMapSha256 = '15ff84c51d023cd8bf3ce1f4941927a509f7e6ad79ffd440f03df7541cbcb43d';
const quizOrder = 56;
const referenceOrders = new Set([52, 57]);
const editorialId = 'editorial.java.runoob';

function requireContent(condition, field) {
  if (!condition) throw new Error('Invalid Java CONTENT5: ' + field);
}

function exact(value, expected) {
  return (
    value &&
    Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, field]) => value[key] === field)
  );
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function paragraphs(values) {
  return Array.isArray(values) && values.length > 0 && values.every(hasText);
}

function uniqueIndex(values, key, field) {
  requireContent(Array.isArray(values), field);
  const index = new Map();
  for (const row of values) {
    const id = key(row);
    requireContent(hasText(id) && !index.has(id), field);
    index.set(id, row);
  }
  return index;
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readAsset(bytes, pin, limit) {
  requireContent(
    bytes instanceof Uint8Array && bytes.byteLength === pin.bytes && pin.bytes <= limit,
    'asset byte count',
  );
  requireContent(shaPattern.test(pin.sha256) && (await sha256(bytes)) === pin.sha256, 'asset hash');
  return JSON.parse(decoder.decode(bytes));
}

export async function parseJava3CourseManifest(bytes, release) {
  const editorial = release.editorialRef !== undefined;
  requireContent(
    exact(release.packageRef, packageRef) &&
      (editorial
        ? isTeachingEditorial(release.editorialRef, editorialId) &&
          release.manifestFile === 'manifest-1.0.0-editorial-' + release.editorialRef.version + '.json'
        : release.manifestFile === 'manifest-1.0.0.json'),
    'release',
  );
  const manifest = await readAsset(
    bytes,
    { bytes: release.manifestBytes, sha256: release.manifestSha256 },
    javaCourseBudgets.manifest,
  );
  requireContent(
    manifest.contractVersion === '5.0.0' &&
      exact(manifest.packageRef, packageRef) &&
      exact(manifest.catalogSetRef, catalogRef) &&
      manifest.language === 'java' &&
      manifest.javaReference === '21' &&
      manifest.learningRevision === 1 &&
      manifest.engine?.id === 'engine.rust.java' &&
      manifest.engine.version === '0.1.0' &&
      shaPattern.test(manifest.engine.buildSha256) &&
      shaPattern.test(manifest.judgeRegistrySha256) &&
      manifest.sourceMapSha256 === sourceMapSha256 &&
      exact(manifest.counts, javaCourseCounts) &&
      exact(manifest.budgets, javaCourseBudgets),
    'course versions, hashes and budgets',
  );
  requireContent(
    editorial ? exact(manifest.editorialRef, release.editorialRef) : !('editorialRef' in manifest),
    'editorial identity',
  );
  const sections = uniqueIndex(manifest.sections, (row) => row.sourceNodeId, 'sections');
  requireContent(sections.size === 3, 'section count');
  const articles = uniqueIndex(manifest.chunks, (row) => row.sourceNodeId, 'article nodes');
  const identities = uniqueIndex(
    manifest.chunks,
    (row) => row.platformRef?.id,
    'article identities',
  );
  requireContent(
    articles.size === javaCourseCounts.sourceArticles && identities.size === articles.size,
    'article count',
  );
  let size = bytes.byteLength;
  const sidePositions = new Set();
  for (const [index, row] of manifest.chunks.entries()) {
    const order = index + 1 + Number(index + 1 >= quizOrder);
    const revised = row.editorialRef !== undefined;
    requireContent(
      row.articleSourceOrder === order &&
        (!revised || (editorial && isTeachingEditorial(row.editorialRef, editorialId) &&
          compareTeachingVersions(row.editorialRef.version, manifest.editorialRef.version) <= 0)) &&
        row.file ===
          'article-' + String(order).padStart(2, '0') +
            (revised ? '-1.0.0-editorial-' + row.editorialRef.version + '.json' : '-1.0.0.json') &&
        sections.has(row.parent) &&
        hasText(row.titleDisplay) &&
        row.platformRef.version === packageRef.version &&
        Number.isInteger(row.orderInGroup) &&
        row.orderInGroup > 0 &&
        Number.isInteger(row.bytes) &&
        row.bytes > 0 &&
        row.bytes <= javaCourseBudgets.chunk &&
        shaPattern.test(row.sha256),
      'article entry ' + order,
    );
    const position = row.parent + '/' + row.orderInGroup;
    requireContent(!sidePositions.has(position), 'article sidebar position ' + order);
    sidePositions.add(position);
    size += row.bytes;
  }
  if (editorial) {
    requireContent(
      Array.isArray(manifest.teachingSources) && manifest.teachingSources.length > 0 &&
        manifest.teachingSources.every((source) =>
          Object.keys(source).sort().join(',') === 'articleOrders,kind,physicalPageRanges,sha256,title' &&
          source.kind === 'user-supplied-pdf' && hasText(source.title) &&
          shaPattern.test(source.sha256) &&
          Array.isArray(source.physicalPageRanges) && source.physicalPageRanges.length > 0 &&
          source.physicalPageRanges.every((range) => Array.isArray(range) && range.length === 2 &&
            Number.isInteger(range[0]) && Number.isInteger(range[1]) &&
            range[0] > 0 && range[1] >= range[0] && range[1] <= 550) &&
          Array.isArray(source.articleOrders) && source.articleOrders.length > 0 &&
          new Set(source.articleOrders).size === source.articleOrders.length &&
          source.articleOrders.every((order) => manifest.chunks.some((entry) =>
            entry.articleSourceOrder === order && entry.editorialRef))),
      'editorial teaching sources',
    );
    requireContent(manifest.chunks.filter((entry) => entry.editorialRef).every((entry) =>
      manifest.teachingSources.some((source) => source.articleOrders.includes(entry.articleSourceOrder))),
    'editorial source coverage');
    requireContent(Array.isArray(manifest.media), 'editorial media');
    const media = uniqueIndex(manifest.media, (row) => row.file, 'media files');
    for (const asset of media.values()) {
      requireContent(
        /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:svg|png|jpg|jpeg|webp)$/u.test(asset.file) &&
          Object.keys(asset).sort().join(',') === 'bytes,file,sha256' &&
          Number.isInteger(asset.bytes) && asset.bytes > 0 &&
          asset.bytes <= javaCourseBudgets.chunk && shaPattern.test(asset.sha256),
        'media asset',
      );
      size += asset.bytes;
    }
  } else requireContent(!('media' in manifest) && !('teachingSources' in manifest), 'legacy media');
  requireContent(size <= javaCourseBudgets.total, 'course byte budget');
  const quiz = manifest.supplementarySidebarLinks;
  requireContent(
    Array.isArray(quiz) &&
      quiz.length === 1 &&
      quiz[0].order === quizOrder &&
      quiz[0].groupOrder === 21 &&
      sections.has(quiz[0].sourceParent) &&
      !sidePositions.has(quiz[0].sourceParent + '/' + quiz[0].groupOrder) &&
      quiz[0].articleAcquired === false &&
      quiz[0].disposition === 'site-quiz-reference' &&
      quiz[0].url === 'https://www.runoob.com/quiz/java-quiz.html',
    'supplementary quiz',
  );
  return manifest;
}

function validateActivity(node, example, activity) {
  const lesson = node.platformRef.id;
  requireContent(
    example?.lessonId === lesson && activity?.lessonId === lesson,
    'leaf links ' + lesson,
  );
  requireContent(hasText(example.reason), 'example boundary ' + lesson);
  if (!node.questionId) {
    requireContent(
      example.status === 'reading-only' &&
        activity.kind === 'optional-self-check' &&
        !('source' in example) &&
        !('cases' in example) &&
        !('profileRef' in activity) &&
        hasText(example.prompt) &&
        hasText(example.result) &&
        activity.exampleId === example.id &&
        activity.prompt === example.prompt &&
        activity.reveal === example.result,
      'reading example and self-check ' + lesson,
    );
    return;
  }
  requireContent(
    example.status === 'runnable-required' &&
      activity.kind === 'rust-judge' &&
      hasText(example.source) &&
      encoder.encode(example.source).byteLength <= javaCourseBudgets.source &&
      shaPattern.test(example.sourceSha256) &&
      Array.isArray(example.cases) &&
      example.cases.length > 0 &&
      example.cases.every(
        ({ name, input, stdout }) =>
          hasText(name) && typeof input === 'string' && typeof stdout === 'string',
      ) &&
      activity.id === node.questionId &&
      exact(activity.profileRef, { id: activity.id, version: '1.0.0' }) &&
      hasText(activity.title) &&
      hasText(activity.task) &&
      hasText(activity.observation) &&
      paragraphs(activity.hints) &&
      activity.hints.length >= 2 &&
      activity.caseCount === 4,
    'runnable example and judged practice ' + lesson,
  );
}

export async function parseJava3CourseChunk(bytes, manifest, articleOrder) {
  const entry = manifest.chunks.find((row) => row.articleSourceOrder === articleOrder);
  requireContent(entry, 'article order ' + articleOrder);
  const chunk = await readAsset(bytes, entry, javaCourseBudgets.chunk);
  requireContent(
    entry.editorialRef
      ? exact(chunk.editorialRef, entry.editorialRef)
      : !('editorialRef' in chunk),
    'article editorial identity',
  );
  requireContent(
    exact(chunk.packageRef, packageRef) &&
      chunk.articleSourceOrder === articleOrder &&
      chunk.rootNodeId === entry.sourceNodeId,
    'article identity ' + articleOrder,
  );
  const nodes = uniqueIndex(chunk.nodes, (row) => row.sourceNodeId, 'source nodes');
  uniqueIndex(chunk.nodes, (row) => row.platformRef?.id, 'platform nodes');
  const examples = uniqueIndex(chunk.examples, (row) => row.id, 'examples');
  const activities = uniqueIndex(chunk.activities, (row) => row.id, 'activities');
  const [root, ...subheadings] = chunk.nodes;
  requireContent(
    root?.sourceNodeId === chunk.rootNodeId &&
      root.tag === 'h1' &&
      root.order === articleOrder &&
      root.parent === entry.parent &&
      root.titleDisplay === entry.titleDisplay &&
      root.orderInGroup === entry.orderInGroup &&
      exact(root.platformRef, entry.platformRef) &&
      typeof root.sourceRef === 'string' &&
      root.sourceRef.startsWith('https://www.runoob.com/java/') &&
      shaPattern.test(root.sourceSha256),
    'article root ' + articleOrder,
  );
  const seen = new Set([root.sourceNodeId]);
  const teachingParents = new Set();
  for (const [index, node] of subheadings.entries()) {
    requireContent(
      node.order === index + 1 && node.tag !== 'h1' && seen.has(node.parent),
      'source tree ' + node.sourceNodeId,
    );
    seen.add(node.sourceNodeId);
    if (node.status === 'context-only') continue;
    let ancestor = nodes.get(node.parent);
    while (ancestor.status === 'context-only') ancestor = nodes.get(ancestor.parent);
    teachingParents.add(ancestor.sourceNodeId);
  }
  for (const node of chunk.nodes) {
    const id = node.sourceNodeId;
    requireContent(
      node.articleSourceOrder === articleOrder &&
        node.sourceRef === root.sourceRef &&
        node.sourceSha256 === root.sourceSha256 &&
        node.platformRef.version === packageRef.version &&
        hasText(node.titleOriginal) &&
        hasText(node.titleDisplay) &&
        paragraphs(node.titlePath) &&
        hasText(node.reason),
      'source locator ' + id,
    );
    if (node.status === 'context-only') {
      requireContent(
        node.role === 'example-caption' && !('body' in node) && !('activityId' in node),
        'caption ' + id,
      );
      continue;
    }
    requireContent(paragraphs(node.body), 'body ' + id);
    if (referenceOrders.has(articleOrder)) {
      requireContent(
        node.status === 'reference-only' && !('activityId' in node),
        'reference body ' + id,
      );
      continue;
    }
    requireContent(
      node.status === 'authored' && node.leaf === !teachingParents.has(id),
      'teaching role ' + id,
    );
    if (!node.leaf) {
      requireContent(
        node.exampleId === null && node.activityId === null && node.questionId === null,
        'teaching parent ' + id,
      );
      continue;
    }
    requireContent(hasText(node.goal), 'goal ' + id);
    const example = examples.get(node.exampleId);
    validateActivity(node, example, activities.get(node.activityId));
    if (node.questionId) {
      requireContent(
        (await sha256(encoder.encode(example.source))) === example.sourceSha256,
        'example source hash ' + id,
      );
    }
    examples.delete(node.exampleId);
    activities.delete(node.activityId);
  }
  requireContent(examples.size === 0 && activities.size === 0, 'unlinked examples or activities');
  requireContent(
    Array.isArray(chunk.references) &&
      (articleOrder === 52
        ? chunk.references.length === 155
        : articleOrder === 57
          ? chunk.references.length === 51
          : chunk.references.length === 0) &&
      chunk.references.every(
        ({ url, title, purpose }) =>
          hasText(title) &&
          typeof url === 'string' &&
          /^https?:\/\//u.test(url) &&
          (purpose === 'reference-only' ||
            (articleOrder === 52 && purpose === 'example-catalog-reference')),
      ),
    'reference links ' + articleOrder,
  );
  return chunk;
}
