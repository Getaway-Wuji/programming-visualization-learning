import type {
  PythonNode,
  PythonPacket,
  PythonRequest,
  PythonResponse,
  PythonResult,
  PythonState,
} from '../../web/src/engine/python3-types';

interface Inspection {
  terminal: PythonPacket['terminal'];
  end?: { cursor: number; state: PythonState };
  initial?: { cursor: number; state: PythonState };
}

export interface Python3Harness {
  run(
    source: string,
    input: string,
  ): Promise<
    Inspection & {
      usage: PythonResponse['usage'];
      positions: [number, { line: number; column: number; utf16Offset: number }][];
      proof: { request: PythonRequest; wasmPages: number } | null;
    }
  >;
  judge(
    source: string,
    profile: string,
  ): Promise<{
    status: 'passed' | 'failed' | 'incomplete';
    usage: PythonResponse['usage'];
    cases: (Inspection & {
      caseKey: number;
      stdoutMatches: boolean;
      observationMatches: boolean;
    })[];
  }>;
  edit(source: string): Promise<{ result: PythonResult; nodeMap: PythonNode[] }>;
  cancel(): Promise<{ result: string; output?: string }>;
}

declare global {
  interface Window {
    python3Harness: Python3Harness;
  }
}
