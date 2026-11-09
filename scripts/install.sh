#!/bin/sh
# Installs the Veritas command-line tool from npm at one fixed version (never "latest").
# It checks your Node.js version, runs `npm install -g`, and changes nothing else:
# no shell settings, no background services, no auto-update.
#
#   sh install.sh             install
#   sh install.sh --dry-run   show what it would do
set -eu

PACKAGE="veritas-cli"
VERSION="0.1.0"          # keep in step with package.json; a test checks it
MIN_MAJOR=22
MIN_MINOR=13

dry=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

command -v npm >/dev/null 2>&1 || fail "npm was not found. Install Node.js ${MIN_MAJOR}.${MIN_MINOR} or newer from https://nodejs.org and try again."
command -v node >/dev/null 2>&1 || fail "node was not found. Install Node.js ${MIN_MAJOR}.${MIN_MINOR} or newer from https://nodejs.org and try again."

# VERITAS_INSTALL_FAKE_NODE lets tests pretend to be another version.
node_version="${VERITAS_INSTALL_FAKE_NODE:-$(node -p 'process.versions.node')}"
node_version="${node_version#v}"
major="${node_version%%.*}"
rest="${node_version#*.}"
minor="${rest%%.*}"
case "$major$minor" in *[!0-9]*|"") fail "Could not read the Node.js version (${node_version})." ;; esac
if [ "$major" -lt "$MIN_MAJOR" ] || { [ "$major" -eq "$MIN_MAJOR" ] && [ "$minor" -lt "$MIN_MINOR" ]; }; then
  fail "Node.js ${node_version} is too old. Veritas needs ${MIN_MAJOR}.${MIN_MINOR} or newer."
fi

say "Installing ${PACKAGE}@${VERSION} (Node.js ${node_version})"
if [ "$dry" -eq 1 ]; then
  say "Would run: npm install -g ${PACKAGE}@${VERSION}"
else
  npm install -g "${PACKAGE}@${VERSION}"
fi

if ! command -v claude >/dev/null 2>&1; then
  say ""
  say "Note: Claude Code was not found. Veritas runs its agents through Claude Code."
  say "Install it from https://claude.com/claude-code and log in before your first task."
fi

if [ "$dry" -eq 1 ]; then say ""; say "Dry run: nothing was installed."; exit 0; fi

say ""
say "Done. Next:"
say "  veritas doctor      check that everything is in place"
say "  veritas --help      see what it can do"
