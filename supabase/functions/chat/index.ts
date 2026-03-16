import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Mock meeting knowledge base for RAG context
const meetingKnowledge = `
You are Cerebro, an AI meeting intelligence assistant. You have access to the following meeting knowledge base.
Answer questions ONLY based on this data. Cite meeting titles and timestamps when possible. If you can't find relevant info, say so.

MEETING DATABASE:

## Meeting: Transformer Architecture Review (2026-03-14, 47:23)
Participants: Dawid, Elena, Marcus, Priya
Tags: architecture, transformer, v2-migration

Transcript highlights:
[00:00:12] Dawid: Let's start with the current state of the transformer pipeline. I've been seeing some concerning latency numbers.
[00:00:45] Elena: Yes, the P99 latency on the attention layer has been climbing. We're at 420ms now for sequences over 2048 tokens.
[00:01:23] Marcus: That's above our SLA. We committed to sub-300ms for enterprise clients.
[00:02:15] Dawid: We need to finish the transformer analysis before Friday. I think the v2 API with sliding window attention is the path forward.
[00:03:02] Priya: I found a paper on linear attention that could help. The complexity drops to O(n) but there's a quality tradeoff.
[00:04:18] Elena: Let's benchmark both approaches on staging. I can have numbers by Wednesday.
[00:12:45] Dawid: Alright, decision made. We're going with v2. The latency numbers on v1 are not sustainable.
[00:28:10] Priya: For the sliding window approach, I recommend a window size of 512 tokens with a stride of 256.

Decisions:
- Shift API to v2: v1 latency exceeded 400ms in 12% of requests. Migration reduces average latency by 65%.
- Use sliding window attention for long sequences: Full attention O(n²) cost is prohibitive for sequences >4096 tokens.

Action Items:
- Dawid: Prepare transformer model update for v2 API (due 2026-03-20)
- Elena: Run latency benchmarks on staging (due 2026-03-18)
- Marcus: Update API documentation for v2 endpoints (due 2026-03-21, COMPLETED)
- Priya: Review attention layer optimization paper (due 2026-03-19)

## Meeting: Sprint Planning — Week 12 (2026-03-13, 32:10)
Participants: Dawid, Elena, Sarah
Tags: sprint, planning, week-12

Summary: Sprint 12 planning session. Prioritized v2 API migration tasks and bug fixes. Velocity target set at 34 story points.

Decisions:
- Target 34 story points for Sprint 12 (based on team velocity average of last 3 sprints: 31, 35, 36).

Action Items:
- Sarah: Create JIRA tickets for v2 migration (due 2026-03-14, COMPLETED)
- Elena: Set up CI/CD pipeline for v2 branch (due 2026-03-16)

## Meeting: Infrastructure Cost Review (2026-03-12, 25:48)
Participants: Marcus, Priya, James
Tags: infrastructure, cost, optimization

Summary: Reviewed cloud infrastructure costs. GPU compute spend increased 40% MoM. Decision to migrate batch inference to spot instances.

Decisions:
- Use spot instances for batch inference: Estimated 60% cost reduction with acceptable 5% interruption rate.

Action Items:
- James: Migrate batch inference to spot instances (due 2026-03-22)

## Meeting: Client Demo Preparation (2026-03-11, 18:55)
Participants: Dawid, Sarah
Tags: client, demo

Summary: Prepared demo flow for enterprise client presentation. Focused on real-time inference capabilities and API integration.

## Meeting: Data Pipeline Sync (2026-03-16)
Participants: Elena, James
Tags: data, pipeline
Status: Currently processing — transcript not yet available.
`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: meetingKnowledge },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage credits exhausted. Please add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
