export interface SandboxInputFile {
  /** Name the code will see under `input/`. */
  name: string;
  /** Where to copy it from. */
  path: string;
}

export interface SandboxRequest {
  /** The analysis code, exactly as written by the agent. */
  code: string;
  inputFiles?: readonly SandboxInputFile[];
  /** Folder where files the code wrote under `output/` are kept after the run. */
  outputDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SandboxOutputFile {
  /** Path relative to `output/`. */
  name: string;
  /** Where Veritas kept the copy. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface SandboxResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when stdout or stderr was cut because the code printed too much. */
  truncated: boolean;
  outputs: SandboxOutputFile[];
  durationMs: number;
  backend: string;
}

/** Runs code the agent wrote somewhere it cannot do harm. There is deliberately no way to run code without one. */
export interface Sandbox {
  readonly backend: string;
  run(request: SandboxRequest): Promise<SandboxResult>;
}

export const SANDBOX_LIMITS = {
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 1024 * 1024,
  maxOutputFiles: 50,
  maxOutputFileBytes: 20 * 1024 * 1024,
  maxInputBytes: 200 * 1024 * 1024,
} as const;

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}
