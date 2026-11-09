import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { PathValidator } from '../security/path-validator.js';

/**
 * The file tools an agent gets in API mode. They run inside Veritas, never as a shell, and every path is checked
 * against the folders the run is allowed to use (symlinks resolved, sensitive names and extensions refused).
 */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_CHARS = 60_000;
const MAX_FILES_SCANNED = 5000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Names of the built-in tools API mode implements itself. */
export const CLIENT_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit'] as const;
/** Names it hands to the API's own servers. */
export const SERVER_TOOLS = ['WebSearch', 'WebFetch'] as const;

const DEFS: Record<string, ToolDef> = {
  Read: {
    name: 'Read',
    description: 'Read a text file. Returns the content (long files are cut; use offset and limit, counted in lines).',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, required: ['path'] },
  },
  Grep: {
    name: 'Grep',
    description: 'Search files for a regular expression. Returns matching lines as path:line:text.',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Folder or file; defaults to the working folder.' } }, required: ['pattern'] },
  },
  Glob: {
    name: 'Glob',
    description: 'List files whose path matches a pattern such as "src/**/*.ts" (* matches within a folder, ** across folders).',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
  },
  Write: {
    name: 'Write',
    description: 'Create or overwrite a text file inside the working folder.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  Edit: {
    name: 'Edit',
    description: 'Replace one exact piece of text in a file. old_string must occur exactly once.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] },
  },
};

export function clientToolDefs(names: readonly string[]): ToolDef[] {
  return names.filter((n) => DEFS[n]).map((n) => DEFS[n]!);
}

export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') { i++; if (pattern[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const clip = (s: string): string => (s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n[cut: result too long]` : s);
const ok = (content: string): ToolResult => ({ content: clip(content), isError: false });
const fail = (content: string): ToolResult => ({ content, isError: true });
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export class ApiToolbox {
  private readonly readable: PathValidator;
  private readonly writable: PathValidator;

  /** `cwd` is where the agent works and may write; `readDirs` are extra folders it may read. */
  constructor(private readonly cwd: string, readDirs: readonly string[] = [], private readonly enabled: ReadonlySet<string> = new Set(CLIENT_TOOLS)) {
    this.readable = new PathValidator({ allowedPrefixes: [cwd, ...readDirs], allowHidden: true });
    this.writable = new PathValidator({ allowedPrefixes: [cwd], allowHidden: true });
  }

  private async resolve(raw: unknown, forWrite: boolean): Promise<{ path: string } | { error: string }> {
    const p = str(raw);
    if (!p) return { error: 'path is required' };
    const abs = p.startsWith('/') ? p : join(this.cwd, p);
    const v = await (forWrite ? this.writable : this.readable).validate(abs);
    return v.isValid ? { path: v.resolvedPath } : { error: `Not allowed: ${v.errors.join('; ')}` };
  }

  async run(name: string, input: unknown): Promise<ToolResult> {
    if (!this.enabled.has(name)) return fail(`Tool ${name} is not available.`);
    const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'Read': return await this.read(args);
        case 'Grep': return await this.grep(args);
        case 'Glob': return await this.glob(args);
        case 'Write': return await this.write(args);
        case 'Edit': return await this.edit(args);
        default: return fail(`Unknown tool ${name}.`);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  private async read(a: Record<string, unknown>): Promise<ToolResult> {
    const r = await this.resolve(a.path, false);
    if ('error' in r) return fail(r.error);
    const s = await stat(r.path);
    if (!s.isFile()) return fail('Not a file.');
    if (s.size > MAX_READ_BYTES * 4) return fail('File is too large to read.');
    const text = (await readFile(r.path, 'utf8')).slice(0, MAX_READ_BYTES * 4);
    if (text.includes('\0')) return fail('Not a text file.');
    const lines = text.split('\n');
    const offset = Math.max(0, Number(a.offset) || 0);
    const limit = Math.max(1, Number(a.limit) || lines.length);
    return ok(lines.slice(offset, offset + limit).map((l, i) => `${offset + i + 1}\t${l}`).join('\n'));
  }

  private async files(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= MAX_FILES_SCANNED) return;
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_FILES_SCANNED) return;
        const full = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(full); }
        else if (e.isFile()) out.push(full);
      }
    };
    if (statSync(root).isDirectory()) await walk(root); else out.push(root);
    return out;
  }

  private async glob(a: Record<string, unknown>): Promise<ToolResult> {
    const pattern = str(a.pattern);
    if (!pattern) return fail('pattern is required');
    const re = globToRegExp(pattern.replace(/^\.\//, ''));
    const matches: string[] = [];
    for (const f of await this.files(this.cwd)) {
      const rel = relative(this.cwd, f);
      if (re.test(rel) && (await this.readable.validate(f)).isValid) matches.push(rel);
    }
    return ok(matches.length ? matches.sort().join('\n') : 'No files match.');
  }

  private async grep(a: Record<string, unknown>): Promise<ToolResult> {
    const pattern = str(a.pattern);
    if (!pattern) return fail('pattern is required');
    let re: RegExp;
    try { re = new RegExp(pattern); } catch { return fail('pattern is not a valid regular expression'); }
    const r = a.path === undefined ? { path: this.cwd } : await this.resolve(a.path, false);
    if ('error' in r) return fail(r.error);
    const hits: string[] = [];
    for (const f of await this.files(r.path)) {
      if (hits.length >= 500) break;
      if (!(await this.readable.validate(f)).isValid) continue;
      const s = await stat(f);
      if (s.size > MAX_READ_BYTES) continue;
      const text = await readFile(f, 'utf8');
      if (text.includes('\0')) continue;
      text.split('\n').forEach((line, i) => { if (hits.length < 500 && re.test(line)) hits.push(`${relative(this.cwd, f)}:${i + 1}:${line.slice(0, 300)}`); });
    }
    return ok(hits.length ? hits.join('\n') : 'No matches.');
  }

  private async write(a: Record<string, unknown>): Promise<ToolResult> {
    const r = await this.resolve(a.path, true);
    if ('error' in r) return fail(r.error);
    const content = str(a.content);
    if (content === undefined) return fail('content is required');
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) return fail('Content is too large.');
    await mkdir(dirname(r.path), { recursive: true });
    await writeFile(r.path, content, { mode: 0o600 });
    return ok(`Wrote ${relative(this.cwd, r.path)}.`);
  }

  private async edit(a: Record<string, unknown>): Promise<ToolResult> {
    const r = await this.resolve(a.path, true);
    if ('error' in r) return fail(r.error);
    const oldS = str(a.old_string);
    const newS = str(a.new_string);
    if (!oldS || newS === undefined) return fail('old_string and new_string are required');
    if (!existsSync(r.path)) return fail('File does not exist.');
    const text = await readFile(r.path, 'utf8');
    const count = text.split(oldS).length - 1;
    if (count !== 1) return fail(count === 0 ? 'old_string was not found.' : `old_string occurs ${count} times; it must occur exactly once.`);
    await writeFile(r.path, text.replace(oldS, () => newS), { mode: 0o600 });
    return ok(`Edited ${relative(this.cwd, r.path)}.`);
  }
}
