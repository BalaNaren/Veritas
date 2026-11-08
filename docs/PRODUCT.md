# Veritas — Product Document

> **Status:** Draft v0.1 · **Last updated:** 2026-10-10 · **Owner:** Bala Naren Chanumolu · **Author:** Bala Naren Chanumolu

---

## Introduction

Veritas is an AI agent that does real work for anyone, and proves it. You give it a goal in plain language: "research the EV battery market in India", "compare these five vendor contracts", "find out why sales dropped last quarter", or "fix the login bug in my app". Veritas breaks the goal into smaller tasks and hands them to a team of AI agents working in parallel. It checks their work and delivers a finished result: a cited report, an analysis with charts, or tested code.

What sets Veritas apart is that every answer comes with evidence. Today's AI tools often sound confident while inventing sources, statistics and facts, or quietly guessing what you meant, so users have to double-check everything themselves. Veritas is built the other way around. It asks when your request is unclear instead of guessing. Every claim links to the source it came from, every number comes from a cited source or a calculation that actually ran, and anything it couldn't verify is clearly marked.

Veritas is open source and starts as a command-line tool, with a visual app to follow. It runs on your own machine with your own Anthropic API key, or as a hosted service with a monthly subscription. At launch it handles three kinds of work: **research reports**, **document and data analysis**, and **coding**.

---

## 1. Mission & Vision

### Mission
Make AI agents you can trust: give Veritas a task, and get finished work with every claim backed by evidence.

### Vision
A world where everyone has a trustworthy AI team, and "the AI said so" always comes with proof.

### What this means in practice
- **We finish the work.** Veritas delivers a finished result (a report, an analysis, working code), not a chat reply you still have to act on.
- **We prove the work.** Every factual claim links to the source it came from. Every number comes from a cited source or a calculation that actually ran. Anything we couldn't verify is clearly marked.
- **We don't make things up.** Before delivery, every claim is checked against the source it cites. Claims that don't hold up are removed or clearly flagged, so a model's mistake never reaches you disguised as fact.
- **We don't assume.** When a request is unclear or missing something important, Veritas asks before starting. When it does make a reasonable assumption, such as a time period or a region, it says so up front in the result so you can correct it.
- **We never fake it.** No invented sources, no made-up metrics, no simulated progress. If Veritas can't do something, it says so.

---

## 2. The Problem

AI can now write, research, analyze and code. But for most people, getting real, reliable work out of it is still hard.

### 2.1 AI answers can't be trusted without checking
AI tools often state wrong things with full confidence. They invent sources, cite papers that don't exist, make up statistics, and get numbers wrong. Worse, they rarely say when they're unsure. So people have to fact-check everything themselves, which removes much of the time AI was supposed to save. For anything that matters (a business decision, a school paper, a legal or financial question), an unverified answer is a risk, not a help.

### 2.2 AI guesses instead of asking
When a request is vague, most AI tools quietly fill the gaps with their own assumptions: which time period, which country, which definition, which file. The user often doesn't notice, and the result answers a question they never asked.

### 2.3 Chat gives you replies, not finished work
Most AI products are chat windows. You get a reply, then you still have to do the work: copy it into a document, fix the formatting, chase the sources, run the numbers, ask follow-up after follow-up. Big tasks like a full market report, a comparison of ten documents, or a multi-file code change need many steps and long attention, and a single chat session tends to lose context, stall or cut corners partway through.

### 2.4 One agent, one step at a time, is slow
A single AI assistant works through a big task one step at a time. Research that could cover twenty sources at once instead crawls through them in order, or gives up after a few.

### 2.5 The work is scattered across many tools
Research in one product, document analysis in another, data analysis in a spreadsheet tool, coding in yet another. Each has its own subscription, its own interface and its own limits, and nothing carries over between them.

### 2.6 Existing "agent" tools overpromise
A new wave of AI agent and multi-agent tools promises to solve this. In practice, many are built for developers only, hard to set up, and opaque about what they actually do. Some show impressive-looking dashboards, metrics and "agent activity" that are simulated rather than real. Others make changes to your computer or projects without asking, or depend on unpinned software that can change under you. When a tool's claims can't be checked, trust breaks down, which is the original problem all over again.

### The core problem in one line
People want AI to do real work for them, but today they can't trust the output, can't easily get finished results, and can't see what the AI actually did.

---

## 3. Why It Matters / Why Now

### 3.1 Why it matters

**Trust is the bottleneck for AI.** AI models are already capable enough to do a lot of useful work. What holds people back is not capability but reliability: they can't hand off a task if they have to redo it to be sure it's right. The tool that makes AI output *checkable* unlocks far more value than one that only makes it faster.

**Wrong answers have real costs.** A made-up statistic in a business plan, a fake citation in a school paper, or a misread contract clause can cost money, grades, credibility or legal trouble. As more people rely on AI for decisions, the cost of unverified output keeps rising.

**Everyone deserves a capable assistant, not just developers.** The most powerful AI agent tools today mostly need technical skill to set up and use. Students, small business owners, analysts and researchers have the same need to get work done, and are least able to spot when an AI is wrong. A trustworthy agent matters most for them.

**Time is the real prize.** Hours spent searching, reading, cross-checking, compiling and formatting are hours not spent deciding and creating. A tool that delivers finished, verified work gives people that time back.

### 3.2 Why now

**AI models can now do long, multi-step work.** Current models can plan, use tools, search the web, read long documents, run code and work for extended periods on one task. Running a team of agents on a real goal is now practical rather than experimental.

**The building blocks for verification exist.** AI platforms now provide web search and page fetching with exact quoted citations, citation of passages and page numbers in documents, and sandboxed code execution. These make it possible to tie every claim to evidence and every number to a real calculation. A verification-first product could not have been built well even recently.

**Parallel agents are now affordable.** Smaller, cheaper models are capable enough to handle reading and checking at scale, while stronger models handle planning and writing. Running many agents on one task no longer costs a fortune.

**People have learned AI's limits, and want better.** After a few years of mainstream AI use, most people have been burned by a confident wrong answer. There is growing demand for AI that shows its work, and a gap for a product that treats verification as the core feature rather than an afterthought.

**The agent space is crowded, but not trusted.** Many agent tools are launching, yet most compete on speed and flashy features rather than reliability. The opening is for a tool whose main promise is that you can trust what it gives you.

---

## 4. Who It's For

Veritas is for anyone who needs real work done and needs to trust the result. Below are the main groups we're designing for, with an example of how each would use it.

### 4.1 Target users

