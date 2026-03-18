import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { meetingId } = await req.json();
    if (!meetingId) throw new Error("meetingId is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Fetch meeting + transcript
    const { data: meeting, error: meetErr } = await supabase
      .from("meetings")
      .select("*, transcript_lines(*)")
      .eq("id", meetingId)
      .single();

    if (meetErr || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get frames from storage + deduplicate
    const frames: { base64: string; timestamp: string }[] = [];
    if (meeting.recording_filename) {
      const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");

      // Collect frames from main + segment directories
      const dirPrefixes = [`${meeting.user_id}/frames/${stem}`];
      const { data: allDirs } = await supabaseAdmin.storage
        .from("recordings")
        .list(`${meeting.user_id}/frames`);
      if (allDirs) {
        for (const d of allDirs) {
          if (d.name.startsWith(stem + "_part") && d.id) {
            dirPrefixes.push(`${meeting.user_id}/frames/${d.name}`);
          }
        }
      }

      const allFrameFiles: { path: string; timestamp: number }[] = [];
      for (const prefix of dirPrefixes) {
        const { data: files } = await supabaseAdmin.storage
          .from("recordings")
          .list(prefix, { limit: 50, sortBy: { column: "name", order: "asc" } });
        if (files) {
          for (const file of files) {
            if (!file.name.match(/\.(jpg|jpeg|png)$/i)) continue;
            const match = file.name.match(/frame_(\d+)/);
            const ts = match ? parseInt(match[1]) : 0;
            allFrameFiles.push({ path: `${prefix}/${file.name}`, timestamp: ts });
          }
        }
      }
      allFrameFiles.sort((a, b) => a.timestamp - b.timestamp);

      // Download and deduplicate frames using simple hash
      const seenHashes = new Set<string>();
      for (const ff of allFrameFiles.slice(0, 30)) {
        const { data } = await supabaseAdmin.storage
          .from("recordings")
          .download(ff.path);
        if (!data) continue;

        const arrayBuffer = await data.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Simple perceptual hash on first 2KB
        let hash = 0;
        const slice = bytes.slice(0, 2048);
        for (let j = 0; j < slice.length; j += 4) {
          hash = ((hash << 5) - hash + slice[j]) | 0;
        }
        const hashStr = hash.toString(36);
        if (seenHashes.has(hashStr)) continue;
        seenHashes.add(hashStr);

        const base64 = btoa(bytes.reduce((s, b) => s + String.fromCharCode(b), ""));
        const secs = ff.timestamp;
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        frames.push({ base64, timestamp: `${mins}:${String(s).padStart(2, "0")}` });

        if (frames.length >= 20) break;
      }
      console.log(`Loaded ${frames.length} unique frames (deduped from ${allFrameFiles.length})`);
    }

    // 3. Build transcript
    const transcriptLines = meeting.transcript_lines || [];
    const sorted = [...transcriptLines].sort((a: any, b: any) => a.line_order - b.line_order);
    const transcriptText = sorted.length > 0
      ? sorted.map((l: any) => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n")
      : "(Brak transkryptu — przeanalizuj treść slajdów i kontekst wizualny)";

    // 4. Build multimodal content
    const contentParts: any[] = [];
    contentParts.push({
      type: "text",
      text: `Jesteś asystentem AI Cerebro analizującym spotkania biznesowe.

Masz do dyspozycji:
- Transkrypt rozmowy (jeśli dostępny)
- ${frames.length} klatek/slajdów z prezentacji

TRANSKRYPT:
---
${transcriptText.slice(0, 15000)}
---

Poniżej klatki slajdów z prezentacji:`,
    });

    for (const frame of frames) {
      contentParts.push({ type: "text", text: `\n--- Slajd @ ${frame.timestamp} ---` });
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
      });
    }

    if (frames.length === 0) {
      contentParts.push({ type: "text", text: "\n(Brak klatek — analiza oparta na transkrypcie)" });
    }

    // 5. Call Gemini with tool calling
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: contentParts }],
        tools: [{
          type: "function",
          function: {
            name: "save_meeting_analysis",
            description: "Save structured meeting analysis",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Podsumowanie 2-4 zdania po polsku" },
                sentiment: { type: "string", enum: ["pozytywny", "neutralny", "negatywny", "mieszany"] },
                participants: { type: "array", items: { type: "string" } },
                tags: { type: "array", items: { type: "string" }, description: "Max 5 tagów" },
                key_quotes: { type: "array", items: { type: "string" } },
                action_items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      task: { type: "string" },
                      owner: { type: "string" },
                      deadline: { type: "string" },
                    },
                    required: ["task", "owner"],
                    additionalProperties: false,
                  },
                },
                decisions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      decision: { type: "string" },
                      rationale: { type: "string" },
                      timestamp: { type: "string" },
                    },
                    required: ["decision"],
                    additionalProperties: false,
                  },
                },
                slide_insights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      slide_timestamp: { type: "string" },
                      slide_content: { type: "string" },
                      discussion_context: { type: "string" },
                    },
                    required: ["slide_content"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "sentiment", "tags", "action_items", "decisions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_meeting_analysis" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit — spróbuj za chwilę." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Brak kredytów AI." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: `AI error: ${response.status}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI did not return structured analysis" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const analysis = JSON.parse(toolCall.function.arguments);

    // 6. Save to meeting_analyses table (source: gemini)
    await supabase.from("meeting_analyses").insert({
      meeting_id: meetingId,
      source: "gemini",
      analysis_json: analysis,
    });

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-meeting error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
