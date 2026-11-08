# Veritas — Diagrams

Mermaid source for Veritas diagrams. Paste any block into https://mermaid.live to view or export as PNG/SVG. GitHub renders these automatically.

**Colour key (used across diagrams):** blue = interfaces · indigo = engine · green = worker agents / confirmed · amber = verification / flagged · purple = writer / analysis · orange = AI models · teal = tools · slate = storage · red = removed.

---

## 1. System Architecture

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#64748B"}}}%%
flowchart TB
    subgraph UI["🖥️ Interfaces"]
        CLI["CLI (v1)"]
        APP["Visual app (later)"]
        MCP["MCP server (later)"]
    end

    subgraph ENGINE["⚙️ Veritas Engine (TypeScript)"]
        TM["Task Manager"] --> CL["Clarifier"]
        CL --> PL["Planner"]
        PL --> SC["Scheduler"]

        SC --> RA["🔎 Research agents"]
        SC --> DA["📄 Document & data agents"]
        SC --> CA["💻 Coding agents"]
        SC -.-> MS["More skills (later)"]

        RA --> VE["✅ Verifier (checker agents)"]
        DA --> VE
        CA --> VE
        VE --> WR["✍️ Writer / Assembler"]

        subgraph CROSS["Cross-cutting"]
            CB["Cost & Budget"]
            AP["Approvals"]
            EL["Event log"]
            ME["Memory"]
        end
    end

    subgraph MODELS["🧠 Model layer: Claude API"]
        OP["Opus 5.5: planner, writer"]
        SN["Sonnet 5.5: workers"]
        HK["Haiku 5.5: reading, checking"]
        FB["Fable 5.1: max quality (optional)"]
    end

    subgraph TOOLS["🧰 Tools"]
        WS["Web search & fetch"]
        DR["Document reader (citations)"]
        SB["Code sandbox (Docker local / Anthropic hosted)"]
        AG["Coding agent (Claude Agent SDK + git worktree)"]
        WF["Workspace files"]
    end

    subgraph STORE["🗄️ Storage"]
        EV["Evidence store"]
        TR["Task records & history"]
        MEM["Memory (SQLite)"]
        LG["Cost ledger"]
        SK["Secrets (OS keychain)"]
    end

    CLI --> TM
    APP -.-> TM
    MCP -.-> TM

    ENGINE --> MODELS
    ENGINE --> TOOLS
    ENGINE --> STORE

    classDef iface fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#1E3A8A
    classDef later fill:#F8FAFC,stroke:#94A3B8,stroke-width:1px,stroke-dasharray:4 3,color:#64748B
    classDef core fill:#E0E7FF,stroke:#4F46E5,stroke-width:2px,color:#312E81
    classDef worker fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#14532D
    classDef verify fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#78350F
    classDef writer fill:#F3E8FF,stroke:#9333EA,stroke-width:2px,color:#581C87
    classDef cross fill:#F1F5F9,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef model fill:#FFEDD5,stroke:#EA580C,stroke-width:2px,color:#7C2D12
    classDef tool fill:#CCFBF1,stroke:#0D9488,stroke-width:2px,color:#134E4A
    classDef store fill:#E2E8F0,stroke:#475569,stroke-width:2px,color:#0F172A

    class CLI iface
    class APP,MCP,MS later
    class TM,CL,PL,SC core
    class RA,DA,CA worker
    class VE verify
    class WR writer
    class CB,AP,EL,ME cross
    class OP,SN,HK,FB model
    class WS,DR,SB,AG,WF tool
    class EV,TR,MEM,LG,SK store

    style UI fill:#EFF6FF,stroke:#93C5FD,stroke-width:2px,color:#1E3A8A
    style ENGINE fill:#EEF2FF,stroke:#A5B4FC,stroke-width:2px,color:#312E81
    style CROSS fill:#FFFFFF,stroke:#CBD5E1,stroke-width:1px,color:#334155
    style MODELS fill:#FFF7ED,stroke:#FDBA74,stroke-width:2px,color:#7C2D12
    style TOOLS fill:#F0FDFA,stroke:#5EEAD4,stroke-width:2px,color:#134E4A
    style STORE fill:#F8FAFC,stroke:#94A3B8,stroke-width:2px,color:#0F172A
