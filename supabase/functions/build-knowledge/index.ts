import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { meetingId } = await req.json();
    if (!meetingId) throw new Error("meetingId is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Fetch meeting with relations
    const { data: meeting } = await userClient
      .from("meetings")
      .select("*, transcript_lines(*), action_items(*), decisions(*), meeting_participants(*), meeting_analyses(*)")
      .eq("id", meetingId)
      .single();

    if (!meeting) throw new Error("Meeting not found");

    // Fetch existing patterns and contexts
    const { data: existingPatterns } = await userClient
      .from("task_patterns")
      .select("*")
      .order("frequency", { ascending: false })
      .limit(30);

    const { data: existingContexts } = await userClient
      .from("project_contexts")
      .select("*")
      .order("last_activity", { ascending: false })
      .limit(20);

    // Build transcript text
    const transcriptText = (meeting.transcript_lines || [])
      .sort((a: any, b: any) => a.line_order - b.line_order)
      .map((l: any) => `[${l.timestamp}] ${l.speaker}: ${l.text}`)
      .join("\n");

    // Get analysis summary if available
    const latestAnalysis = (meeting.meeting_analyses || [])
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    const analysisText = latestAnalysis
      ? JSON.stringify(latestAnalysis.analysis_json, null, 2)
      : "";

    const patternsContext = (existingPatterns || []).map((p: any) =>
      `- "${p.pattern_name}" (freq: ${p.frequency}, keywords: ${(p.keywords || []).join(", ")})`
    ).join("\n");

    const projectsContext = (existingContexts || []).map((c: any) =>
      `- "${c.name}" (meetings: ${c.meeting_count}, keywords: ${(c.keywords || []).join(", ")})`
    ).join("\n");

    const actionItemsText = (meeting.action_items || []).map((a: any) =>
      `- ${a.owner}: ${a.task}${a.deadline ? ` (deadline: ${a.deadline})` : ""}${a.completed ? " [DONE]" : ""}`
    ).join("\n");

    const prompt = `Analyze this meeting and extract structured knowledge.

MEETING: "${meeting.title}" (${meeting.date})
Participants: ${(meeting.meeting_participants || []).map((p: any) => p.name).join(", ") || "unknown"}
Summary: ${meeting.summary || "none"}

ACTION ITEMS:
${actionItemsText || "none"}

TRANSCRIPT:
${transcriptText.slice(0, 8000) || "none"}

ANALYSIS:
${analysisText.slice(0, 4000) || "none"}

EXISTING TASK PATTERNS:
${patternsContext || "none yet"}

EXISTING PROJECT CONTEXTS:
${projectsContext || "none yet"}

Instructions:
1. Create a concise summary (2-4 sentences) of the meeting
2. Extract 3-8 key topics as short labels
3. Determine which project context this meeting belongs to (match existing or suggest new)
4. Determine the sentiment (positive/neutral/negative/mixed)
5. Identify task patterns from the action items - match to existing patterns or create new ones
6. For each pattern, provide keywords and a suggested category`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a knowledge extraction engine. Respond only via tool calls." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_knowledge",
            description: "Save extracted knowledge from meeting analysis",
            parameters: {
              type: "object",
              properties: {
                summary_text: { type: "string", description: "Concise 2-4 sentence summary" },
                key_topics: { type: "array", items: { type: "string" }, description: "3-8 topic labels" },
                project_context: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    is_new: { type: "boolean" },
                    description: { type: "string" },
                    keywords: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "is_new"],
                },
                sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
                task_patterns: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      pattern_name: { type: "string" },
                      is_existing: { type: "boolean" },
                      keywords: { type: "array", items: { type: "string" } },
                      suggested_category: { type: "string" },
                    },
                    required: ["pattern_name", "is_existing", "keywords"],
                  },
                },
              },
              required: ["summary_text", "key_topics", "project_context", "sentiment", "task_patterns"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_knowledge" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const knowledge = JSON.parse(toolCall.function.arguments);

    // 1. Upsert project context
    let projectContextName = knowledge.project_context.name;
    if (knowledge.project_context.is_new) {
      await adminClient.from("project_contexts").insert({
        user_id: user.id,
        name: projectContextName,
        description: knowledge.project_context.description || "",
        keywords: knowledge.project_context.keywords || [],
        meeting_count: 1,
        last_activity: new Date().toISOString(),
      });
    } else {
      // Find existing and increment
      const { data: existing } = await userClient
        .from("project_contexts")
        .select("id, meeting_count")
        .eq("name", projectContextName)
        .limit(1);
      if (existing?.length) {
        await adminClient.from("project_contexts")
          .update({
            meeting_count: (existing[0].meeting_count || 0) + 1,
            last_activity: new Date().toISOString(),
          })
          .eq("id", existing[0].id);
      } else {
        // AI said existing but doesn't exist — create it
        await adminClient.from("project_contexts").insert({
          user_id: user.id,
          name: projectContextName,
          description: knowledge.project_context.description || "",
          keywords: knowledge.project_context.keywords || [],
          meeting_count: 1,
          last_activity: new Date().toISOString(),
        });
      }
    }

    // 2. Save knowledge summary
    await adminClient.from("knowledge_summaries").insert({
      meeting_id: meetingId,
      user_id: user.id,
      summary_text: knowledge.summary_text,
      key_topics: knowledge.key_topics,
      project_context: projectContextName,
      sentiment: knowledge.sentiment,
    });

    // 3. Upsert task patterns
    for (const pattern of knowledge.task_patterns || []) {
      if (pattern.is_existing) {
        const { data: ep } = await userClient
          .from("task_patterns")
          .select("id, frequency, keywords")
          .eq("pattern_name", pattern.pattern_name)
          .limit(1);
        if (ep?.length) {
          const mergedKeywords = [...new Set([...(ep[0].keywords || []), ...(pattern.keywords || [])])];
          await adminClient.from("task_patterns")
            .update({
              frequency: (ep[0].frequency || 0) + 1,
              keywords: mergedKeywords,
              last_seen: new Date().toISOString(),
              suggested_category: pattern.suggested_category || null,
            })
            .eq("id", ep[0].id);
        } else {
          await adminClient.from("task_patterns").insert({
            user_id: user.id,
            pattern_name: pattern.pattern_name,
            keywords: pattern.keywords || [],
            suggested_category: pattern.suggested_category || null,
            frequency: 1,
            last_seen: new Date().toISOString(),
          });
        }
      } else {
        await adminClient.from("task_patterns").insert({
          user_id: user.id,
          pattern_name: pattern.pattern_name,
          keywords: pattern.keywords || [],
          suggested_category: pattern.suggested_category || null,
          frequency: 1,
          last_seen: new Date().toISOString(),
        });
      }
    }

    return new Response(JSON.stringify({ success: true, knowledge }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("build-knowledge error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
