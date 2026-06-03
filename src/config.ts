// Runtime configuration, overridable via environment variables.

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num('PORT', 8080),
  host: process.env.HOST || '0.0.0.0',

  // Shared secret the Next.js proxy must present as `Authorization: Bearer <secret>`.
  // If unset, auth is skipped (fine for local dev only).
  judgeSecret: process.env.JUDGE_SECRET || '',

  // Unprivileged user that compiled/interpreted code runs as. Created in the Dockerfile.
  runnerUid: num('RUNNER_UID', 1001),
  runnerGid: num('RUNNER_GID', 1001),

  // Where per-submission temp directories are created.
  workRoot: process.env.WORK_ROOT || '/tmp/judge-runs',

  // Hard cap on number of test cases per request (DoS guard).
  maxTestCases: num('MAX_TEST_CASES', 100),
  // Hard cap on source size in bytes.
  maxCodeBytes: num('MAX_CODE_BYTES', 64 * 1024),
};
