/**
 * CLI type definitions for Veritas.
 */

// ============================================
// Core Command Types
// ============================================

export interface CommandContext {
  args: string[];
  flags: ParsedFlags;
  config?: VeritasConfig;
  cwd: string;
  interactive: boolean;
}

export interface ParsedFlags {
  [key: string]: string | boolean | number | string[];
  _: string[];
}

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  subcommands?: Command[];
  options?: CommandOption[];
  examples?: CommandExample[];
  action?: CommandAction;
  hidden?: boolean;
}

export interface CommandOption {
  name: string;
  short?: string;
  description: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  default?: unknown;
  required?: boolean;
  choices?: string[];
  validate?: (value: unknown) => boolean | string;
}

export interface CommandExample {
  command: string;
  description: string;
}

export type CommandAction = (ctx: CommandContext) => Promise<CommandResult | void>;

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
  exitCode?: number;
}

// ============================================
// Configuration Types
// ============================================

export interface ModelRoles {
  /** Splits a goal into tasks. */
  planner: string;
  /** Asks clarifying questions. */
  clarifier: string;
  /** Does the actual work for each task. */
  worker: string;
  /** Independently checks claims. */
  checker: string;
  /** Assembles the final result. */
  writer: string;
}

export interface VeritasConfig {
  version: string;
  /** Where Veritas keeps its database and task records (default ~/.veritas). */
  homeDir: string;
  /** Model alias per role (aliases understood by the agent runtime, e.g. "opus"). */
  models: ModelRoles;
  /** How many agents may run at the same time. */
  maxConcurrent: number;
  /** Default spending limit per task, in USD. */
  defaultBudgetUsd: number;
  /** Upper bound on tasks in one plan. */
  maxSubtasks: number;
  /** Per-agent timeout in milliseconds. */
  agentTimeoutMs: number;
  /** Absolute path of the agent runtime binary; discovered automatically when unset. */
  claudeBinary?: string;
  cli: CLIPreferences;
}

export interface CLIPreferences {
  colorOutput: boolean;
  interactive: boolean;
  verbosity: 'quiet' | 'normal' | 'verbose' | 'debug';
  outputFormat: 'text' | 'json' | 'table';
  progressStyle: 'bar' | 'spinner' | 'dots' | 'none';
}

// ============================================
// Output Types
// ============================================

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: (value: unknown) => string;
}

export interface TableOptions {
  columns: TableColumn[];
  data: Record<string, unknown>[];
  border?: boolean;
  header?: boolean;
  padding?: number;
  maxWidth?: number;
}

export interface ProgressOptions {
  total: number;
  current?: number;
  width?: number;
  format?: string;
  showPercentage?: boolean;
  showETA?: boolean;
  showSpeed?: boolean;
}

export interface SpinnerOptions {
  text: string;
  spinner?: 'dots' | 'line' | 'arc' | 'circle' | 'arrows';
  color?: string;
}

// ============================================
// Prompt Types
// ============================================

export interface SelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** For multiselect: whether this option is selected by default */
  selected?: boolean;
}

export interface SelectPromptOptions<T = string> {
  message: string;
  options: SelectOption<T>[];
  default?: T;
  searchable?: boolean;
  pageSize?: number;
}

export interface ConfirmPromptOptions {
  message: string;
  default?: boolean;
  active?: string;
  inactive?: string;
}

export interface InputPromptOptions {
  message: string;
  default?: string;
  placeholder?: string;
  validate?: (value: string) => boolean | string;
  mask?: boolean;
}

export interface MultiSelectPromptOptions<T = string> {
  message: string;
  options: SelectOption<T>[];
  default?: T[];
  required?: boolean;
  min?: number;
  max?: number;
}

// ============================================
// Event Types
// ============================================

export type CLIEventType =
  | 'command:start'
  | 'command:end'
  | 'command:error'
  | 'prompt:start'
  | 'prompt:complete'
  | 'output:write'
  | 'progress:update'
  | 'spinner:start'
  | 'spinner:stop';

export interface CLIEvent {
  type: CLIEventType;
  timestamp: number;
  data?: unknown;
}

// ============================================
// Error Types
// ============================================

export class CLIError extends Error {
  constructor(
    message: string,
    public code: string,
    public exitCode: number = 1,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

export class ValidationError extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 1, details);
    this.name = 'ValidationError';
  }
}

export class ConfigError extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_ERROR', 1, details);
    this.name = 'ConfigError';
  }
}

export class CommandNotFoundError extends CLIError {
  constructor(commandName: string) {
    super(`Unknown command: ${commandName}`, 'COMMAND_NOT_FOUND', 127);
    this.name = 'CommandNotFoundError';
  }
}