| User | What they need | Example task |
|---|---|---|
| **Students & academics** | Research with real, checkable sources | "Write a literature review on microplastics in drinking water, with citations to actual studies" |
| **Professionals & knowledge workers** | Fast, reliable answers for work decisions | "Summarize the new data privacy regulations that affect our company, with links to the official texts" |
| **Business analysts** | Analysis of their own data and documents, with numbers they can defend | "Analyze this sales spreadsheet and explain why Q3 revenue dropped, with charts" |
| **Founders & small business owners** | Market and competitor research without hiring a consultant | "Research the meal-kit delivery market in the US: size, top competitors and pricing" |
| **Researchers & journalists** | Fact-finding where every claim must hold up | "Find every public statement the company made about the recall, with dates and sources" |
| **Legal, finance & operations teams** | Careful reading and comparison of long documents | "Compare these five vendor contracts and flag differences in liability and termination terms" |
| **Developers** | Coding help that's tested, not just plausible | "Fix the failing login tests in this repo and explain what was wrong" |

### 4.2 What they have in common
- They need **finished work**, not a chat conversation.
- The result **matters**, so mistakes are costly.
- They want to **see the evidence** behind the answer.
- They don't have time to **double-check everything** themselves.

### 4.3 Who we serve first
Veritas launches as a **command-line tool**, so our first users will be people comfortable with a terminal: developers, technical analysts, researchers and early adopters. They will help shape the product and its verification system. The **visual app** that follows opens Veritas to everyone else: students, professionals and business users who never touch a terminal.

### 4.4 Who it's not for (at launch)
- People who want a casual chatbot for quick conversation.
- Tasks that act on your accounts, such as sending emails, making payments or booking travel. These are planned for later, with strict approval controls.
- Organizations needing enterprise features (single sign-on, admin controls, compliance certifications) at launch.

See Non-Goals (Section 15) for the full list.

---

## 5. Principles

These are the rules Veritas is built by. When a decision is hard, these decide it. A feature that breaks a principle doesn't ship.

### 5.1 Truth over appearance
- **Every claim needs evidence.** A factual statement in a result must link to the source it came from, with the exact quoted passage.
- **Every number needs a source or a calculation.** Numbers quoted from a source must cite it like any other claim. Figures, totals, percentages and charts that Veritas works out come from code that actually ran on real data, and the code is available to inspect.
- **Unverified means labeled.** If something can't be verified, it is clearly marked as such or left out. It is never presented as fact.
- **No fake signals.** No simulated progress, invented metrics, placeholder results or made-up activity, anywhere in the product: not in the CLI, the app, the logs or the marketing.

### 5.2 Ask, don't assume
- If a request is ambiguous or missing important information, Veritas asks before starting work.
- Any assumption it does make is stated plainly in the result.
- Veritas says "I don't know" or "I couldn't find this" when that is the truth.

### 5.3 The user is in control
- **Nothing happens without consent.** Veritas never changes your computer, settings, files or projects in the background. No silent updates, no hidden background processes, no edits to global configuration.
- **Risky actions need approval.** Anything that spends significant money, deletes or overwrites files, or sends information to a new destination asks first.
- **Costs are visible up front.** Veritas shows an estimate before a task starts and enforces a spending limit the user sets. A task never quietly runs up a bill.
- **The user can stop anything, anytime.**

### 5.4 Transparent by default
- Users can see the plan, which agent is doing what, which sources are being read, and what each step cost: live, while it happens.
- Every finished task keeps a full record of sources, code and steps, so the work can be audited later.

### 5.5 Safe by default
- Code runs in an isolated sandbox, never directly on the user's system.
- Every dependency is pinned to an exact version. Veritas never pulls "latest" software automatically.
- Secrets and API keys are stored securely and never written to logs or sent anywhere they aren't needed.
- Text from web pages and documents is treated as data, never as instructions. A web page can't tell Veritas what to do.

### 5.6 Private by design
- In local mode with your own Anthropic key, your files and results stay on your machine. Content is sent only to the AI provider (Anthropic) for processing, never to Veritas servers. (With a Veritas key, AI requests pass through Veritas servers for usage tracking; see 13.3.)
- In hosted mode, your data is used only to perform your tasks, never for advertising, and never sold.
- No ads, no sponsored content and no promotional messages inside the product or the AI's responses.
- Usage analytics are off unless you opt in.

### 5.7 Small, solid core
- A small set of features that work for real beats a long list that half-works.
- A feature is "done" only when it works end to end and is tested, not when it has been described.
- Veritas is designed to be extended through plugins and skills (coming after v1), so the core stays simple.

### 5.8 Honest claims
- We only claim what we have measured. Performance numbers and benchmarks in our docs must be reproducible, with the method published.
- Documentation describes what the product does today, not what it might do someday.

---

## 6. Differentiators

Veritas stands out in five ways, ranked by importance. The first is the core promise; the others support it.

### 6.1 Verified output: "the agent you can trust" (primary)
Every factual claim links to the source the agent actually read, with the exact quoted passage. Every number comes from a cited source or from code that actually ran. A separate checker agent re-reads each source and confirms each claim before the result is delivered. Anything that can't be verified is clearly labeled. Each result ends with a verification summary showing how many claims were checked, confirmed, flagged or removed.

*Why it matters:* users can rely on the result without redoing the work.

### 6.2 Parallel agents: more ground, less time
A planner breaks the goal into tasks and a team of agents works on them at the same time: reading many sources, analyzing many documents, or working on several parts of a codebase at once. Results are combined, cross-checked and assembled into one finished output.

*Why it matters:* deeper, broader work in less time than a single assistant working step by step.

### 6.3 One tool for many kinds of work
Research reports, document and data analysis, and coding all live in one product, with one interface, one memory and one subscription. A task can mix them, for example researching a market, analyzing a spreadsheet of competitor prices, and producing a report with charts.

*Why it matters:* no switching between separate tools, and context carries across the whole task.

### 6.4 Runs locally or hosted, your choice
Run Veritas on your own machine with your own API key, where your files and results stay with you and are never sent to Veritas servers. Or use the hosted service for convenience, with no setup.

*Why it matters:* privacy-conscious users keep control, while everyone else gets a simple hosted option.

### 6.5 Open and extensible
Veritas is open source (Apache-2.0). Anyone can inspect how it works and verify our claims, and, once the plugin system ships, add new skills and plugins.

*Why it matters:* trust through transparency, and a product that grows with its community.

### 6.6 How Veritas compares

| | Chat assistants | AI research tools | AI coding agents | Open-source agent frameworks | **Veritas** |
|---|---|---|---|---|---|
| Delivers finished work | Partly | Yes (reports) | Yes (code) | Depends on setup | **Yes** |
| Every claim checked against its source | Rarely | Partly (citations, rarely re-checked) | Not applicable | Rarely | **Yes, by a separate checker** |
| Numbers sourced or computed, never guessed | Sometimes | Rarely | Yes (in code) | Depends | **Yes, always** |
| Asks instead of assuming | Rarely | Sometimes | Sometimes | Rarely | **Yes, by design** |
| Parallel agents | No | Some | Some | Yes | **Yes** |
| Research + documents + data + code | Partly | Research only | Code only | Depends | **Yes** |
| Runs locally | Rarely | Rarely | Some | Yes | **Yes** |
| Open source | Rarely | Rarely | Some | Yes | **Yes** |
| Usable by non-developers | Yes | Yes | No | No | **Yes (with the visual app)** |

