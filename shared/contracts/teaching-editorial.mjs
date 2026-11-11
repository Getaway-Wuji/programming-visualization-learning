const versionPattern = /^(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})$/u;

export function isTeachingEditorial(value, id) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'id,version' && value.id === id &&
    typeof value.version === 'string' && versionPattern.test(value.version);
}

export function compareTeachingVersions(left, right) {
  if (!versionPattern.test(left) || !versionPattern.test(right))
    throw new Error('Invalid teaching revision');
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}
