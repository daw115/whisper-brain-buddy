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
    const { meetingId, mode } = await req.json();
    if (!meetingId) throw new Error("meetingId is required");

    // mode: "captions" | "unique-frames" | "aggregate" | "both"
    const selectedMode = mode || "both";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: meeting, error: meetErr } = await supabase
      .from("meetings")
      .select("id, title, recording_filename, user_id")
      .eq("id", meetingId)
      .single();

    if (meetErr || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Helpers ----

    async function callAI(contentParts: any[], tools: any[], toolChoice: any) {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: contentParts }],
          tools,
          tool_choice: toolChoice,
        }),
      });

      if (!response.ok) {
        const t = await response.text();
        console.error("AI gateway error:", response.status, t);
        if (response.status === 429) throw { status: 429, message: "Rate limit — spróbuj za chwilę" };
        if (response.status === 402) throw { status: 402, message: "Brak kredytów AI" };
        throw { status: 500, message: `AI error: ${response.status}` };
      }

      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) {
        console.error("No tool call:", JSON.stringify(aiResult).slice(0, 500));
        throw { status: 500, message: "AI did not return structured result" };
      }
      return JSON.parse(toolCall.function.arguments);
    }

    async function saveAnalysis(source: string, json: any) {
      const { error } = await supabase.from("meeting_analyses").insert({
        meeting_id: meetingId, source, analysis_json: json,
      });
      if (error) {
        console.error(`Failed to save ${source}:`, error);
        throw new Error(`Failed to save ${source}`);
      }
    }

    async function loadLatest(source: string) {
      const { data } = await supabase
        .from("meeting_analyses")
        .select("analysis_json")
        .eq("meeting_id", meetingId)
        .eq("source", source)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.analysis_json ?? null;
    }

    // Load and deduplicate frames — returns frame metadata + paths (NO AI call)
    async function loadUniqueFrames() {
      if (!meeting.recording_filename) throw { status: 400, message: "No recording filename" };

      const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");
      const dirPrefixes = [`${meeting.user_id}/frames/${stem}`];

      const { data: allDirs } = await supabaseAdmin.storage
        .from("recordings").list(`${meeting.user_id}/frames`);

      if (allDirs) {
        for (const d of allDirs) {
          if (d.name.startsWith(stem + "_part")) {
            dirPrefixes.push(`${meeting.user_id}/frames/${d.name}`);
          }
        }
      }

      const allFiles: { path: string; timestamp: number }[] = [];
      for (const prefix of dirPrefixes) {
        const { data: files } = await supabaseAdmin.storage
          .from("recordings")
          .list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } });
        if (files) {
          for (const f of files) {
            if (!f.name.match(/\.(jpg|jpeg|png)$/i)) continue;
            const m = f.name.match(/frame_(\d+)/);
            allFiles.push({ path: `${prefix}/${f.name}`, timestamp: m ? parseInt(m[1]) : 0 });
          }
        }
      }

      allFiles.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`Found ${allFiles.length} frame files across ${dirPrefixes.length} dirs`);

      if (allFiles.length === 0) throw { status: 400, message: "No frames found — generate frames first" };

      // Deduplicate by 2KB header hash
      const unique: { path: string; timestamp: number }[] = [];
      const seenHashes = new Set<string>();

      for (const ff of allFiles.slice(0, 60)) {
        const { data } = await supabaseAdmin.storage.from("recordings").download(ff.path);
        if (!data) continue;

        const bytes = new Uint8Array(await data.arrayBuffer());
        let hash = 0;
        const slice = bytes.slice(0, 2048);
        for (let j = 0; j < slice.length; j += 4) {
          hash = ((hash << 5) - hash + slice[j]) | 0;
        }
        const hashStr = hash.toString(36);
        if (seenHashes.has(hashStr)) continue;
        seenHashes.add(hashStr);
        unique.push(ff);
        if (unique.length >= 30) break;
      }

      console.log(`Deduplicated to ${unique.length} unique frames`);
      return unique;
    }

    // Load frames + build image parts for AI (captions OCR)
    async function loadFramesForAI(uniqueFrames: { path: string; timestamp: number }[]) {
      const frames: { base64: string; mimeType: string; timestamp: string }[] = [];
      for (const ff of uniqueFrames.slice(0, 25)) {
        const { data } = await supabaseAdmin.storage.from("recordings").download(ff.path);
        if (!data) continue;
        const bytes = new Uint8Array(await data.arrayBuffer());
        const base64 = btoa(bytes.reduce((s, b) => s + String.fromCharCode(b), ""));
        const isJpeg = ff.path.match(/\.jpe?g$/i);
        const mimeType = isJpeg ? "image/jpeg" : "image/png";
        const mins = Math.floor(ff.timestamp / 60);
        const secs = ff.timestamp % 60;
        frames.push({ base64, mimeType, timestamp: `${mins}:${String(secs).padStart(2, "0")}` });
      }
      return frames;
    }

    function buildImageParts(frames: { base64: string; mimeType: string; timestamp: string }[]) {
      const parts: any[] = [];
      for (const frame of frames) {
        parts.push({ type: "text", text: `\n--- Klatka @ ${frame.timestamp} ---` });
        parts.push({ type: "image_url", image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` } });
      }
      return parts;
    }

    const results: Record<string, any> = {};

    // ========== UNIQUE FRAMES (dedup, no AI) ==========
    if (selectedMode === "unique-frames" || selectedMode === "both") {
      console.log("Identifying unique frames...");
      const uniqueFrames = await loadUniqueFrames();
      const frameData = uniqueFrames.map(f => ({
        path: f.path,
        timestamp: f.timestamp,
        timestamp_formatted: `${Math.floor(f.timestamp / 60)}:${String(f.timestamp % 60).padStart(2, "0")}`,
      }));
      await saveAnalysis("unique-frames", { frames: frameData, total_unique: frameData.length });
      results.uniqueFrames = { frames: frameData, total_unique: frameData.length };
    }

    // ========== CAPTIONS OCR (dialogi z paska na dole) ==========
    if (selectedMode === "captions" || selectedMode === "both") {
      console.log("Running CAPTIONS OCR...");
      // Use already-loaded unique frames if available, otherwise load
      let uniqueFrames: { path: string; timestamp: number }[];
      if (results.uniqueFrames) {
        uniqueFrames = results.uniqueFrames.frames.map((f: any) => ({ path: f.path, timestamp: f.timestamp }));
      } else {
        uniqueFrames = await loadUniqueFrames();
      }
      const frames = await loadFramesForAI(uniqueFrames);

      const captionParts: any[] = [
        {
          type: "text",
          text: `Jesteś ekspertem OCR do odczytu napisów/dialogów ze spotkań wideo.

Poniżej ${frames.length} klatek z nagrania spotkania biznesowego (np. Teams, Zoom).

## CO CZYTAĆ
Na każdej klatce szukaj **napisów/subtitles/dialogów** — tekst w **dolnej części ekranu** na **czarnym lub ciemnym tle** (live captions, napisy automatyczne).

⚠️ IGNORUJ treść slajdów/prezentacji w głównej części ekranu.
⚠️ Jeśli na klatce NIE MA napisów na dole — pomiń ją.

## ZADANIE
1. Odczytaj tekst z paska napisów na dole ekranu
2. Zidentyfikuj mówcę (jeśli widoczne imię/nazwa)
3. Połącz fragmenty z kolejnych klatek w spójne zdania
4. Pomiń duplikaty

## FORMAT
[MM:SS] Mówca: "Pełne zdanie"

Poniżej klatki:`,
        },
        ...buildImageParts(frames),
      ];

      const captionResult = await callAI(captionParts, [{
        type: "function",
        function: {
          name: "save_captions",
          description: "Save extracted captions/dialogues from video frames",
          parameters: {
            type: "object",
            properties: {
              transcript: { type: "string", description: "Chronologiczna transkrypcja dialogów. Format: [MM:SS] Mówca: tekst." },
              entries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timestamp: { type: "string" },
                    speaker: { type: "string" },
                    text: { type: "string" },
                  },
                  required: ["timestamp", "speaker", "text"],
                  additionalProperties: false,
                },
              },
              total_entries: { type: "number" },
            },
            required: ["transcript", "entries", "total_entries"],
            additionalProperties: false,
          },
        },
      }], { type: "function", function: { name: "save_captions" } });

      console.log(`Captions: ${captionResult.total_entries} entries, ${captionResult.transcript?.length ?? 0} chars`);
      await saveAnalysis("captions-ocr", captionResult);
      results.captions = captionResult;
    }

    // ========== AGGREGATION (captions + audio, NO slide OCR) ==========
    if (selectedMode === "aggregate" || selectedMode === "both") {
      console.log("Running AGGREGATION...");

      const captionSource = results.captions ?? await loadLatest("captions-ocr");
      if (!captionSource) {
        throw { status: 400, message: "Missing captions — run captions OCR first" };
      }

      const { data: transcriptLines } = await supabase
        .from("transcript_lines")
        .select("timestamp, speaker, text, line_order")
        .eq("meeting_id", meetingId)
        .order("line_order", { ascending: true })
        .limit(500);

      const audioTranscript = transcriptLines && transcriptLines.length > 0
        ? transcriptLines.map(l => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n")
        : null;

      const aggregatePrompt = `Jesteś ekspertem od analizy spotkań. Masz 2 źródła danych z tego samego spotkania:

## ŹRÓDŁO 1: DIALOGI Z NAPISÓW (OCR z paska na dole ekranu — live captions)
${captionSource.transcript || "Brak"}

${audioTranscript ? `## ŹRÓDŁO 2: TRANSKRYPT AUDIO (Web Speech API / Whisper)
${audioTranscript.slice(0, 15000)}` : "## ŹRÓDŁO 2: Brak transkryptu audio"}

## ZADANIE
Stwórz JEDNĄ zagregowaną transkrypcję chronologiczną łączącą oba źródła:

1. **Dialogi** — użyj napisów OCR jako bazy (są dokładniejsze — mają nazwy mówców)
2. **Audio** — uzupełnij/popraw z transkryptu audio (jeśli jest)
3. **Mówcy** — zidentyfikuj pełne imiona mówców z live captions
4. **Korekta** — popraw ewidentne błędy OCR korzystając z kontekstu audio

Format:
[MM:SS] Mówca: wypowiedź`;

      const aggregateResult = await callAI(
        [{ type: "text", text: aggregatePrompt }],
        [{
          type: "function",
          function: {
            name: "save_aggregated_transcript",
            description: "Save the aggregated transcript combining captions and audio",
            parameters: {
              type: "object",
              properties: {
                integrated_transcript: {
                  type: "string",
                  description: "Pełna zagregowana transkrypcja łącząca dialogi i audio chronologicznie.",
                },
                summary: {
                  type: "string",
                  description: "Krótkie podsumowanie spotkania (2-3 zdania).",
                },
                speakers: {
                  type: "array",
                  items: { type: "string" },
                  description: "Lista zidentyfikowanych mówców (pełne imiona).",
                },
              },
              required: ["integrated_transcript", "summary"],
              additionalProperties: false,
            },
          },
        }],
        { type: "function", function: { name: "save_aggregated_transcript" } },
      );

      console.log(`Aggregated: ${aggregateResult.integrated_transcript?.length ?? 0} chars`);
      await saveAnalysis("merged", aggregateResult);
      results.aggregated = aggregateResult;
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("transcribe-slides error:", e);
    const status = e.status || 500;
    return new Response(
      JSON.stringify({ error: e.message || "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