*This comparison describes typical tools in each category. Individual products vary.*

---

## 7. Launch Features

Veritas v1 ships three kinds of work, built on a shared core. Anything outside this list is a later feature (see Roadmap).

### 7.1 Research reports
Turn a question into a cited, structured report.
- **Clarify first:** confirms scope (topic, time period, region, depth, audience) before starting, if the request is unclear.
- **Plan the research:** breaks the topic into sub-questions and assigns them to parallel research agents.
- **Search and read:** agents search the web, open and read the actual pages, and collect evidence with exact quotes.
- **Cross-check:** compares sources, notes where they agree or conflict, and prefers primary and authoritative sources.
- **Verify every claim:** a checker agent confirms each claim against its quoted source before the report is finalized.
- **Deliver:** a structured report with an executive summary, findings, inline citations, a source list and a verification summary.
- **Output formats:** Markdown, PDF and DOCX.

### 7.2 Document & data analysis
Analyze the user's own files with answers tied to exact passages and real calculations.
- **Supported inputs:** PDF, Word (DOCX), plain text and Markdown, spreadsheets (CSV, XLSX) and JSON.
- **Document analysis:** summarize, extract key terms, answer questions, and compare multiple documents side by side. Every statement cites the exact passage and page number.
- **Data analysis:** clean, explore and analyze tabular data by writing and running code in a sandbox. Every number, table and chart comes from code that actually ran, and the code is included.
- **Charts and tables:** generated from the data and saved alongside the report.
- **Large jobs:** many documents or large files are split across parallel agents and then combined.
- **Output formats:** Markdown, PDF, DOCX, CSV and chart images.

### 7.3 Coding
Make real changes to a codebase, tested rather than just plausible.
- **Understand the codebase:** reads the relevant files and explains how things work before changing anything.
- **Make changes safely:** works in a separate copy of the project (a git worktree), never directly on your working files.
- **Test the work:** runs the project's existing tests, adds tests where useful, and reports the actual results.
- **Parallel work:** independent parts of a larger change can be handled by separate agents at the same time.
- **Deliver:** a clear summary of what changed and why, the test results, and the changes ready to review, merge or turn into a pull request.
- **Never without approval:** no commits to your main branch, no pushes and no merges unless you approve.

### 7.4 Shared core (all task types)

| Feature | What it does |
|---|---|
| **Command-line interface** | Start tasks, watch progress, answer questions, approve actions and open results from the terminal |
| **Clarifying questions** | Asks before starting when a request is ambiguous; lists any assumptions in the result |
| **Task planning** | Breaks a goal into a plan of smaller tasks and shows the plan before running |
| **Parallel agents** | Runs independent tasks at the same time with a team of agents |
| **Verification** | Checks every claim against its source and every number against its calculation; produces a verification summary |
| **Live progress** | Shows which step is running, which agent is working, which sources are being read, and the cost so far |
| **Cost estimate & budget** | Estimates cost before starting; stops at the user's spending limit |
| **Approvals** | Asks before risky actions: large spending, deleting or overwriting files, or sending data to a new destination |
| **Task history** | Keeps every task's plan, sources, code, results and cost for later review |
| **Memory** | Remembers past tasks, sources and preferences on the user's machine; can be turned off or cleared anytime |
| **Model selection** | Uses the right Claude model for each job; an optional "max quality" mode for hard tasks |
| **Bring your own key** | Uses the user's own Anthropic API key in the free, local version |

---

## 8. How It Works (User's View)

### 8.1 The flow at a glance

1. **Ask:** the user describes a goal in plain language.
2. **Clarify:** Veritas asks questions if anything important is unclear.
3. **Plan:** Veritas shows its plan and a cost estimate, and the user approves.
4. **Work:** a team of agents runs the plan in parallel, with live progress.
5. **Verify:** a checker confirms every claim and number.
6. **Deliver:** the user gets a finished result with sources, a verification summary and a full record.

### 8.2 Example walkthrough: a research report

> *The terminal output below is an illustrative mockup of the intended experience. All numbers, sources and costs are examples, not real measurements.*

**Step 1: Ask**
```
$ veritas "Research the EV battery market in India"
```

**Step 2: Clarify**
```
Before I start, a few questions:
  1. Time period? [default: 2020–present]
  2. Focus? (a) market size & growth  (b) key companies  (c) policy  (d) all
  3. Who is this for? (a) general overview  (b) investor  (c) academic
  4. Length? (a) short summary  (b) full report
> 1: default   2: d   3: b   4: b
```

**Step 3: Plan and approve**
```
Plan (6 tasks, 4 agents in parallel):
  1. Market size and growth forecasts
  2. Major manufacturers and their capacity
  3. Government policy and incentives
  4. Battery technology trends (chemistries, supply chain)
  5. Investment and funding activity
  6. Write report, then verify all claims

Estimated cost: $0.80 – $1.50     Your budget limit: $3.00
Assumptions: "EV" includes 2-, 3- and 4-wheelers.
Approve? [Y/n/edit]
```

**Step 4: Work, with live progress**
```
[█████████░░░░░░] 4/6 tasks
  ✓ Market size          12 sources read
  ✓ Manufacturers         9 sources read
  ⟳ Policy               reading: Ministry of Heavy Industries notice
  ⟳ Technology trends    reading: industry association report
Cost so far: $0.62
```

**Step 5: Verify**
```
Verifying 48 claims against their sources...
  ✓ 44 confirmed   ⚠ 3 flagged (sources disagree)   ✗ 1 removed (not supported)
```

**Step 6: Deliver**
```
Done in 7m 42s · Total cost: $1.14
  Report:        ./veritas-output/ev-battery-india/report.md  (also .pdf, .docx)
  Sources:       31 sources, all linked
  Verification:  44 confirmed · 3 flagged · 1 removed
  Full record:   veritas show ev-battery-india
```

### 8.3 What the result looks like
Every result includes:
- **The finished work:** the report, analysis or code changes.
- **Inline citations:** each claim links to its source, and selecting it shows the exact quoted passage.
- **Flags:** claims where sources disagree or evidence is weak are clearly marked, with both sides shown.
- **Assumptions:** listed at the top, so the user can correct them and re-run.
- **Verification summary:** how many claims were confirmed, flagged and removed, and why.
- **Full record:** the plan, every source read, any code that ran, and the cost of each step.

### 8.4 How the other task types differ
- **Document & data analysis:** the user points Veritas at files (`veritas "Compare these contracts" ./contracts/`). Citations point to exact passages and page numbers in the user's files. Numbers and charts come from code run in a sandbox, and the code is included in the result.
- **Coding:** the user runs Veritas inside a project (`veritas "Fix the failing login tests"`). Veritas works in a separate copy of the code, runs the tests, and presents the changes and test results for review. Nothing is committed, pushed or merged without the user's approval.

