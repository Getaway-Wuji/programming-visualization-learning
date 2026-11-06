import type {
  JavaCase,
  JavaNode,
  JavaPacket,
  JavaRequest,
  JavaResponse,
  JavaState,
  JavaStep,
} from '../../web/src/engine/java-types';

interface Position {
  cursor: number;
  state: JavaState;
  step: JavaStep | null;
}

interface Inspection {
  terminal: JavaPacket['terminal'];
  end?: Position;
  nearEnd?: Position;
  initial?: Position;
}

export interface JavaHarness {
  run(
    source: string,
    input: string,
  ): Promise<
    Inspection & {
      usage: JavaResponse['usage'];
      proof: { request: JavaRequest; wasmPages: number } | null;
    }
  >;
  judge(
    source: string,
    profile: string,
  ): Promise<{
    status: string;
    usage: JavaResponse['usage'];
    cases: (Omit<JavaCase, 'packet'> & Inspection)[];
  }>;
  edit(source: string): Promise<{ result: JavaResponse['result']; nodeMap: JavaNode[] }>;
  cancel(): Promise<{ result: string; output?: string; current: boolean; stale: unknown }>;
}

declare global {
  interface Window {
    javaHarness: JavaHarness;
  }
}
