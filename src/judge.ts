import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { chownSync } from 'node:fs';
import { config } from './config.js';
import { run } from './sandbox.js';
import { SPECS } from './runners.js';
import { outputsMatch } from './compare.js';
import type { CodeEvaluationResult, ExecuteRequest } from './types.js';

/**
 * Evaluate a submission: write the source, compile if needed, run every test
 * case in the sandbox, and aggregate into a CodeEvaluationResult.
 */
export async function judge(req: ExecuteRequest): Promise<CodeEvaluationResult> {
  const { code, language, testCases } = req;
  const spec = SPECS[language];
  const totalTests = testCases.length;

  // Some languages (Java) must derive the source filename and compile/run
  // commands from the code itself. resolve() falls back to the static spec.
  const { sourceFile, compileCommand, runCommand } = spec.resolve
    ? spec.resolve(code)
    : { sourceFile: spec.sourceFile, compileCommand: spec.compileCommand, runCommand: spec.runCommand };

  // Isolated working directory, owned by the unprivileged runner so the
  // sandboxed process can read its source and write its compiled binary.
  const dir = await mkdtemp(join(config.workRoot, 'run-'));
  try {
    chownSync(dir, config.runnerUid, config.runnerGid);
    await chmod(dir, 0o770);

    const sourcePath = join(dir, sourceFile);
    await writeFile(sourcePath, code, 'utf8');
    chownSync(sourcePath, config.runnerUid, config.runnerGid);

    // --- Compile phase (C++/Java) ---
    if (compileCommand) {
      const compile = await run({
        command: compileCommand,
        cwd: dir,
        limits: spec.compileLimits,
      });
      if (compile.timedOut) {
        return result('compilation_error', 0, totalTests, {
          error: 'Compilation timed out.',
          executionTime: compile.durationMs,
        });
      }
      if (compile.exitCode !== 0) {
        return result('compilation_error', 0, totalTests, {
          error: truncate(compile.stderr || compile.stdout || 'Compilation failed.'),
          executionTime: compile.durationMs,
        });
      }
    }

    // --- Run phase: one sandboxed execution per test case ---
    let passed = 0;
    let totalRunMs = 0;

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const exec = await run({
        command: runCommand,
        cwd: dir,
        input: ensureTrailingNewline(tc.input),
        limits: spec.runLimits,
      });
      totalRunMs += exec.durationMs;

      if (exec.timedOut) {
        return result('tle', passed, totalTests, {
          executionTime: totalRunMs,
          error: `Time limit exceeded on test ${i + 1}.`,
          failedTestCase: {
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            actualOutput: truncate(exec.stdout),
            testNumber: i + 1,
          },
        });
      }

      // Non-zero exit / killing signal = runtime error.
      if (exec.exitCode !== 0) {
        return result('runtime_error', passed, totalTests, {
          executionTime: totalRunMs,
          error: truncate(exec.stderr || `Program exited with code ${exec.exitCode}.`),
          failedTestCase: {
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            actualOutput: truncate(exec.stdout),
            testNumber: i + 1,
          },
        });
      }

      if (outputsMatch(exec.stdout, tc.expectedOutput)) {
        passed++;
      } else {
        return result('failed', passed, totalTests, {
          executionTime: totalRunMs,
          failedTestCase: {
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            actualOutput: truncate(exec.stdout),
            testNumber: i + 1,
          },
        });
      }
    }

    return result('passed', passed, totalTests, {
      executionTime: totalRunMs,
      failedTestCase: null,
    });
  } finally {
    // Always clean up the temp dir, even on error.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function result(
  status: CodeEvaluationResult['status'],
  passedTests: number,
  totalTests: number,
  extra: Partial<CodeEvaluationResult>
): CodeEvaluationResult {
  return {
    status,
    passedTests,
    totalTests,
    failedTestCase: extra.failedTestCase ?? null,
    error: extra.error ?? null,
    executionTime: extra.executionTime ?? 0,
  };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : s + '\n';
}

function truncate(s: string, max = 4000): string {
  return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s;
}
