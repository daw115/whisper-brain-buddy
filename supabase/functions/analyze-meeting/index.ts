import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Simple perceptual hash: sample pixels from base64 image data to detect duplicates */
function quickImageHash(base64: string): string {
  // Sample evenly spaced bytes from the base64 string
  let hash = 0;
  const step = Math.max(1, Math.floor(base64.length / 200));
  for (let i = 0; i < base64.length; i += step) {
    hash = ((hash << 5) - hash + base64.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Remove duplicate frames based on content hash */
function deduplicateFrames(frames: { base64: string; timestamp: string; seconds: number }[]) {
  const seen = new Set<string>();
  return frames.filter((f) => {
    const hash = quickImageHash(f.base64);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

/** Parse timestamp string "M:SS" to seconds */
function timestampToSeconds(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

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

    // 2. Get frames from storage (all segments)
    let rawFrames: { base64: string; timestamp: string; seconds: number }[] = [];
    if (meeting.recording_filename) {
      const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");

      // Collect frames from main recording and all _partN segments
      const frameDirs: string[] = [`${meeting.user_id}/frames/${stem}`];
      const { data: allDirs } = await supabaseAdmin.storage
        .from("recordings")
        .list(`${meeting.user_id}/frames`);
      if (allDirs) {
        for (const d of allDirs) {
          if (d.name.startsWith(stem + "_part") && d.id) {
            frameDirs.push(`${meeting.user_id}/frames/${d.name}`);
          }
        }
      }

      for (const dir of frameDirs) {
        const { data: files } = await supabaseAdmin.storage
          .from("recordings")
          .list(dir, { limit: 50, sortBy: { column: "name", order: "asc" } });

        if (files?.length) {
          for (const file of files) {
            if (!file.name.match(/\.(jpg|jpeg|png)$/i)) continue;
            const path = `${dir}/${file.name}`;
            const { data } = await supabaseAdmin.storage
              .from("recordings")
              .download(path);
            if (data) {
              const arrayBuffer = await data.arrayBuffer();
              const base64 = btoa(
                new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), "")
              );
              // Parse seconds directly from filename (frame_30s.jpg = 30 seconds)
              const match = file.name.match(/frame_(\d+)s?\./);
              const secs = match ? parseInt(match[1]) : 0;
              const mins = Math.floor(secs / 60);
              const s = secs % 60;
              rawFrames.push({ base64, timestamp: `${mins}:${String(s).padStart(2, "0")}`, seconds: secs });
            }
          }
        }
      }
    }

    // Sort by time, then deduplicate
    rawFrames.sort((a, b) => a.seconds - b.seconds);
    const frames = deduplicateFrames(rawFrames);
    console.log(`Frames: ${rawFrames.length} raw → ${frames.length} unique`);

    // 3. Build transcript
    const transcriptLines = meeting.transcript_lines || [];
    const sorted = [...transcriptLines].sort((a: any, b: any) => a.line_order - b.line_order);

    // 4. Build interleaved multimodal content (transcript sections + matching slides)
    const contentParts: any[] = [];
    contentParts.push({
      type: "text",
      text: `Jesteś asystentem AI Cerebro analizującym spotkania biznesowe.

Masz do dyspozycji:
- Transkrypt rozmowy (jeśli dostępny)
- ${frames.length} unikalnych klatek/slajdów z prezentacji (po usunięciu duplikatów)

Klatki są wstawione w odpowiednich miejscach transkryptu, odpowiadając momentom czasowym prezentacji.
Analizuj je razem — slajd pokazuje co było wyświetlane w danym momencie rozmowy.`,
    });

    if (sorted.length > 0) {
      // Interleave transcript lines with frames at matching timestamps
      let frameIdx = 0;
      let currentTranscriptBlock: string[] = [];

      for (const line of sorted) {
        const lineSecs = timestampToSeconds(line.timestamp || "0:00");

        // Insert any frames that should appear before this transcript line
        while (frameIdx < frames.length && frames[frameIdx].seconds <= lineSecs) {
          // Flush current transcript block
          if (currentTranscriptBlock.length > 0) {
            contentParts.push({ type: "text", text: currentTranscriptBlock.join("\n") });
            currentTranscriptBlock = [];
          }
          contentParts.push({ type: "text", text: `\n--- Slajd @ ${frames[frameIdx].timestamp} ---` });
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${frames[frameIdx].base64}` },
          });
          frameIdx++;
        }

        currentTranscriptBlock.push(`[${line.timestamp}] ${line.speaker}: ${line.text}`);
      }

      // Flush remaining transcript
      if (currentTranscriptBlock.length > 0) {
        contentParts.push({ type: "text", text: currentTranscriptBlock.join("\n") });
      }

      // Append remaining frames
      while (frameIdx < frames.length) {
        contentParts.push({ type: "text", text: `\n--- Slajd @ ${frames[frameIdx].timestamp} ---` });
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${frames[frameIdx].base64}` },
        });
        frameIdx++;
      }
    } else {
      // No transcript — just show frames
      contentParts.push({ type: "text", text: "(Brak transkryptu — przeanalizuj treść slajdów i kontekst wizualny)" });
      for (const frame of frames) {
        contentParts.push({ type: "text", text: `\n--- Slajd @ ${frame.timestamp} ---` });
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
        });
      }
    }

    if (frames.length === 0) {
      contentParts.push({ type: "text", text: "\n(Brak klatek — analiza oparta wyłącznie na transkrypcie)" });
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
