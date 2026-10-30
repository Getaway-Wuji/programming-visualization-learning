import type { ExerciseCatalog } from '../content/practice';
import type { PreparedSource } from '../engine/execution-client';
import { generateBlockSource } from '../blocks/generator';
import { starterProgram } from '../blocks/starters';
/** Only compose our authored body with the actual prepared input declarations. */
export function bugSource(catalog: ExerciseCatalog, prepared: PreparedSource, body: string) {
  const skeleton = generateBlockSource(
    starterProgram(catalog.subject.id, catalog.program.bindings),
    prepared,
    catalog.program.bindings,
  ).text;
  const offset = skeleton.lastIndexOf('return 0;');
  if (offset < 0) throw new Error('BUG_SOURCE_INVALID');
  return `${skeleton.slice(0, offset)}${body}\n}\n`;
}