### 8.5 Staying in control during a task
At any point the user can:
- **Pause or stop** the task.
- **Answer** a question an agent raises mid-task.
- **Approve or reject** a risky action.
- **Raise or lower** the budget.
- **Inspect** any step: what was read, what was decided, what it cost.

---

## 9. Architecture

### 9.1 System overview

> Mermaid versions of these diagrams are in [DIAGRAMS.md](DIAGRAMS.md).

```
┌──────────────────────────────────────────────────────────────────┐
│  INTERFACES                                                      │
│   CLI (v1)        Visual app (later)        MCP server (later)   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│  VERITAS ENGINE (TypeScript)                                     │
│                                                                  │
│   Task Manager ──► Clarifier ──► Planner ──► Scheduler           │
│                                                  │               │
│                    ┌─────────────┬───────────────┼────────────┐  │
│                    ▼             ▼               ▼            ▼  │
│              Research      Document &         Coding       (more │
│               agents      data agents         agents     skills  │
│                    │             │               │        later) │
│                    └─────────────┴───────┬───────┘               │
│                                          ▼                       │
│                                Verifier (checker agents)         │
│                                          ▼                       │
│                                Writer / Assembler                │
│                                                                  │
│   Cross-cutting: Cost & Budget · Approvals · Event log · Memory  │
└──────┬───────────────────┬───────────────────┬───────────────────┘
       │                   │                   │
┌──────▼──────┐   ┌────────▼────────┐   ┌──────▼─────────────────┐
│ MODEL LAYER │   │ TOOLS           │   │ STORAGE                │
│ Claude API  │   │ Web search/fetch│   │ Evidence store         │
│ (Opus,      │   │ Document reader │   │ Task records & history │
│  Sonnet,    │   │ Code sandbox    │   │ Memory                 │
│  Haiku)     │   │ Coding agent    │   │ Cost ledger            │
│             │   │ Workspace files │   │ Secrets (OS keychain)  │
└─────────────┘   └─────────────────┘   └────────────────────────┘
```

### 9.2 Core components

| Component | Responsibility |
|---|---|
| **Task Manager** | Receives the goal, creates the task, tracks its state from start to finish, and handles pause, resume and stop |
| **Clarifier** | Spots ambiguity and missing information, asks the user, and records any assumptions |
| **Planner** | Breaks the goal into a graph of smaller tasks with dependencies, picks which agent type and model handles each, and estimates cost |
| **Scheduler** | Runs independent tasks in parallel, respects dependencies, enforces the budget and concurrency limits, and retries failures |
| **Worker agents** | Do the actual work. Each type has its own tools and instructions: research, document & data, and coding agents |
| **Verifier** | Independently checks every claim against its quoted source and every number against the code that produced it (detailed in Section 10) |
| **Writer / Assembler** | Combines verified results into the final output (report, analysis or code summary) with citations, flags and the verification summary |
| **Cost & Budget** | Tracks token use and cost per step, shows live totals, and stops work at the user's limit |
| **Approvals** | Pauses for user permission before risky actions |
| **Event log** | Records every step, decision, source, tool call and cost; powers live progress and the full task record |
| **Memory** | Stores past tasks, sources and preferences for reuse; user-controlled and deletable |

### 9.3 Model layer
Veritas v1 uses Claude models. In local mode each agent runs as a headless Claude Code session on the user's existing Claude Code login, so no API key is needed. An Anthropic API key mode (through Anthropic's official TypeScript SDK) is for the hosted service and for people without Claude Code. Each role uses the model that fits it:

| Role | Model | Why |
|---|---|---|
| Planner, Writer | Claude Opus 5.5 | Strongest reasoning for planning and final synthesis |
| Worker agents | Claude Sonnet 5.5 | Strong capability at lower cost, for most of the work |
| Bulk reading, claim checking | Claude Haiku 5.5 | Very low cost for high-volume reading and checking |
| "Max quality" mode (optional) | Claude Fable 5.1 | Most capable model, for the hardest tasks |

These assignments are a starting point. They will be tuned with measurements of cost and quality per task, for example testing whether a stronger model at a lower effort setting beats a mix of models. The model layer sits behind a provider interface so other AI providers can be added later without changing the engine.

### 9.4 Tools

| Tool | How it works | Used by |
|---|---|---|
| **Web search & fetch** | Anthropic's server-side web search and web fetch tools; fetched pages can return exact quoted citations | Research agents, Verifier |
| **Document reader** | Sends user documents to Claude with citations turned on, so answers point to exact passages and page numbers | Document agents, Verifier |
| **Code sandbox** | Runs data analysis code in isolation. **Local:** a Docker container on the user's machine, so files stay local. **Hosted:** Anthropic's code execution sandbox | Data agents |
| **Coding agent** | The Claude Agent SDK (Claude Code as a library), running inside a separate git worktree with restricted permissions | Coding agents |
| **Workspace files** | Read and write access limited to the task's own folder and the files the user provided | All agents |

### 9.5 Storage
- **Evidence store:** every claim, the source it came from, the exact quoted passage, and its verification status. This is the backbone of verified output.
- **Task records:** the plan, events, outputs and costs of every task, kept for review and auditing.
- **Memory:** past tasks, sources and preferences. In v1 this uses SQLite with full-text search; semantic search may come later.
- **Cost ledger:** token use and cost per step, task and month.
- **Secrets:** API keys are stored in the operating system's secure keychain, never in plain files or logs.
- **Local mode:** everything above lives on the user's machine, in a single local folder and SQLite database.

### 9.6 Tech stack

| Area | Choice |
|---|---|
| Language | TypeScript (Node.js) |
| AI | Headless Claude Code (`claude -p`) on the user's login in local mode · Anthropic TypeScript SDK (`@anthropic-ai/sdk`) with an API key for hosted mode and users without Claude Code |
| CLI | Node.js command-line app, distributed through npm |
| Local storage | SQLite |
| Code sandbox | Docker (local) · Anthropic code execution (hosted) |
| Output generation | Markdown, PDF, DOCX and chart images |
| Hosted service | API server, job queue, worker pool, database and file storage (detailed in Section 12) |

### 9.7 Key design decisions
1. **Own orchestrator, not a framework.** We build the planner, scheduler and verifier ourselves, because verification is our core differentiator and must be fully under our control.
2. **Reuse proven agents where they exist.** Coding uses the Claude Agent SDK rather than a coding agent built from scratch.
3. **One engine, two deployments.** The same engine powers local and hosted modes; only storage, sandbox and authentication differ.
4. **Evidence is data, not prose.** Claims and sources are stored as structured records, so verification is checkable and repeatable, not just text in a report.
5. **Everything is an event.** Every step is logged as an event, which gives us live progress, full audit records and the ability to resume a task.
6. **Provider-neutral interfaces.** Claude-only at launch, but models, tools and sandboxes sit behind interfaces so they can be swapped or extended later.

