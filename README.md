# mentee-judge

Sandboxed code execution service ("judge") for the Mentee Practice Platform.

It replaces the previous approach of asking an LLM to *mentally execute* code.
Submitted code is **actually compiled and run** against hidden test cases inside
a resource-limited sandbox, returning a deterministic verdict.

Supported languages: **Python, JavaScript (Node), C++, Java**.

## How it works

```
Next.js /api/evaluate-code  ──POST /execute──►  mentee-judge
   (proxy + auth)                                  │
                                                   ├─ write source to isolated temp dir
                                                   ├─ compile (C++/Java)
                                                   ├─ run each test case in the sandbox:
                                                   │     • as unprivileged user (uid 1001)
                                                   │     • ulimit: CPU, memory, procs, file size
                                                   │     • timeout: wall-clock kill
                                                   │     • stdin = test input, capture stdout
                                                   ├─ normalize + compare stdout vs expected
                                                   └─ aggregate → CodeEvaluationResult
```

The response shape is **identical** to the platform's `CodeEvaluationResult`
(`lib/types.ts`), so the Next.js route proxies it back unchanged.

### Source layout
| File | Responsibility |
|---|---|
| `src/server.ts`  | Fastify HTTP API, auth, request validation |
| `src/judge.ts`   | Orchestration: write → compile → run tests → aggregate |
| `src/sandbox.ts` | The sandbox — spawns a child with ulimit + timeout as the runner user |
| `src/runners.ts` | Per-language source file, compile/run commands, resource limits, Java class detection |
| `src/compare.ts` | Output normalization & comparison |
| `src/config.ts`  | Env-overridable configuration |
| `src/types.ts`   | Shared types (mirror of the app's `CodeEvaluationResult`) |

> **Source vs build:** everything you edit is **TypeScript** in `src/`. `npm run build`
> compiles it to `dist/*.js` (+ `.js.map`) — those are generated artifacts, not
> something to edit, and they're git-ignored and excluded from the Docker build.
> `npm run dev` runs the `.ts` directly via `tsx`; Docker re-runs `npm run build`
> inside the image. So `src/compare.ts` is the real file; `dist/compare.js` is just
> its compiled output.

## Language handling & memory limits

Memory is capped with `ulimit -v` (virtual address space) for Python and C++.
**The JVM and Node/V8 cannot run under `ulimit -v`** — each reserves a large
virtual address space at startup (the JVM's heap reservation; V8's
pointer-compression *CodeRange* cage) that the limit rejects, failing with
*"Could not reserve enough space for object heap"* / *"Failed to reserve virtual
memory for CodeRange"*. For those two we omit `ulimit -v` and bound the real heap
with engine flags instead:

| Language | Memory cap |
|---|---|
| Python | `ulimit -v 256 MiB` |
| C++ | `ulimit -v 256 MiB` |
| JavaScript | `node --max-old-space-size=240` (no `ulimit -v`) |
| Java | run `java -Xmx240m`, compile `javac -J-Xmx256m` (no `ulimit -v`) |

All other caps — CPU time (`ulimit -t`), wall-clock (`timeout`), max processes
(`ulimit -u`), and file size (`ulimit -f`) — apply to every language.

### Java class names
A Java source file must be named after its public class, and `java` must be
launched with the class that declares `main` — neither is necessarily `Main`.
The judge detects both from the submitted source (`detectJavaNames` in
`runners.ts`, surfaced through the optional `resolve()` hook on a `LanguageSpec`),
writes `<PublicClass>.java`, and runs the class containing `main`. Detection only
accepts plain Java identifiers (`[A-Za-z_][A-Za-z0-9_]*`), so the class name is
safe to interpolate into the compile/run shell command. This is what prevents the
*"Could not find or load main class Main"* error when a submission uses a class
name other than `Main`.

## API

### `POST /execute`
Header: `Authorization: Bearer <JUDGE_SECRET>`

```jsonc
{
  "code": "print(int(input()) * 2)",
  "language": "python",
  "testCases": [ { "input": "21", "expectedOutput": "42" } ]
}
```

Response (`CodeEvaluationResult`):
```jsonc
{
  "status": "passed",         // passed | failed | compilation_error | runtime_error | tle
  "passedTests": 1,
  "totalTests": 1,
  "failedTestCase": null,
  "error": null,
  "executionTime": 38
}
```

### `GET /health`
Returns `{ "ok": true }` (no auth).

## Run locally (Docker — required)

The sandbox uses Linux `ulimit`, `timeout`, and uid/gid dropping, so it must run
on Linux. On Windows/macOS, use Docker:

```bash
docker build -t mentee-judge .
docker run --rm -p 8080:8080 -e JUDGE_SECRET=dev-secret mentee-judge

# smoke test
curl -s localhost:8080/execute \
  -H 'authorization: Bearer dev-secret' \
  -H 'content-type: application/json' \
  -d '{"code":"print(int(input())*2)","language":"python","testCases":[{"input":"21","expectedOutput":"42"}]}'
```

For tighter isolation you can also constrain the container itself:
`docker run --network none --pids-limit 256 --memory 512m ...`

## Deploy to Fly.io

```bash
fly launch --no-deploy          # creates the app from fly.toml
fly secrets set JUDGE_SECRET=<a-long-random-string>
fly deploy
```

Then in the Next.js app set:
- `JUDGE_URL = https://<your-app>.fly.dev`
- `JUDGE_SECRET = <same value>`

## Security model & roadmap

**Phase 1 (this MVP)** — suitable for a *trusted* mentee audience:
- runs as an unprivileged user, isolated temp dir, minimal env
- ulimit caps on CPU / memory / process count / file size
- wall-clock timeout (defeats sleep/IO stalls)
- output capture capped at 1 MiB/stream

Known gaps to close before exposing to untrusted/public users:
- **No network isolation** between submissions (same container can reach the
  network). Mitigate now with `docker run --network none`.
- **No kernel-level isolation** between submissions (shared kernel/filesystem
  view beyond the temp dir).

**Phase 2 (hardening, Fly.io micro-VM)** — swap the bash+ulimit wrapper in
`src/sandbox.ts` for [`isolate`](https://github.com/ioi/isolate) (cgroups +
namespaces + no network). The `run()` signature stays the same, so `judge.ts`
is untouched.

## Configuration (env vars)
| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `JUDGE_SECRET` | _(empty)_ | Bearer token; empty = auth disabled (dev only) |
| `WORK_ROOT` | `/tmp/judge-runs` | Temp dir root |
| `RUNNER_UID` / `RUNNER_GID` | `1001` | Unprivileged exec user (matches Dockerfile) |
| `MAX_TEST_CASES` | `100` | Per-request test-case cap |
| `MAX_CODE_BYTES` | `65536` | Per-request source size cap |

Per-language CPU/memory/time limits live in `src/runners.ts`.
