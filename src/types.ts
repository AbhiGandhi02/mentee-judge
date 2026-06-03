// Shared types for the judge service.
// CodeEvaluationResult is intentionally identical in shape to the one in the
// main Next.js app (lib/types.ts) so /api/evaluate-code can proxy us verbatim.

export type CodeLanguage = 'python' | 'javascript' | 'cpp' | 'java';

export type SubmissionStatus =
  | 'passed'
  | 'failed'
  | 'compilation_error'
  | 'runtime_error'
  | 'tle';

export interface TestCase {
  input: string;
  expectedOutput: string;
}

export interface ExecuteRequest {
  code: string;
  language: CodeLanguage;
  testCases: TestCase[];
}

export interface CodeEvaluationResult {
  status: SubmissionStatus;
  passedTests: number;
  totalTests: number;
  failedTestCase?: {
    input: string;
    expectedOutput: string;
    actualOutput: string;
    testNumber: number;
  } | null;
  error?: string | null;
  executionTime: number; // milliseconds — total wall time spent running test cases
}

// Result of a single sandboxed process run (compile or execute).
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxLimits {
  cpuSeconds: number;   // CPU time (ulimit -t)
  wallSeconds: number;  // wall-clock kill (timeout)
  memoryKb: number | null; // address space (ulimit -v); null = don't set (e.g. Java)
  maxProcesses: number; // ulimit -u, fork-bomb guard
  fileSizeKb: number;   // ulimit -f, runaway-output guard
}
