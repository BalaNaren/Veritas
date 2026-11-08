import type { ModelProvider } from '../agents/provider.js';
import { loadConfig, saveConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { Policy } from '../policy/policy.js';
import { dbPath, ensureHome, resolveHome } from '../storage/paths.js';
import { Store } from '../storage/store.js';
import type { OutputFormatter } from './output.js';
import type { VeritasConfig } from './types.js';

export interface ClaudeProbe {
  found: boolean;
  path?: string;
  version?: string;
  loggedIn?: boolean;
  detail: string;
}

/** Everything the CLI needs from the outside world, so tests can replace it. */
export interface Runtime {
  out: OutputFormatter;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** True when a person can answer questions at the keyboard. */
  interactive: boolean;
  ask(question: string): Promise<string>;
  makeProvider(config: VeritasConfig): ModelProvider;
  probeClaude(config: VeritasConfig): Promise<ClaudeProbe>;
  /** Be told when the user presses Ctrl-C. Returns a function that stops listening. */
  onInterrupt(handler: () => void): () => void;
  /** Delay before retrying a failed agent; tests set 0. */
  retryDelayMs?: number;
}

/** Shared state for one CLI invocation. Opens the database only when a command needs it. */
export class App {
  readonly home: string;
  private cfg?: VeritasConfig;
  private db?: Store;

  constructor(readonly rt: Runtime) {
    this.home = resolveHome(rt.env);
  }

  get config(): VeritasConfig {
    return (this.cfg ??= loadConfig(this.home));
  }

  setConfig(config: VeritasConfig): void {
    ensureHome(this.home);
    saveConfig(this.home, config);
    this.cfg = config;
  }

  get store(): Store {
    if (!this.db) {
      ensureHome(this.home);
      this.db = Store.open(dbPath(this.home));
    }
    return this.db;
  }

  engine(opts: { preApprove?: readonly string[]; config?: VeritasConfig } = {}): Engine {
    const config = opts.config ?? this.config;
    const policy = opts.preApprove?.length ? new Policy().withAllowed(opts.preApprove, 'approved by a command-line flag') : new Policy();
    return new Engine({ store: this.store, provider: this.rt.makeProvider(config), config, policy, retryDelayMs: this.rt.retryDelayMs });
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }
}