```

---

## 2. Task Flow (one task, start to finish)

```mermaid
%%{init: {"theme": "base", "themeVariables": {"actorBkg": "#E0E7FF", "actorBorder": "#4F46E5", "actorTextColor": "#312E81", "actorLineColor": "#A5B4FC", "signalColor": "#334155", "signalTextColor": "#0F172A", "labelBoxBkgColor": "#FEF3C7", "labelBoxBorderColor": "#D97706", "labelTextColor": "#78350F", "loopTextColor": "#78350F"}}}%%
sequenceDiagram
    box rgb(219, 234, 254) You
        actor U as User
    end
    box rgb(238, 242, 255) Veritas
        participant V as Veritas CLI
        participant P as Planner
        participant W as Worker agents
        participant C as Verifier
        participant A as Writer
    end

    U->>V: Describe goal
    V->>U: Clarifying questions
    U->>V: Answers
    V->>P: Goal + answers
    P->>V: Plan + cost estimate
    V->>U: Show plan and estimate
    U->>V: Approve
    rect rgb(220, 252, 231)
        par Parallel work
            V->>W: Task 1
            V->>W: Task 2
            V->>W: Task N
        end
    end
    W->>C: Findings + sources + quotes
    rect rgb(254, 243, 199)
        C->>C: Check every claim and number
    end
    C->>A: Verified findings + flags
    A->>V: Finished result + verification summary
    V->>U: Deliver result and full record
```

---

## 3. Verification Pipeline (one claim)

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#64748B"}}}%%
flowchart TB
    CLAIM["✍️ Claim from Writer"] --> TYPE{"Claim type?"}

    TYPE -->|"Analysis / opinion"| AN["◇ Labeled as analysis<br/>linked to supporting facts"]
    TYPE -->|"Fact / quote / number"| S1

    S1["Step 1: Source exists?<br/>(code)"] -->|No| RM["✗ Removed"]
    S1 -->|Yes| S2["Step 2: Quote matches source text?<br/>(code)"]
    S2 -->|No| RM
    S2 -->|Yes| S3["Step 3: Does the quote support the claim?<br/>(independent AI checker)"]
    S3 -->|"Not supported / contradicted"| RM
    S3 -->|"Partially supported"| FL["⚠ Flagged"]
    S3 -->|Supported| S4["Step 4: Numbers match source or code output?<br/>(code + AI checker)"]
    S4 -->|No| RM
    S4 -->|Yes| S5["Step 5: Cross-check other sources<br/>+ source quality"]
    S5 -->|"Sources disagree / weak or outdated"| FL
    S5 -->|Consistent| OK["✓ Confirmed"]

    OK --> SUM["📋 Verification summary"]
    FL --> SUM
    RM --> SUM
    AN --> SUM

    classDef start fill:#F3E8FF,stroke:#9333EA,stroke-width:2px,color:#581C87
    classDef decision fill:#E0E7FF,stroke:#4F46E5,stroke-width:2px,color:#312E81
    classDef codecheck fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#1E3A8A
    classDef aicheck fill:#CCFBF1,stroke:#0D9488,stroke-width:2px,color:#134E4A
    classDef confirmed fill:#DCFCE7,stroke:#16A34A,stroke-width:3px,color:#14532D
    classDef flagged fill:#FEF3C7,stroke:#D97706,stroke-width:3px,color:#78350F
    classDef removed fill:#FEE2E2,stroke:#DC2626,stroke-width:3px,color:#7F1D1D
    classDef analysis fill:#FCE7F3,stroke:#DB2777,stroke-width:2px,color:#831843
    classDef summary fill:#1E293B,stroke:#0F172A,stroke-width:2px,color:#FFFFFF

    class CLAIM start
    class TYPE decision
    class S1,S2 codecheck
    class S3,S4,S5 aicheck
    class OK confirmed
    class FL flagged
    class RM removed
    class AN analysis
    class SUM summary
```

*Blue = checked by plain code · teal = checked by an AI checker.*

---

## 4. Example Walkthrough: Research Report (Section 8.2)

