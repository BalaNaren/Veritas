import { existsSync, statSync } from 'node:fs';
import { loadConfig, flattenConfig, setConfigValue, configPath, SETTABLE_KEYS } from '../../config.js';
import { dbPath, ensureHome } from '../../storage/paths.js';
import { MemoryStore, type MemoryKind } from '../../memory/memory-store.js';
import { chooseSandbox } from '../../sandbox/index.js';
import { PINNED_PACKAGES, venvDir } from '../../sandbox/python.js';
import { SandboxExecSandbox } from '../../sandbox/sandbox-exec.js';
import { Store } from '../../storage/store.js';
import { PRODUCT_NAME, VERSION } from '../../version.js';
import type { App } from '../app.js';
import { ValidationError, type Command, type CommandResult } from '../types.js';
import { truncate } from '../format.js';

const ok: CommandResult = { success: true };
const MIN_NODE = [22, 13];

interface Check { name: string; ok: boolean; detail: string }

export function nodeVersionOk(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  return major > MIN_NODE[0]! || (major === MIN_NODE[0] && minor >= MIN_NODE[1]!);
}

export async function runDoctor(app: App): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push({ name: 'Node.js', ok: nodeVersionOk(process.version), detail: `${process.version} (needs ${MIN_NODE.join('.')} or newer)` });

  let config;
  try {
    config = loadConfig(app.home);
    checks.push({ name: 'Settings', ok: true, detail: existsSync(configPath(app.home)) ? configPath(app.home) : 'using defaults (no settings file yet)' });
  } catch (e) {
    checks.push({ name: 'Settings', ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  if (config?.provider === 'anthropic-api') {
    const key = app.rt.env.ANTHROPIC_API_KEY;
    checks.push({ name: 'API key', ok: Boolean(key), detail: key ? 'found in ANTHROPIC_API_KEY (never stored by Veritas)' : 'API mode is on but ANTHROPIC_API_KEY is not set.' });
  } else if (config) {
    const probe = await app.rt.probeClaude(config);
    checks.push({ name: 'Claude Code', ok: probe.found, detail: probe.found ? `${probe.path ?? 'found'}${probe.version ? ` (${probe.version})` : ''}` : probe.detail });
    if (probe.found) checks.push({ name: 'Claude login', ok: probe.loggedIn === true, detail: probe.loggedIn ? probe.detail : `${probe.detail} Run \`claude\` once and log in.` });
  }

  const sandbox = await chooseSandbox(app.home);
  checks.push({ name: 'Analysis sandbox', ok: true, detail: sandbox.sandbox ? `ready (${sandbox.sandbox.backend})` : `not set up; only needed for data analysis. ${sandbox.problem}` });

  if (existsSync(app.home)) {
    const mode = statSync(app.home).mode & 0o777;
    const posix = process.platform !== 'win32';
    checks.push({ name: 'Data folder', ok: !posix || (mode & 0o077) === 0, detail: `${app.home}${posix ? ` (permissions ${mode.toString(8)}${(mode & 0o077) === 0 ? '' : ', others can read it; run chmod 700'})` : ''}` });
    const db = dbPath(app.home);
    if (existsSync(db)) {
      try { const s = Store.open(db); s.listTasks(1); s.close(); checks.push({ name: 'Database', ok: true, detail: db }); }
      catch (e) { checks.push({ name: 'Database', ok: false, detail: e instanceof Error ? e.message : String(e) }); }
    }
  } else {
    checks.push({ name: 'Data folder', ok: true, detail: `${app.home} (created on first use)` });
  }
  return checks;
}

export function adminCommands(app: App): Command[] {
  const { out } = app.rt;
  return [
    {
      name: 'config',
      description: 'Show or change settings: config [list | get <key> | set <key> <value> | path]',
      action: async (ctx) => {
        const [sub = 'list', key, value] = ctx.args;
        if (sub === 'path') { out.writeln(configPath(app.home)); return ok; }
        if (sub === 'list') {
          for (const [k, v] of Object.entries(flattenConfig(app.config))) out.writeln(`${k} = ${v}`);
          return ok;
        }
        if (sub === 'get') {
          if (!key) throw new ValidationError('Usage: veritas config get <key>');
          const v = flattenConfig(app.config)[key];
          if (v === undefined) throw new ValidationError(`Unknown setting "${key}".`);
          out.writeln(String(v));
          return ok;
        }
        if (sub === 'set') {
          if (!key || value === undefined) throw new ValidationError(`Usage: veritas config set <key> <value>\nSettable: ${SETTABLE_KEYS.join(', ')}`);
          app.setConfig(setConfigValue(app.config, key, value));
          out.writeln(`${key} = ${value}`);
          return ok;
        }
        throw new ValidationError(`Unknown config command "${sub}". Use list, get, set or path.`);
      },
    },
    {
      name: 'memory',
      description: 'See or erase what Veritas remembers between tasks: memory [list | search <words> | forget <id> | clear]',
      options: [
        { name: 'kind', type: 'string', description: 'source or preference', choices: ['source', 'preference'] },
        { name: 'yes', type: 'boolean', description: 'Do not ask before clearing' },
      ],
      action: async (ctx) => {
        const [sub = 'list', ...rest] = ctx.args;
        const mem = new MemoryStore(app.store);
        const kind = ctx.flags.kind as MemoryKind | undefined;
        const show = (items: ReturnType<MemoryStore['list']>): void => {
          if (!items.length) { out.writeln('Nothing remembered.'); return; }
          out.writeln(out.table({
            columns: [{ key: 'id', header: 'Id', width: 20 }, { key: 'kind', header: 'Kind', width: 10 }, { key: 'text', header: 'Remembered', width: 70 }, { key: 'uses', header: 'Used', width: 5, align: 'right' }],
            data: items.map((m) => ({ id: m.id, kind: m.kind, text: truncate(m.text, 70), uses: m.uses })),
          }));
        };
        if (sub === 'list') {
          out.writeln(app.config.memoryEnabled ? 'Memory is on. It is stored only on this computer. Turn it off with: veritas config set memoryEnabled false' : out.warning('Memory is off: nothing new is remembered or used. Turn it on with: veritas config set memoryEnabled true'));
          show(mem.list(kind));
          return ok;
        }
        if (sub === 'search') {
          if (!rest.length) throw new ValidationError('Usage: veritas memory search <words>');
          show(mem.search(rest.join(' '), { kind, limit: 20 }));
          return ok;
        }
        if (sub === 'forget') {
          if (!rest[0]) throw new ValidationError('Usage: veritas memory forget <id>');
          if (!mem.forget(rest[0])) throw new ValidationError(`Nothing is remembered under ${rest[0]}.`);
          out.writeln('Forgotten.');
          return ok;
        }
        if (sub === 'clear') {
          const n = mem.count();
          if (!n) { out.writeln('Nothing remembered.'); return ok; }
          if (ctx.flags.yes !== true) {
            if (!app.rt.interactive) throw new ValidationError('Run this in a terminal, or pass --yes to confirm.');
            const a = (await app.rt.ask(`Erase all ${n} remembered item${n === 1 ? '' : 's'}? [y/N] `)).trim().toLowerCase();
            if (a !== 'y' && a !== 'yes') { out.writeln('Nothing was erased.'); return ok; }
          }
          out.writeln(`Erased ${mem.clear(kind)} item${n === 1 ? '' : 's'}.`);
          return ok;
        }
        throw new ValidationError(`Unknown memory command "${sub}". Use list, search, forget or clear.`);
      },
    },
    {
      name: 'setup',
      description: 'Set up the sandbox that data analysis runs in (asks before installing anything)',
      options: [{ name: 'yes', type: 'boolean', description: 'Do not ask for confirmation' }],
      action: async (ctx) => {
        const current = await chooseSandbox(app.home);
        if (current.sandbox) { out.writeln(`Already set up: analysis runs in the ${current.sandbox.backend} sandbox.`); return ok; }
        const what = SandboxExecSandbox.available()
          ? `download and install ${PINNED_PACKAGES.join(', ')} from the Python package index into a private folder (${venvDir(app.home)}). Nothing outside that folder is changed.`
          : 'build a Docker image (veritas-python:1) from the Dockerfile that ships with Veritas, downloading a pinned Python base image and the same pinned libraries.';
        out.writeln(`Data analysis runs code the AI writes, only inside a sandbox with no network access. To prepare it Veritas will ${what}`);
        if (ctx.flags.yes !== true) {
          if (!app.rt.interactive) throw new ValidationError('Run this in a terminal, or pass --yes to confirm.');
          const a = (await app.rt.ask('Go ahead? [y/N] ')).trim().toLowerCase();
          if (a !== 'y' && a !== 'yes') { out.writeln('Nothing was installed.'); return ok; }
        }
        ensureHome(app.home);
        if (!app.rt.setupRuntime) throw new ValidationError('Setup is not available here.');
        await app.rt.setupRuntime(app.home, (m) => out.writeln(out.dim(m)));
        const after = await chooseSandbox(app.home);
        if (!after.sandbox) throw new ValidationError(after.problem ?? 'Setup finished but the sandbox is still unavailable.');
        out.writeln(out.success(`Ready: analysis runs in the ${after.sandbox.backend} sandbox.`));
        return ok;
      },
    },
    {
      name: 'doctor',
      description: 'Check that everything Veritas needs is in place',
      action: async () => {
        const checks = await runDoctor(app);
        for (const c of checks) out.writeln(`${c.ok ? out.success('ok     ') : out.error('problem')}  ${c.name}: ${c.detail}`);
        const bad = checks.filter((c) => !c.ok).length;
        out.writeln(bad ? out.error(`\n${bad} problem${bad === 1 ? '' : 's'} found.`) : out.success('\nAll good.'));
        return { success: bad === 0, exitCode: bad ? 1 : 0 };
      },
    },
    {
      name: 'version',
      description: 'Show the version',
      action: async () => { out.writeln(`${PRODUCT_NAME} ${VERSION}`); return ok; },
    },
  ];
}
