import { spawn } from 'node:child_process';
import { config } from './config.js';
import type { RunResult, SandboxLimits } from './types.js';

// Output captured per stream is capped so a program spewing gigabytes can't
// exhaust the judge's memory. Anything beyond this is truncated.
const MAX_CAPTURE_BYTES = 1024 * 1024; // 1 MiB

/**
 * Run a single command inside the sandbox.
 *
 * The isolation strategy (MVP / Phase 1):
 *   1. The command runs as an unprivileged user (uid/gid from config), so it
 *      can't touch the judge's files or escalate.
 *   2. We wrap it in `bash -c` and apply POSIX resource limits via `ulimit`:
 *        -t  CPU seconds        (kills CPU-burning loops)
 *        -v  address space      (memory cap; skipped for the JVM, see runners)
 *        -u  max processes      (fork-bomb guard)
 *        -f  max file size      (runaway-output guard)
 *   3. `timeout --signal=KILL` enforces a wall-clock ceiling on top of CPU time
 *      (covers sleep()/blocking-IO that doesn't burn CPU).
 *   4. cwd is an isolated temp dir owned by the runner; a minimal env is passed.
 *
 * Phase 2 (hardening on Fly.io) swaps the bash+ulimit wrapper for `isolate`
 * (namespaces + cgroups + no network). The signature of run() stays the same,
 * so callers in judge.ts don't change.
 */
export function run(opts: {
  command: string;      // e.g. "python3 main.py" or "./main"
  cwd: string;
  input?: string;       // piped to stdin
  limits: SandboxLimits;
}): Promise<RunResult> {
  const { command, cwd, input = '', limits } = opts;

  // Build the ulimit prelude. Each limit is best-effort (`|| true`) so a host
  // that disallows a particular ulimit doesn't abort the whole run.
  const ulimits = [
    `ulimit -t ${limits.cpuSeconds} || true`,
    limits.memoryKb != null ? `ulimit -v ${limits.memoryKb} || true` : '',
    `ulimit -u ${limits.maxProcesses} || true`,
    `ulimit -f ${Math.ceil(limits.fileSizeKb)} || true`,
    `ulimit -c 0 || true`, // no core dumps
  ].filter(Boolean).join('; ');

  // `exec` replaces the shell so signals hit the program directly.
  const script = `${ulimits}; exec timeout --signal=KILL ${limits.wallSeconds}s ${command}`;

  return new Promise<RunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const child = spawn('bash', ['-c', script], {
      cwd,
      uid: config.runnerUid,
      gid: config.runnerGid,
      env: {
        // Deliberately minimal: no inherited secrets, no PWD leakage.
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        HOME: cwd,
        LANG: 'C.UTF-8',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes < MAX_CAPTURE_BYTES) {
        stdout += chunk.toString('utf8');
        stdoutBytes += chunk.length;
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_CAPTURE_BYTES) {
        stderr += chunk.toString('utf8');
        stderrBytes += chunk.length;
      }
    });

    const finish = (res: Omit<RunResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...res, durationMs: Date.now() - start });
    };

    child.on('error', (err) => {
      finish({
        stdout,
        stderr: stderr + `\n[sandbox] failed to start: ${err.message}`,
        exitCode: null,
        signal: null,
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      // `timeout --signal=KILL` exits 124 when it tripped, or the child shows
      // signal SIGKILL. Either way we treat it as a wall-clock timeout.
      const timedOut = code === 124 || signal === 'SIGKILL';
      finish({ stdout, stderr, exitCode: code, signal, timedOut });
    });

    // Feed stdin then close it so programs reading to EOF terminate.
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}
