export const python3CourseBudgets = Object.freeze({
  manifest: 262144,
  chunk: 1048576,
  total: 20971520,
  source: 32768,
});

export const python3CourseCounts = Object.freeze({
  sourceArticles: 81,
  sourceSubheadings: 1494,
  teachingTexts: 963,
  teachingLeaves: 766,
  captionContexts: 607,
  referenceTexts: 5,
  supplementarySidebarLinks: 1,
  activities: 766,
  understandingActivities: 754,
  examples: 766,
  readingExamples: 754,
  runnableExamples: 12,
  executionQuestions: 12,
  judgeCases: 48,
});

const shaPattern = /^[a-f0-9]{64}$/u;
const decoder = new globalThis.TextDecoder('utf-8', { fatal: true });
const encoder = new globalThis.TextEncoder();
const packageRef = { id: 'content.python.runoob3', version: '1.0.0' };
const catalogRef = { id: 'catalog-set.c-python', version: '1.0.0' };
const sourceMapSha256 = '9586127b76149c308336e410f10f137c680841d27985f1db597bcd5ec123396a';
const quizOrder = 40;
const referenceOrders = new Set([39, 61]);

function requireContent(condition, field) {
  if (!condition) throw new Error('Invalid Python CONTENT4: ' + field);
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

export async function parsePython3CourseManifest(bytes, release) {
  requireContent(
    exact(release.packageRef, packageRef) && release.manifestFile === 'manifest-1.0.0.json',
    'release',
  );
  const manifest = await readAsset(
    bytes,
    { bytes: release.manifestBytes, sha256: release.manifestSha256 },
    python3CourseBudgets.manifest,
  );
  requireContent(
    manifest.contractVersion === '4.0.0' &&
      exact(manifest.packageRef, packageRef) &&
      exact(manifest.catalogSetRef, catalogRef) &&
      manifest.language === 'python' &&
      manifest.pythonReference === '3.13' &&
      manifest.learningRevision === 1 &&
      manifest.engine?.id === 'engine.rust.python3' &&
      manifest.engine.version === '0.1.0' &&
      shaPattern.test(manifest.engine.buildSha256) &&
      shaPattern.test(manifest.judgeRegistrySha256) &&
      manifest.sourceMapSha256 === sourceMapSha256 &&
      exact(manifest.counts, python3CourseCounts) &&
      exact(manifest.budgets, python3CourseBudgets),
    'course versions, hashes and budgets',
  );
  const sections = uniqueIndex(manifest.sections, (row) => row.sourceNodeId, 'sections');
  requireContent(sections.size === 2, 'section count');
  const articles = uniqueIndex(manifest.chunks, (row) => row.sourceNodeId, 'article nodes');
  const identities = uniqueIndex(
    manifest.chunks,
    (row) => row.platformRef?.id,
    'article identities',
  );
  requireContent(
    articles.size === python3CourseCounts.sourceArticles && identities.size === articles.size,
    'article count',
  );
  let size = bytes.byteLength;
  const sidePositions = new Set();
  for (const [index, row] of manifest.chunks.entries()) {
    const order = index + 1 + Number(index + 1 >= quizOrder);
    requireContent(
      row.articleSourceOrder === order &&
        row.file === 'article-' + String(order).padStart(2, '0') + '-1.0.0.json' &&
        sections.has(row.parent) &&
        hasText(row.titleDisplay) &&
        row.platformRef.version === packageRef.version &&
        Number.isInteger(row.orderInGroup) &&
        row.orderInGroup > 0 &&
        Number.isInteger(row.bytes) &&
        row.bytes > 0 &&
        row.bytes <= python3CourseBudgets.chunk &&
        shaPattern.test(row.sha256),
      'article entry ' + order,
    );
    const position = row.parent + '/' + row.orderInGroup;
    requireContent(!sidePositions.has(position), 'article sidebar position ' + order);
    sidePositions.add(position);
    size += row.bytes;
  }
  requireContent(size <= python3CourseBudgets.total, 'course byte budget');
  const quiz = manifest.supplementarySidebarLinks;
  requireContent(
    Array.isArray(quiz) &&
      quiz.length === 1 &&
      quiz[0].order === quizOrder &&
      quiz[0].groupOrder === quizOrder &&
      sections.has(quiz[0].sourceParent) &&
      !sidePositions.has(quiz[0].sourceParent + '/' + quizOrder) &&
      quiz[0].articleAcquired === false &&
      quiz[0].disposition === 'site-quiz-reference' &&
      quiz[0].url === 'https://www.runoob.com/quiz/python-quiz.html',
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
      encoder.encode(example.source).byteLength <= python3CourseBudgets.source &&
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

export async function parsePython3CourseChunk(bytes, manifest, articleOrder) {
  const entry = manifest.chunks.find((row) => row.articleSourceOrder === articleOrder);
  requireContent(entry, 'article order ' + articleOrder);
  const chunk = await readAsset(bytes, entry, python3CourseBudgets.chunk);
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
      root.sourceRef.startsWith('https://www.runoob.com/python3/') &&
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
      (articleOrder === 39
        ? chunk.references.length === 81
        : articleOrder === 61 || chunk.references.length === 0) &&
      chunk.references.every(
        ({ url, title, purpose }) =>
          hasText(title) &&
          typeof url === 'string' &&
          url.startsWith('https://') &&
          purpose === (articleOrder === 39 ? 'example-catalog-reference' : 'reference-only'),
      ),
    'reference links ' + articleOrder,
  );
  return chunk;
}
