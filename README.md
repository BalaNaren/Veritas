# Veritas

An AI task agent that proves its work. Give it a goal; a planner splits it into tasks, parallel agents do the work, an independent verifier checks every claim against its source, and a writer delivers a finished, cited result.

**Status:** early development (milestone M1: engine). See [`docs/PRODUCT.md`](docs/PRODUCT.md) and [`docs/plan/BUILD-PLAN.md`](docs/plan/BUILD-PLAN.md).

## Requirements

- Node.js 22.13 or newer
- [Claude Code](https://claude.com/claude-code), logged in (agents run as headless Claude Code sessions)

## Development

```
npm ci
npm run build
npm test
```

## License

Apache-2.0
