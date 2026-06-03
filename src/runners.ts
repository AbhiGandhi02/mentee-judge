import type { CodeLanguage, SandboxLimits } from './types.js';

// Per-language definition of how to lay source on disk, compile it (if needed),
// and run it. Memory is enforced via ulimit -v for native/interpreted langs;
// for Java we leave memoryKb null and instead cap the heap with -Xmx, because
// the JVM reserves a huge virtual address space that ulimit -v would reject.

export interface LanguageSpec {
  sourceFile: string;
  // Command to compile, or null if interpreted. Runs with `compileLimits`.
  compileCommand: string | null;
  // Command to execute the program for each test case.
  runCommand: string;
  compileLimits: SandboxLimits;
  runLimits: SandboxLimits;
  // Optional: derive the source filename and compile/run commands from the
  // submitted code. Java needs this because the file must be named after the
  // public class and `java` must be launched with the class that declares main.
  resolve?(code: string): {
    sourceFile: string;
    compileCommand: string | null;
    runCommand: string;
  };
}

// Java requires the source file to be named after its public class, and the
// `java` launcher must be given the class that declares `main`. Neither is
// necessarily `Main` — the platform's default template uses `Main`, but
// per-question (often AI-generated) starter code may use another class name,
// and mentees may rename it. Detecting the names avoids the
// "Could not find or load main class Main" failure.
//
// Class names are interpolated into a shell command, so we only ever accept
// plain Java identifiers ([A-Za-z_][A-Za-z0-9_]*) — no shell metacharacters,
// and `$` is excluded so bash can't treat it as a variable reference.
export function detectJavaNames(code: string): { fileBase: string; runClass: string } {
  // Strip comments and string/char literals so keywords inside them don't fool
  // the matcher.
  const stripped = code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  const ID = '[A-Za-z_][A-Za-z0-9_]*';
  // A top-level type can be a class, interface, enum, or record, with optional
  // modifiers — and any of them can declare `main`.
  const TYPE = '(?:class|interface|enum|record)';
  const MODS = '(?:final\\s+|abstract\\s+|strictfp\\s+|sealed\\s+|non-sealed\\s+)*';

  const publicClass = stripped.match(
    new RegExp(`\\bpublic\\s+${MODS}${TYPE}\\s+(${ID})`)
  )?.[1];

  // The type whose body contains `public static void main`: the last type
  // declared at or before the `main` declaration.
  let mainClass: string | undefined;
  const mainIdx = stripped.search(/\bstatic\s+(?:final\s+)?void\s+main\b/);
  if (mainIdx !== -1) {
    const typeRe = new RegExp(`\\b${TYPE}\\s+(${ID})`, 'g');
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(stripped)) && m.index < mainIdx) {
      mainClass = m[1];
    }
  }

  const runClass = mainClass ?? publicClass ?? 'Main';
  // The file must be named after the public class when one exists (javac rule);
  // otherwise name it after the class we'll run.
  const fileBase = publicClass ?? runClass;
  return { fileBase, runClass };
}

const RUN_CPU = 5;
const RUN_WALL = 10;
const RUN_PROCS = 64;
const RUN_FILE_KB = 8 * 1024; // 8 MiB of output to disk
const RUN_MEM_KB = 256 * 1024; // 256 MiB

const COMPILE_CPU = 10;
const COMPILE_WALL = 20;
const COMPILE_MEM_KB = 512 * 1024; // 512 MiB
const COMPILE_PROCS = 128;
const COMPILE_FILE_KB = 64 * 1024;

const compileLimits: SandboxLimits = {
  cpuSeconds: COMPILE_CPU,
  wallSeconds: COMPILE_WALL,
  memoryKb: COMPILE_MEM_KB,
  maxProcesses: COMPILE_PROCS,
  fileSizeKb: COMPILE_FILE_KB,
};

// javac is itself a JVM, which reserves a huge virtual address space at startup
// — far larger than its actual heap. Under `ulimit -v` that reservation fails
// ("Could not reserve enough space for object heap"), so we leave memoryKb null
// here and instead bound javac's heap via `-J-Xmx` in the compile command.
// Same reasoning as the run phase using runLimits(null) for Java.
const javaCompileLimits: SandboxLimits = { ...compileLimits, memoryKb: null };

function runLimits(memoryKb: number | null): SandboxLimits {
  return {
    cpuSeconds: RUN_CPU,
    wallSeconds: RUN_WALL,
    memoryKb,
    maxProcesses: RUN_PROCS,
    fileSizeKb: RUN_FILE_KB,
  };
}

export const SPECS: Record<CodeLanguage, LanguageSpec> = {
  python: {
    sourceFile: 'main.py',
    compileCommand: null,
    runCommand: 'python3 main.py',
    compileLimits,
    runLimits: runLimits(RUN_MEM_KB),
  },
  javascript: {
    sourceFile: 'main.js',
    compileCommand: null,
    // Like the JVM, V8 reserves a large virtual address space (its
    // pointer-compression cage / CodeRange) that `ulimit -v` rejects with
    // "Failed to reserve virtual memory for CodeRange". So no ulimit -v here;
    // bound the actual heap with --max-old-space-size instead.
    runCommand: 'node --max-old-space-size=240 main.js',
    compileLimits,
    runLimits: runLimits(null),
  },
  cpp: {
    sourceFile: 'main.cpp',
    compileCommand: 'g++ -O2 -std=c++17 -o main main.cpp',
    runCommand: './main',
    compileLimits,
    runLimits: runLimits(RUN_MEM_KB),
  },
  java: {
    // Defaults assume `public class Main`; resolve() overrides them per-submission.
    sourceFile: 'Main.java',
    // Bound javac's own JVM heap with -J-Xmx since we can't use ulimit -v here.
    compileCommand: 'javac -J-Xmx256m Main.java',
    // No ulimit -v for the JVM; bound the heap instead.
    runCommand: 'java -Xmx240m -XX:-UsePerfData Main',
    compileLimits: javaCompileLimits,
    runLimits: runLimits(null),
    resolve(code) {
      const { fileBase, runClass } = detectJavaNames(code);
      return {
        sourceFile: `${fileBase}.java`,
        compileCommand: `javac -J-Xmx256m ${fileBase}.java`,
        runCommand: `java -Xmx240m -XX:-UsePerfData ${runClass}`,
      };
    },
  },
};
