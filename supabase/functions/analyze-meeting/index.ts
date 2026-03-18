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

    // User-scoped client for RLS
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service role client for storage access
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Fetch meeting + transcript
    const { data: meeting, error: meetErr } = await supabase
      .from("meetings")
      .select("*, transcript_lines(*)")
      .eq("id", meetingId)
      .single();

    if (meetErr || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get frames from storage
    const frames: { base64: string; timestamp: string }[] = [];
    if (meeting.recording_filename) {
      const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");
      const prefix = `${meeting.user_id}/frames/${stem}`;

      const { data: files } = await supabaseAdmin.storage
        .from("recordings")
        .list(`${meeting.user_id}/frames/${stem}`, { limit: 50, sortBy: { column: "name", order: "asc" } });

      if (files?.length) {
        for (const file of files.slice(0, 20)) {
          const path = `${prefix}/${file.name}`;
          const { data } = await supabaseAdmin.storage
            .from("recordings")
            .download(path);
          if (data) {
            const arrayBuffer = await data.arrayBuffer();
            const base64 = btoa(
              new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), "")
            );
            const match = file.name.match(/frame_(\d+)/);
            const num = match ? parseInt(match[1]) : 0;
            const secs = num * 30;
            const mins = Math.floor(secs / 60);
            const s = secs % 60;
            frames.push({
              base64,
              timestamp: `${mins}:${String(s).padStart(2, "0")}`,
            });
          }
        }
      }
    }

    // 3. Build transcript text
    const transcriptLines = meeting.transcript_lines || [];
    const sorted = [...transcriptLines].sort((a: any, b: any) => a.line_order - b.line_order);
    const transcriptText = sorted.length > 0
      ? sorted.map((l: any) => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n")
      : "(Brak transkryptu tekstowego — przeanalizuj treść slajdów i kontekst wizualny)";

    // 4. Build multimodal message content
    const contentParts: any[] = [];

    // System instructions as text
    contentParts.push({
      type: "text",
      text: `Jesteś asystentem AI Cerebro analizującym spotkania biznesowe.

Masz do dyspozycji:
- Transkrypt rozmowy (jeśli dostępny)
- ${frames.length} klatek/slajdów z prezentacji pokazywanej podczas spotkania

ZADANIE:
1. Przeanalizuj treść każdego slajdu — odczytaj tekst, dane, wykresy, tabele
2. Przeanalizuj transkrypt rozmowy
3. Powiąż kontekst rozmowy z odpowiednimi slajdami
4. Wyciągnij kluczowe informacje

TRANSKRYPT:
---
${transcriptText.slice(0, 15000)}
---

Poniżej znajdują się klatki slajdów z prezentacji (z oznaczeniem czasowym):`,
    });

    // Add frame images
    for (const frame of frames) {
      contentParts.push({
        type: "text",
        text: `\n--- Slajd @ ${frame.timestamp} ---`,
      });
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${frame.base64}`,
        },
      });
    }

    if (frames.length === 0) {
      contentParts.push({
        type: "text",
        text: "\n(Brak klatek slajdów — analiza oparta wyłącznie na transkrypcie)",
      });
    }

    // 5. Call Gemini with tool calling for structured output
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_meeting_analysis",
              description: "Save the structured analysis of a meeting including summary, action items, decisions, and slide insights.",
              parameters: {
                type: "object",
                properties: {
                  summary: {
                    type: "string",
                    description: "Zwięzłe podsumowanie spotkania w 2-4 zdaniach po polsku, odnoszące się do dyskusji i prezentowanych materiałów",
                  },
                  sentiment: {
                    type: "string",
                    enum: ["pozytywny", "neutralny", "negatywny", "mieszany"],
                    description: "Ogólny ton spotkania",
                  },
                  participants: {
                    type: "array",
                    items: { type: "string" },
                    description: "Lista uczestników zidentyfikowanych z transkryptu lub slajdów",
                  },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Główne tematy spotkania (max 5 tagów)",
                  },
                  action_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        task: { type: "string", description: "Opis zadania" },
                        owner: { type: "string", description: "Osoba odpowiedzialna" },
                        deadline: { type: "string", description: "Termin YYYY-MM-DD lub null" },
                      },
                      required: ["task", "owner"],
                      additionalProperties: false,
                    },
                    description: "Konkretne zadania do wykonania",
                  },
                  decisions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        decision: { type: "string", description: "Podjęta decyzja" },
                        rationale: { type: "string", description: "Uzasadnienie" },
                        timestamp: { type: "string", description: "Czas MM:SS" },
                      },
                      required: ["decision"],
                      additionalProperties: false,
                    },
                    description: "Podjęte decyzje",
                  },
                  slide_insights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        slide_timestamp: { type: "string", description: "Czas slajdu" },
                        slide_content: { type: "string", description: "Co jest na slajdzie — tekst, dane, wykresy" },
                        discussion_context: { type: "string", description: "Jak slajd odnosi się do rozmowy" },
                      },
                      required: ["slide_content"],
                      additionalProperties: false,
                    },
                    description: "Analiza poszczególnych slajdów",
                  },
                  key_quotes: {
                    type: "array",
                    items: { type: "string" },
                    description: "Najważniejsze cytaty ze spotkania",
                  },
                },
                required: ["summary", "sentiment", "tags", "action_items", "decisions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_meeting_analysis" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit — spróbuj ponownie za chwilę." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Brak kredytów AI. Doładuj w Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: `AI gateway error: ${response.status}` }), {
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

    // 6. Save results to database
    // Update meeting summary + tags
    const summaryText = analysis.sentiment
      ? `[${analysis.sentiment.toUpperCase()}] ${analysis.summary}`
      : analysis.summary;

    await supabase
      .from("meetings")
      .update({
        summary: summaryText,
        tags: analysis.tags || [],
        status: "analyzed",
      })
      .eq("id", meetingId);

    // Insert participants
    if (analysis.participants?.length) {
      const newParticipants = analysis.participants.map((name: string) => ({
        meeting_id: meetingId,
        name,
      }));
      await supabase.from("meeting_participants").insert(newParticipants);
    }

    // Insert action items
    if (analysis.action_items?.length) {
      const items = analysis.action_items.map((ai: any) => ({
        meeting_id: meetingId,
        user_id: meeting.user_id,
        task: ai.task,
        owner: ai.owner || "Nieprzypisane",
        deadline: ai.deadline || null,
      }));
      await supabase.from("action_items").insert(items);
    }

    // Insert decisions
    if (analysis.decisions?.length) {
      const decs = analysis.decisions.map((d: any) => ({
        meeting_id: meetingId,
        decision: d.decision,
        rationale: d.rationale || null,
        timestamp: d.timestamp || null,
      }));
      await supabase.from("decisions").insert(decs);
    }

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