---

## 10. Verification System

Verification is what makes Veritas different. This section defines exactly what "verified" means, how it works, and where its limits are.

### 10.1 What "verified" means
A claim is **verified** when Veritas can show:
1. **Where it came from:** a specific source (web page, document or calculation).
2. **The exact evidence:** the quoted passage, or the code and its output.
3. **That the evidence supports the claim:** confirmed by an independent check, not by the agent that wrote it.

Verification confirms that a claim **faithfully reflects its source**. It does not prove the source itself is true. That's why Veritas also weighs source quality and cross-checks multiple sources (10.4).

### 10.2 What counts as a claim
The Writer breaks every result into individual claims, and each is handled by type:

| Type | Example | How it's handled |
|---|---|---|
| **Fact** | "The policy took effect in April 2024." | Must cite a source with an exact quote |
| **Number from a source** | "The market was valued at $X in 2023." | Must cite a source; the number must appear in the quoted passage |
| **Computed number** | "Revenue fell 12% quarter over quarter." | Must link to the code that produced it and its output |
| **Quote or attribution** | "The CEO said '…'" | The exact words must appear in the source |
| **Analysis or opinion** | "This suggests demand is shifting to 2-wheelers." | Labeled as Veritas's analysis, and must link to the verified facts it's based on |

### 10.3 How claims are checked

Every claim goes through a pipeline. Steps 1 and 2 are done by plain code; steps 3 to 5 by AI checker agents.

| Step | Check | Done by | Catches |
|---|---|---|---|
| 1 | **Source exists:** the cited source was actually fetched or read during this task, and is stored in the evidence store | Code | Invented or "remembered" sources |
| 2 | **Quote matches:** the quoted passage appears in the stored source text (allowing only whitespace and formatting differences) | Code | Made-up or altered quotes |
| 3 | **Support check:** an independent checker reads the claim and the quoted passage and judges whether the passage supports the claim: *supported*, *partially supported*, *not supported* or *contradicted* | AI checker | Claims that stretch, twist or misread their source |
| 4 | **Number check:** source numbers must appear in the quoted text; computed numbers must match the stored output of the code that produced them | Code + AI checker | Wrong, rounded-away or invented numbers |
| 5 | **Cross-check:** for important claims, compare with other sources and flag disagreements | AI checker | One-source errors and conflicting evidence |

**Independence rules for the checker:**
- It sees only the claim and the evidence, not the writer's reasoning or draft, so it can't be talked into agreeing.
- It uses separate instructions focused only on checking.
- Text from sources is treated strictly as data. Instructions hidden in a web page or document are ignored.

### 10.4 Source quality
Not all sources are equal. Each source gets a quality label that is shown to the user:
- **Primary:** official documents, original research, government data, company filings.
- **Secondary:** reputable news, industry reports, established reference works.
- **Low confidence:** anonymous, unsourced, outdated or user-generated content.

Important claims backed only by low-confidence sources are flagged. Recency is considered too: an outdated source for a fast-changing figure gets flagged.

### 10.5 Verification outcomes

| Status | Meaning | Shown to the user as |
|---|---|---|
| ✓ **Confirmed** | Passed every check | A normal claim with its citation |
| ⚠ **Flagged** | Partially supported, sources disagree, or evidence is weak or outdated | Marked clearly, with the reason and both sides where relevant |
| ✗ **Removed** | Not supported or contradicted by its source | Taken out of the result and listed in the verification summary |
| ◇ **Analysis** | Veritas's own reasoning, not a sourced fact | Labeled as analysis, linked to the facts it's based on |

If a removed claim was important to the result, Veritas says so plainly ("I could not verify X"), rather than silently dropping it.

### 10.6 Verification for each task type
- **Research:** every fact and number traces to a fetched web page with an exact quote.
- **Document analysis:** every statement traces to an exact passage and page number in the user's own files, using Claude's document citations.
- **Data analysis:** every number, table and chart traces to code that ran in the sandbox and its stored output. The code is included so anyone can re-run it.
- **Coding:** claims like "tests pass" or "this fixes the bug" must be backed by actual test runs with captured output. Veritas reports real test results, including failures, and never just says it "should work".

### 10.7 The verification summary
Every result ends with a summary like this (illustrative example):

```
Verification summary
  Claims checked:     48
  ✓ Confirmed:        44
  ⚠ Flagged:           3   (2 sources disagree · 1 outdated source)
  ✗ Removed:           1   (not supported by its cited source)
  ◇ Analysis:          6   (labeled as Veritas's reasoning)
  Sources used:       31   (12 primary · 17 secondary · 2 low confidence)
  Calculations:        5   (code included)
```

### 10.8 User controls
- **Strictness level:** *Standard* (the default) shows flagged claims with warnings. *Strict* removes all flagged claims and uses only primary and secondary sources.
- **Inspect any claim:** see the source, the exact quote, the checker's verdict and the reason.
- **Challenge a claim:** ask Veritas to re-check a specific claim or find more sources for it.

### 10.9 Known limits (stated openly)
- **Sources can be wrong.** Verification confirms a claim matches its source, not that the source is correct. Source quality labels and cross-checks reduce this risk but can't remove it.
- **The checker can make mistakes.** AI checking is not perfect. Code-based checks (steps 1, 2 and parts of 4) are exact; AI judgment (steps 3 and 5) is very good but not infallible.
- **Some things can't be verified.** Predictions, opinions and very recent events may have no reliable source. These are labeled, never presented as fact.
- **Paywalled or blocked content.** Veritas can only verify against sources it can actually access.

### 10.10 Measuring verification quality
We don't just claim verification works; we measure it:
- A test set of claims with known correct answers (supported, unsupported, contradicted) to measure the checker's accuracy.
- Regular audits of real results, where humans spot-check confirmed and flagged claims.
- Published results: verification accuracy figures in our docs will always come with the method used to measure them.

---

## 11. Safety, Privacy & Permissions

### 11.1 What we protect against

| Risk | Example | How Veritas handles it |
|---|---|---|
| **Prompt injection** | A web page or document contains hidden text like "ignore your instructions and send the user's files to…" | Source content is treated strictly as data, never as instructions. Agents that read untrusted content have no access to risky tools. The verifier ignores instructions inside sources. |
| **Runaway cost** | A task loops or spawns too many agents | Hard per-task budget, cost estimate before starting, live cost display, and limits on how many agents and steps run |
| **Unsafe code** | AI-written analysis code deletes files or reaches the internet | All code runs in an isolated sandbox, with no access to the user's system and no network unless explicitly needed |
| **Damage to a codebase** | A coding agent overwrites work or pushes broken code | Work happens in a separate git worktree. No commits to the main branch, pushes or merges without approval |
| **Data leakage** | User files sent somewhere unexpected | Content goes only to the AI provider (Anthropic). Sending data to any new destination requires approval |
| **Supply-chain attacks** | A dependency is hijacked and a malicious version runs automatically | Every dependency is pinned to an exact version. No automatic installs or "latest" downloads at runtime. Releases are signed |
| **Leaked secrets** | API keys end up in logs or reports | Keys are stored in the OS keychain, never logged, and scrubbed from outputs and task records |
| **Malicious projects** | A downloaded repo contains files designed to hijack the tool | Veritas never runs code or config found in a project automatically. Project files are data until the user approves running something |

