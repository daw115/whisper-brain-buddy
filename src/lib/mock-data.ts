export interface Meeting {
  id: string;
  title: string;
  date: string;
  duration: string;
  participants: string[];
  status: "processed" | "processing" | "recorded";
  tags: string[];
  summary?: string;
  actionItems?: ActionItem[];
  decisions?: Decision[];
  transcript?: TranscriptLine[];
}

export interface ActionItem {
  id: string;
  task: string;
  owner: string;
  deadline: string;
  completed: boolean;
}

export interface Decision {
  id: string;
  decision: string;
  rationale: string;
  timestamp: string;
}

export interface TranscriptLine {
  timestamp: string;
  speaker: string;
  text: string;
}

export const mockMeetings: Meeting[] = [
  {
    id: "mtg-001",
    title: "Transformer Architecture Review",
    date: "2026-03-14",
    duration: "47:23",
    participants: ["Dawid", "Elena", "Marcus", "Priya"],
    status: "processed",
    tags: ["architecture", "transformer", "v2-migration"],
    summary: "Team reviewed the current transformer architecture and identified latency bottlenecks in the attention layer. Decision made to shift API to v2 due to v1 latency exceeding 400ms in 12% of requests. Dawid assigned to prepare the model update by Friday.",
    actionItems: [
      { id: "ai-1", task: "Prepare transformer model update for v2 API", owner: "Dawid", deadline: "2026-03-20", completed: false },
      { id: "ai-2", task: "Run latency benchmarks on staging", owner: "Elena", deadline: "2026-03-18", completed: false },
      { id: "ai-3", task: "Update API documentation for v2 endpoints", owner: "Marcus", deadline: "2026-03-21", completed: true },
      { id: "ai-4", task: "Review attention layer optimization paper", owner: "Priya", deadline: "2026-03-19", completed: false },
    ],
    decisions: [
      { id: "d-1", decision: "Shift API to v2", rationale: "v1 latency exceeded 400ms in 12% of requests. Migration reduces average latency by 65%.", timestamp: "00:12:45" },
      { id: "d-2", decision: "Use sliding window attention for long sequences", rationale: "Full attention O(n²) cost is prohibitive for sequences >4096 tokens.", timestamp: "00:28:10" },
    ],
    transcript: [
      { timestamp: "00:00:12", speaker: "Dawid", text: "Let's start with the current state of the transformer pipeline. I've been seeing some concerning latency numbers." },
      { timestamp: "00:00:45", speaker: "Elena", text: "Yes, the P99 latency on the attention layer has been climbing. We're at 420ms now for sequences over 2048 tokens." },
      { timestamp: "00:01:23", speaker: "Marcus", text: "That's above our SLA. We committed to sub-300ms for enterprise clients." },
      { timestamp: "00:02:15", speaker: "Dawid", text: "We need to finish the transformer analysis before Friday. I think the v2 API with sliding window attention is the path forward." },
      { timestamp: "00:03:02", speaker: "Priya", text: "I found a paper on linear attention that could help. The complexity drops to O(n) but there's a quality tradeoff." },
      { timestamp: "00:04:18", speaker: "Elena", text: "Let's benchmark both approaches on staging. I can have numbers by Wednesday." },
      { timestamp: "00:05:30", speaker: "Dawid", text: "Good. Marcus, can you start on the v2 API documentation? We'll need it ready for the client review." },
      { timestamp: "00:06:12", speaker: "Marcus", text: "Already started a draft. I'll have it polished by Thursday." },
      { timestamp: "00:12:45", speaker: "Dawid", text: "Alright, decision made. We're going with v2. The latency numbers on v1 are not sustainable." },
      { timestamp: "00:28:10", speaker: "Priya", text: "For the sliding window approach, I recommend a window size of 512 tokens with a stride of 256." },
    ],
  },
  {
    id: "mtg-002",
    title: "Sprint Planning — Week 12",
    date: "2026-03-13",
    duration: "32:10",
    participants: ["Dawid", "Elena", "Sarah"],
    status: "processed",
    tags: ["sprint", "planning", "week-12"],
    summary: "Sprint 12 planning session. Prioritized v2 API migration tasks and bug fixes. Velocity target set at 34 story points.",
    actionItems: [
      { id: "ai-5", task: "Create JIRA tickets for v2 migration", owner: "Sarah", deadline: "2026-03-14", completed: true },
      { id: "ai-6", task: "Set up CI/CD pipeline for v2 branch", owner: "Elena", deadline: "2026-03-16", completed: false },
    ],
    decisions: [
      { id: "d-3", decision: "Target 34 story points for Sprint 12", rationale: "Based on team velocity average of last 3 sprints (31, 35, 36).", timestamp: "00:08:20" },
    ],
  },
  {
    id: "mtg-003",
    title: "Infrastructure Cost Review",
    date: "2026-03-12",
    duration: "25:48",
    participants: ["Marcus", "Priya", "James"],
    status: "processed",
    tags: ["infrastructure", "cost", "optimization"],
    summary: "Reviewed cloud infrastructure costs. GPU compute spend increased 40% MoM. Decision to migrate batch inference to spot instances.",
    actionItems: [
      { id: "ai-7", task: "Migrate batch inference to spot instances", owner: "James", deadline: "2026-03-22", completed: false },
    ],
    decisions: [
      { id: "d-4", decision: "Use spot instances for batch inference", rationale: "Estimated 60% cost reduction with acceptable 5% interruption rate.", timestamp: "00:15:30" },
    ],
  },
  {
    id: "mtg-004",
    title: "Client Demo Preparation",
    date: "2026-03-11",
    duration: "18:55",
    participants: ["Dawid", "Sarah"],
    status: "processed",
    tags: ["client", "demo"],
    summary: "Prepared demo flow for enterprise client presentation. Focused on real-time inference capabilities and API integration.",
  },
  {
    id: "mtg-005",
    title: "Data Pipeline Sync",
    date: "2026-03-16",
    duration: "—",
    participants: ["Elena", "James"],
    status: "processing",
    tags: ["data", "pipeline"],
  },
];

export const chatMessages = [
  { role: "user" as const, content: "What decisions were made about transformer parameters?" },
  { role: "assistant" as const, content: "Based on the **Transformer Architecture Review** (2026-03-14), two key decisions were made:\n\n1. **Shift API to v2** — v1 latency exceeded 400ms in 12% of requests. The migration is expected to reduce average latency by 65%.\n\n2. **Use sliding window attention** for long sequences — Full attention O(n²) cost was deemed prohibitive for sequences >4096 tokens. Recommended window size: 512 tokens with stride of 256.\n\n*Source: mtg-001, timestamps 00:12:45 and 00:28:10*" },
];
