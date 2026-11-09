# Releasing Veritas

Everything here is done by the owner, because it uses the owner's npm account and decides what becomes public. Nothing in this repository publishes by itself.

## State today

- The package is prepared as `veritas-cli`, and the command people type is `veritas`.
- On 2026-11-09 the names `veritas` and `veritas-agent` were already taken on npm by other projects; `veritas-cli` and a scoped name such as `@yourname/veritas` were free. Check again before publishing (`npm view <name>`).
- A packed copy was installed into an empty folder with a fresh `npm install` and run: the `veritas` command works, `veritas doctor` passes, and the Word, PDF and document libraries load.
- The package ships 183 files (about 200 KB): the compiled program, the command entry, the analysis Dockerfile, the licence and the readme. Tests, sources and scripts are not included (a test checks this).

## Steps

1. **Choose the name.** To change it, edit `name` in `package.json` and `PACKAGE` in `scripts/install.sh`; `test/package.test.ts` fails if they disagree. A scoped name needs `npm publish --access public`.
2. **Log in:** `npm login` (use two-factor authentication).
3. **Check:** `npm test`, then `npm pack --dry-run` and look at the file list.
4. **Version:** the version in `package.json`, the `VERSION` line in `scripts/install.sh` and a git tag (`git tag v0.1.0`) should all match.
5. **Publish:** `npm publish` (add `--access public` for a scoped name). `prepublishOnly` runs the tests and `prepack` rebuilds `dist`.
6. **Verify from the outside:** in an empty folder run `npm install -g <name>@0.1.0`, then `veritas doctor`.
7. **Make the README's install lines true.** Until the first release the readme tells people to run from the repository.

## Decisions that belong to the owner

- **Repository visibility.** The repository is private. A one-line `curl … | sh` installer needs a public address, and so do the images in the readme when it is shown on the npm page. `scripts/install.sh` installs from npm, so it works as soon as the package is published, even from a private repository, but it has to be given to people another way (or the repository made public).
- **No auto-update.** Veritas never updates itself. People install a new pinned version on purpose, and the installer pins the version it was written for.

## Known notes

- `npm audit --omit=dev` reports two moderate findings, both from `exceljs` depending on an older `uuid` (a bounds check that matters only when a caller supplies its own buffer). The only available "fix" is downgrading `exceljs` to a much older, incompatible version, so it is left as is.