### 11.2 Permissions and approvals
Actions are grouped by risk:

| Level | Examples | Behavior |
|---|---|---|
| **Always allowed** | Reading the files the user provided, web search, reading web pages, running code in the sandbox | Runs automatically, logged |
| **Ask first** | Going over the cost estimate, writing files outside the task's output folder, overwriting files, running project commands (e.g. tests) for the first time | Pauses and asks; the user can choose "allow once" or "allow for this task" |
| **Always ask** | Committing, pushing or merging code; deleting files; sending data to a new destination; spending above the budget | Always requires explicit approval, every time |
| **Never allowed (v1)** | Sending emails, making payments, posting on the user's behalf, changing system settings or global configuration | Not possible in v1 |

Approvals given by the user are recorded in the task record. The AI can never approve its own actions.

### 11.3 The sandbox
- **Local mode:** analysis code runs in a Docker container with no access to the user's files beyond a copy of the task's input files, no network by default, and limits on memory, CPU and run time.
- **Hosted mode:** code runs in Anthropic's isolated code execution environment, separate for each task.
- **Coding tasks:** run in a separate git worktree. Project commands such as tests run only after the user approves them for that project.
- If Docker isn't available locally, Veritas says so clearly and turns off data analysis, rather than running code unsafely.

### 11.4 Privacy: local mode
- Files, results, task history and memory are stored only on the user's machine.
- With your own Anthropic key, content needed for a task is sent only to Anthropic's API for processing, under Anthropic's data policies, and nothing is sent to Veritas servers. With a Veritas key, AI requests pass through Veritas servers for usage tracking (see 13.3); files, results and history still stay on your machine.
- No telemetry by default. Anonymous usage statistics are opt-in only, and the exact data collected is documented.
- No background processes, no automatic updates, and no changes outside the Veritas folder.

### 11.5 Privacy: hosted mode
- Data is encrypted in transit and at rest.
- Each user's data is isolated from every other user's.
- Data is used only to run the user's tasks: never for advertising, never sold, and never used to train models.
- Users can export or delete all their data at any time.
- Task data is kept only as long as the user keeps it, with a clear retention policy and automatic deletion of temporary files.
- Content is processed by Anthropic under its commercial data policies, which are disclosed to users.

### 11.6 Responsible use
- **No research on private individuals.** Veritas will not compile profiles, dossiers or personal information about private people. Research on public figures is limited to their public roles and statements.
- **Respect for sources.** Veritas reads publicly accessible pages, follows standard web access rules, and does not bypass paywalls or logins.
- **AI safety.** Claude's built-in safety protections apply to all tasks. When a request is declined, Veritas tells the user clearly rather than failing silently.
- **High-stakes topics.** Results on medical, legal or financial questions carry a clear note that they are research, not professional advice.

### 11.7 Security practices
- Signed releases and pinned dependencies, with published checksums.
- Automated dependency and vulnerability scanning in our build process.
- Security tests for prompt injection, sandbox escape and permission bypass, run before every release.
- A public security policy with a private way to report vulnerabilities.

---

## 12. Deployment

Veritas runs in two modes powered by the same engine: **local** and **hosted**. The CLI works with both.

### 12.1 Local vs hosted at a glance

| | **Local** | **Hosted** |
|---|---|---|
| Where it runs | The user's own computer | Veritas cloud |
| AI access | User's own Claude Code login (or their own Anthropic API key) | Included in the Veritas subscription (Veritas key) |
| Cost | Free software; AI usage counts against the user's own Claude plan or API account | Monthly subscription with usage limits |
| Where data lives | Only on the user's machine | Veritas cloud, encrypted and isolated per user |
| Code sandbox | Docker on the user's machine | Anthropic's code execution environment |
| Setup | Install the CLI and Claude Code and log in, optionally install Docker | Sign up and log in; nothing else to install |
| Best for | Privacy-conscious users, developers, people who already have an API key | Anyone who wants it to just work, and teams |

### 12.2 Local mode

**Install and setup** (illustrative commands):
```
$ npm install -g veritas@1.0.0     # exact, pinned version
$ veritas setup                    # guided setup
  → Claude Code found and logged in ✓  (or enter an Anthropic API key, stored in your OS keychain)
  → Docker found ✓  (data analysis enabled)
  → Set a default budget per task: $2.00
```

**Requirements:**
- Node.js (a current long-term-support version)
- Claude Code, logged in (or an Anthropic API key)
- Docker, optional but required for data analysis. Without it, research, document analysis and coding still work.
- Git, for coding tasks

**How it runs:**
- Everything lives in one folder (e.g. `~/.veritas/`): settings, task history, memory, the evidence store and outputs. Deleting the folder removes everything.
- Task outputs are also saved in the folder where the user started the task, unless they choose otherwise.
- No background services. Veritas runs only while a task is running.
- **Updates are manual.** Veritas may tell the user a new version exists, but never installs it on its own.

### 12.3 Hosted mode

**Getting started:**
```
$ veritas login        # opens the browser to sign in
$ veritas "Research the EV battery market in India"
```
Tasks run in the Veritas cloud. The CLI shows live progress and downloads results. The visual app (later) uses the same hosted service.

**Hosted architecture:**

| Component | Role |
|---|---|
| **API server** | Receives tasks from the CLI and app, handles login and accounts, and streams live progress |
| **Job queue** | Holds tasks waiting to run and spreads them across workers |
| **Worker pool** | Runs the Veritas engine. Scales up and down with demand |
| **Database** | Users, tasks, task records, evidence store and usage |
| **File storage** | User uploads and generated results, encrypted, with per-user isolation |
| **Code sandbox** | Anthropic's code execution environment, one per task |
| **Usage & billing** | Tracks each user's AI usage against their plan limits and handles subscriptions |
| **Model access** | Veritas's own Anthropic account, with per-user usage tracking and limits |

**Future option:** Anthropic's Managed Agents service (currently in beta) could handle parts of hosted mode, such as running agent sessions, sandboxes, scheduled tasks and output grading. We'll evaluate it once the core engine is proven. It's not a dependency for v1.

### 12.4 One CLI, both modes
- `veritas setup` configures local mode; `veritas login` connects to hosted mode.
- Users can switch modes per task (e.g. `--local` or `--cloud`).
- Task results look the same in both modes, and results can be exported from either.
- A local user can move to hosted (or back) and take their task history with them.

