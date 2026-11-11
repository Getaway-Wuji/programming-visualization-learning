export function isTeachingEditorial(value: unknown, id: string): value is { id: string; version: string };
export function compareTeachingVersions(left: string, right: string): number;
