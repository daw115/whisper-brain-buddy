import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function buildMeetingContext(authHeader: string, meetingId?: string): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  let query = supabase
    .from("meetings")
    .select("*, meeting_participants(*), action_items(*), decisions(*), transcript_lines(*)")
    .order("date", { ascending: false });

  if (meetingId) {
    query = query.eq("id", meetingId);
  } else {
    query = query.limit(50);
  }

  const { data: meetings, error } = await query;

  if (error || !meetings?.length) {
    return "No meeting data available yet. The user hasn't recorded any meetings.";
  }

  const sections = meetings.map((m: any) => {
    const participants = m.meeting_participants?.map((p: any) => p.name).join(", ") || "None listed";
    const tags = m.tags?.join(", ") || "none";
    const status = m.status || "unknown";

    let section = `## Meeting: ${m.title} (${m.date}${m.duration ? `, ${m.duration}` : ""})\nStatus: ${status}\nParticipants: ${participants}\nTags: ${tags}\n`;

    if (m.summary) {
      section += `\nSummary: ${m.summary}\n`;
    }

    if (m.decisions?.length) {
      section += `\nDecisions:\n`;
      for (const d of m.decisions) {
        section += `- ${d.decision}${d.rationale ? ` (Rationale: ${d.rationale})` : ""}${d.timestamp ? ` [${d.timestamp}]` : ""}\n`;
      }
    }

    if (m.action_items?.length) {
      section += `\nAction Items:\n`;
      for (const a of m.action_items) {
        section += `- ${a.owner}: ${a.task}${a.deadline ? ` (due ${a.deadline})` : ""}${a.completed ? " ✅ COMPLETED" : ""}\n`;
      }
    }

    if (m.transcript_lines?.length) {
      const sorted = [...m.transcript_lines].sort((a: any, b: any) => a.line_order - b.line_order);
      // Include up to 30 lines to keep context manageable
      const lines = sorted.slice(0, 30);
      section += `\nTranscript highlights:\n`;
      for (const l of lines) {
        section += `[${l.timestamp}] ${l.speaker}: ${l.text}\n`;
      }
      if (sorted.length > 30) {
        section += `... (${sorted.length - 30} more lines)\n`;
      }
    }

    return section;
  });

  return sections.join("\n---\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, meetingId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization") || "";

    // Verify the user is authenticated
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const meetingContext = await buildMeetingContext(authHeader, meetingId);

    const scopeNote = meetingId
      ? "You are focused on ONE specific meeting. Answer questions only about this meeting's data below."
      : "You have access to the user's meeting database. Cite meeting titles and dates when possible.";

    const systemPrompt = `You are Cerebro, an AI meeting intelligence assistant. ${scopeNote}
If you can't find relevant info, say so.

MEETING DATA:

${meetingContext}`;

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
            { role: "system", content: systemPrompt },
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