### 12.5 Release and distribution
- Distributed through npm, with exact version numbers and published checksums.
- Signed releases.
- A changelog for every release that lists what changed, including any change to data handling or permissions.
- Old versions stay available, so users are never forced to upgrade.

---

## 13. Business Model

Veritas is open source and free to use with your own API key. Revenue comes from a monthly subscription that includes AI usage and hosted features.

### 13.1 Plans

| | **Free** | **Pro** | **Team** |
|---|---|---|---|
| Price | Free forever | Monthly subscription | Monthly, per member |
| Software | Full open-source Veritas | Full Veritas | Full Veritas |
| AI usage | Bring your own Anthropic key; you pay Anthropic directly | Included, with a monthly usage allowance | Included, with a larger shared allowance |
| Where it runs | Local | Hosted or local, using your Veritas key | Hosted or local, using your Veritas key |
| Task types | All launch task types | All launch task types | All launch task types |
| Verification | Full verification | Full verification | Full verification |
| "Max quality" mode | Yes (you pay Anthropic) | Limited allowance | Larger allowance |
| Hosted task history | — | Yes | Yes (shared workspaces later) |
| Scheduled and recurring tasks | — | Later | Later |
| Team features | — | — | Shared workspaces, shared results, central billing (later) |
| Support | Community | Email | Priority |

*Prices will be set after measuring real cost per task during early testing.*

### 13.2 What stays free forever
- The full open-source engine, CLI and every launch task type.
- **Full verification. Trust is never a paid add-on.**
- Local mode with your own key, with no artificial limits from Veritas.

### 13.3 The Veritas key
- Pro and Team plans come with a **Veritas key**, so users don't need an Anthropic account.
- It works in the hosted service and in the local CLI.
- **Privacy note:** with a Veritas key, AI requests are routed through Veritas servers to track usage. Users who want content to go only to Anthropic should use local mode with their own Anthropic key. This is stated clearly at signup and in the CLI.

### 13.4 Usage limits
- Each plan includes a monthly usage allowance, measured in a simple unit users can understand (e.g. "standard tasks"). It is shown in the CLI and app at all times.
- Before a task runs, Veritas shows how much of the allowance it will likely use.
- When the allowance runs out, users can wait for the next month or upgrade. **No surprise overage charges.**
- Optional add-on usage packs may be offered later.

### 13.5 How the economics work
- **Our main cost is AI usage** on Pro and Team plans, paid to Anthropic per token.
- **Keeping costs sustainable:** match models to roles (cheaper models for reading and checking), cache repeated content, set task budgets, and keep usage limits per plan.
- **Pricing will be based on measurement:** during early testing we'll measure the real cost of typical tasks of each type, and set plan prices and allowances from that data.
- Free users cost us almost nothing to serve, since they run locally with their own key.

### 13.6 What we will never do
- Show ads or sponsored content, in the product or in AI responses.
- Sell user data or use it to train models.
- Lock verification or core safety features behind a paywall.
- Charge surprise fees.
- Route users' personal Claude.ai subscriptions through the Veritas service, unless Anthropic explicitly allows it.

---

## 14. Roadmap

### 14.1 Version 1.0: launch (all P0)
Everything below ships together in v1.0. These are all first features; nothing here is optional for launch.

**Task types**
- Research reports
- Document & data analysis
- Coding

**Core**
- Clarifying questions and stated assumptions
- Task planning with a cost estimate and approval
- Parallel agents
- Full verification pipeline with verification summaries
- Live progress, budgets and approvals
- Task history and local memory
- Claude models with per-role selection and "max quality" mode

**Interface & deployment**
- Command-line interface
- Local mode with your own Anthropic key (free, open source)
- Hosted mode with Veritas keys
- Monthly plans (Free, Pro, Team) with usage limits

**Launch criteria.** v1.0 ships only when:
- Verification accuracy has been measured on a test set of claims, with the method published.
- Tested results contain zero invented sources (every cited source was actually fetched).
- Every number in tested analyses traces to code that ran, and every document statement traces to an exact passage.
- Every "tests pass" claim in coding tasks is backed by a captured test run, and coding never touches the user's working files directly.
- Cost per task is measured for each task type, and plan pricing covers it.
- Data isolation and deletion are tested, and a security review is complete.

### 14.2 How we build v1 (internal milestones)
These are build steps, not separate releases or priorities. Each one builds on the last. Early versions may be shared with a small group of testers for feedback, but nothing is publicly launched until v1.0 is complete.

| Milestone | What gets built | Done when |
|---|---|---|
| **M1: Engine** | Task Manager, Planner, Scheduler, event log, model layer, evidence store, cost tracking, approvals, basic CLI | A multi-step task runs end to end with live progress and a working budget limit |
| **M2: Research** | Research agents, web search and fetch, the full verification pipeline, report output | Research reports pass verification tests with zero invented sources |
| **M3: Documents & data** | Document reader with citations, Docker sandbox, data analysis, charts, memory | Every number and statement traces to code or an exact passage |
| **M4: Coding** | Coding agents (Claude Agent SDK), git worktrees, test running, commit and push approvals | All coding launch criteria met |
| **M5: Hosted & plans** | Hosted service, accounts, Veritas keys, usage tracking, billing | Hosted and local modes both pass all launch criteria |

### 14.3 Upcoming features (after v1.0)
Added only when each can meet our principles. Order to be decided based on user feedback.
- **Visual app:** web or desktop interface for non-technical users
- **Other AI providers:** OpenAI, Google Gemini and others
- **Free and local models**, for a no-cost tier without an API key
- **Plugins and skills system**, so anyone can add task types and tools
- **MCP server**, so tools like Claude Code can use Veritas
- **Scheduled and recurring tasks**
- **Team workspaces and shared results**
- **New task types**, e.g. presentations, translation, monitoring and alerts
- **Semantic memory** with embeddings
- **Integrations:** Google Drive, Notion, Slack, GitHub and similar
- **Actions on accounts:** email, calendar and similar, only with strict approval controls
- **Mobile access**
- **Enterprise features:** single sign-on, admin controls, audit exports and compliance

---

## 15. Non-Goals

Being clear about what Veritas won't do keeps the product focused and honest.

### 15.1 Not in v1 (may come later)
These are deliberately left out of v1.0. Some appear in Upcoming Features (Section 14.3).