> Illustrative only. The numbers, sources and costs are examples, not real measurements.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#64748B"}}}%%
flowchart TB
    subgraph S1["Step 1: Ask"]
        A1["veritas #quot;Research the EV battery market in India#quot;"]
    end

    subgraph S2["Step 2: Clarify"]
        C1["Time period: 2020–present (default)"]
        C2["Focus: all"]
        C3["Audience: investor"]
        C4["Length: full report"]
    end

    subgraph S3["Step 3: Plan and approve"]
        P0["Plan: 6 tasks, 4 agents in parallel<br/>Estimate: $0.80 – $1.50 · Budget: $3.00<br/>Assumption: EV = 2-, 3- and 4-wheelers"]
        P1{"User approves?"}
        P0 --> P1
    end

    subgraph S4["Step 4: Work in parallel"]
        T1["Task 1: Market size & growth<br/>12 sources"]
        T2["Task 2: Manufacturers & capacity<br/>9 sources"]
        T3["Task 3: Policy & incentives"]
        T4["Task 4: Technology trends"]
        T5["Task 5: Investment & funding"]
    end

    subgraph S5["Step 5: Write and verify"]
        W["Task 6: Write report"]
        V["Verify 48 claims"]
        W --> V
        V --> OK["✓ 44 confirmed"]
        V --> FL["⚠ 3 flagged<br/>(sources disagree)"]
        V --> RM["✗ 1 removed<br/>(not supported)"]
    end

    subgraph S6["Step 6: Deliver"]
        D["Done in 7m 42s · Total cost $1.14<br/>report.md / .pdf / .docx<br/>31 sources, all linked<br/>Full record: veritas show ev-battery-india"]
    end

    A1 --> C1 & C2 & C3 & C4
    C1 & C2 & C3 & C4 --> P0
    P1 -->|"Edit"| P0
    P1 -->|"Yes"| T1 & T2 & T3 & T4 & T5
    T1 & T2 & T3 & T4 & T5 --> W
    OK & FL & RM --> D

    classDef ask fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#1E3A8A
    classDef clarify fill:#E0E7FF,stroke:#4F46E5,stroke-width:2px,color:#312E81
    classDef plan fill:#F3E8FF,stroke:#9333EA,stroke-width:2px,color:#581C87
    classDef work fill:#CCFBF1,stroke:#0D9488,stroke-width:2px,color:#134E4A
    classDef write fill:#FFEDD5,stroke:#EA580C,stroke-width:2px,color:#7C2D12
    classDef confirmed fill:#DCFCE7,stroke:#16A34A,stroke-width:3px,color:#14532D
    classDef flagged fill:#FEF3C7,stroke:#D97706,stroke-width:3px,color:#78350F
    classDef removed fill:#FEE2E2,stroke:#DC2626,stroke-width:3px,color:#7F1D1D
    classDef deliver fill:#1E293B,stroke:#0F172A,stroke-width:2px,color:#FFFFFF

    class A1 ask
    class C1,C2,C3,C4 clarify
    class P0,P1 plan
    class T1,T2,T3,T4,T5 work
    class W,V write
    class OK confirmed
    class FL flagged
    class RM removed
    class D deliver

    style S1 fill:#EFF6FF,stroke:#93C5FD,stroke-width:2px,color:#1E3A8A
    style S2 fill:#EEF2FF,stroke:#A5B4FC,stroke-width:2px,color:#312E81
    style S3 fill:#FAF5FF,stroke:#D8B4FE,stroke-width:2px,color:#581C87
    style S4 fill:#F0FDFA,stroke:#5EEAD4,stroke-width:2px,color:#134E4A
    style S5 fill:#FFF7ED,stroke:#FDBA74,stroke-width:2px,color:#7C2D12
    style S6 fill:#F8FAFC,stroke:#94A3B8,stroke-width:2px,color:#0F172A
```

---

## 5. Example Verification Results (Section 8.2)

> Illustrative only.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"pie1": "#22C55E", "pie2": "#F59E0B", "pie3": "#EF4444", "pieOpacity": "1", "pieStrokeColor": "#FFFFFF", "pieStrokeWidth": "3px", "pieOuterStrokeColor": "#E2E8F0", "pieOuterStrokeWidth": "2px", "pieSectionTextColor": "#FFFFFF", "pieSectionTextSize": "16px", "pieTitleTextSize": "20px", "pieTitleTextColor": "#0F172A", "pieLegendTextColor": "#0F172A", "pieLegendTextSize": "15px"}}}%%
pie showData
    title Verification of 48 claims (example)
    "Confirmed" : 44
    "Flagged (sources disagree)" : 3
    "Removed (not supported)" : 1
```