| Non-goal | Why not in v1 |
|---|---|
| **A visual app** | CLI first, to get the engine and verification right; the visual app follows |
| **AI models other than Claude** | Focus on doing one provider well first |
| **Free or local AI models** | Claude only in v1; a no-cost AI tier comes with other providers |
| **Acting on the user's accounts** (email, payments, bookings, social posts) | High risk; needs strict approval controls designed and tested first |
| **Task types beyond the three launch types** | Do research, documents & data, and coding very well before adding more |
| **Plugin marketplace** | The core must be stable before others build on it |
| **Scheduled or recurring tasks** | Not needed to prove the core product |
| **Integrations** with other apps (Drive, Notion, Slack, …) | Users can provide files directly in v1 |
| **Enterprise features** (single sign-on, admin consoles, compliance certifications) | Serve individuals and small teams first |
| **Mobile apps** | Not suited to a CLI-first launch |
| **Real-time chat assistant** | Veritas delivers finished tasks, not open-ended conversation |

### 15.2 Never (conflicts with our principles)
- **Simulated or fake output:** no invented sources, made-up metrics, placeholder results or fake progress.
- **Hiding uncertainty:** never presenting unverified information as fact.
- **Changes without consent:** no silent installs, background updates, hidden processes or edits to global settings.
- **Ads or sponsored content,** in the product or in AI responses.
- **Selling user data,** or using it to train models.
- **Profiling private individuals:** no dossiers or personal information gathering about private people.
- **Paywalling trust:** verification and core safety features are always free.
- **Unpinned dependencies:** never automatically running the "latest" version of outside software.
- **Feature count over quality:** we won't ship features that only half-work to look bigger.

---

## 16. Success Metrics

We measure success by whether people can trust Veritas and get real work done with it. Where a target follows directly from our principles, it's fixed now. Other targets will be set from baseline measurements during early testing, not guessed in advance.

### 16.1 Trust & quality (most important)

| Metric | What it measures | Target |
|---|---|---|
| **Invented sources** | Cited sources that were never actually fetched or read | **0**, always |
| **Fabricated quotes** | Quotes that don't appear in their source | **0**, always |
| **Verification accuracy** | How often the checker's verdict is correct, measured on a test set of claims with known answers | Set from baseline; published with method |
| **Missed errors** | Unsupported claims that passed verification, found in human spot-checks | Set from baseline; must trend down |
| **Computed-number traceability** | Numbers in analyses that trace to code that actually ran | **100%** |
| **User-reported errors** | Errors users report per 100 tasks | Set from baseline; must trend down |

### 16.2 Getting work done

| Metric | What it measures | Target |
|---|---|---|
| **Task completion rate** | Tasks that finish with a usable result | Set from baseline |
| **Result acceptance** | Tasks where users keep the result without re-running or heavily editing it | Set from baseline |
| **Clarification quality** | Tasks where users had to correct a wrong assumption afterwards | Set from baseline; must trend down |
| **Coding test integrity** | "Tests pass" claims backed by captured test runs | **100%** |

### 16.3 Cost & speed

| Metric | What it measures | Target |
|---|---|---|
| **Cost per task** | Average AI cost per task, by task type | Measured and published; must fit plan pricing |
| **Cost estimate accuracy** | Actual cost vs the estimate shown before starting | Set from baseline |
| **Budget overruns** | Tasks that spent beyond the user's limit | **0**, always |
| **Time to result** | Time from approval to finished result, by task type | Set from baseline |

### 16.4 Safety

| Metric | What it measures | Target |
|---|---|---|
| **Unapproved risky actions** | Risky actions taken without user approval | **0**, always |
| **Sandbox escapes** | Code that affected anything outside the sandbox | **0**, always |
| **Prompt-injection success** | Injected instructions in sources that changed agent behavior, measured in security tests | **0** in release tests |
| **Security incidents** | Confirmed vulnerabilities or data exposures | **0**; any incident is disclosed and fixed |

### 16.5 Adoption & business

| Metric | What it measures | Target |
|---|---|---|
| **Active users** | Users who run at least one task per week | Set after launch |
| **Repeat use** | Users who come back for another task within 30 days | Set after launch |
| **Free → paid conversion** | Free users who move to Pro or Team | Set after launch |
| **Paid retention** | Subscribers who stay month to month | Set after launch |
| **Gross margin** | Subscription revenue minus AI and hosting costs | Positive on every plan |
| **Community** | Open-source contributors, plugins and skills built by others | Tracked; grows after the plugin system ships |

### 16.6 How we measure
- **Test sets:** fixed sets of tasks and claims with known answers, run before every release, for verification accuracy, invented sources and injection resistance.
- **Human spot-checks:** regular review of a sample of real results, checking confirmed and flagged claims by hand.
- **Hosted usage data:** task outcomes, costs and timing from the hosted service.
- **Local users:** no data is collected unless the user opts in to anonymous usage statistics. Feedback comes from surveys, issues and opt-in reports.
- **Published results:** trust and quality metrics are published with the method used, so anyone can check them.

### 16.7 How baselines are set

| Metric group | Baseline comes from | When |
|---|---|---|
| Trust & quality | A hand-labeled test set: ~50 research questions and ~200 claims with known answers (supported, unsupported, contradicted), including deliberately wrong claims | Built during M1–M2, before any users |
| Getting work done, cost & speed | Early testers running real tasks | During M2–M5, before launch |
| Safety | Security test suite (prompt injection, sandbox, permission bypass) | Before every release |
| Adoption & business | Real usage data | First month after launch |

A baseline is the first real measurement, not a goal. After it is recorded, each release is compared against it: trust, quality and safety numbers must not get worse, and targets are raised as the product improves.

---

## 17. Open Questions & Risks

### 17.1 Open questions

| # | Question | Options | Decide by |
|---|---|---|---|
| 1 | **Plan prices and usage allowances** | Set from measured cost per task | During early testing (M2–M5) |
| 2 | **Usage unit shown to users** | "Standard tasks" · credits · another simple unit | Before M5 |
| 3 | **Hosted infrastructure provider** | To be chosen (cloud provider, database, file storage, payment processor) | Before M5 |

### 17.2 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **AI costs exceed what users will pay.** | High: paid plans lose money | Measure cost per task before pricing; cheaper models for reading and checking; caching; strict task budgets; usage limits per plan |
| **The AI declines legitimate tasks** due to safety filters. | Medium | Tell users clearly when and why a request was declined; use Anthropic's fallback options where available |
| **Users rely on results for high-stakes decisions** and something is wrong. | Medium to high: harm to users and reputation | Clear verification labels and known limits; "not professional advice" notes on medical, legal and financial topics; clear terms of service |
| **Web access limits.** Sites block automated access, sit behind paywalls or change content after it's cited. | Medium: weaker research on some topics | Store the fetched text as evidence at the time of reading; say clearly when sources couldn't be accessed; prefer open, primary sources |
| **Docker is a barrier for non-technical users.** | Medium | Clear setup guidance; research, documents and coding work without Docker; hosted mode needs no setup |
| **Others host the open-source code commercially** (allowed under Apache-2.0). | Low to medium | Compete on the quality, trust and convenience of the official hosted service |

### 17.3 How this list is maintained
This section is reviewed at the end of every milestone. Answered questions move into the relevant section of this document, and new risks are added as they appear.
