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
    // mode: "captions" (dialogi z dołu ekranu), "slides" (treść slajdów), "both" (oba + agregacja)
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

    // 1. Get meeting
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

    if (!meeting.recording_filename) {
      return new Response(JSON.stringify({ error: "No recording filename" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Load frames
    const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");
    const dirPrefixes = [`${meeting.user_id}/frames/${stem}`];

    const { data: allDirs } = await supabaseAdmin.storage
      .from("recordings")
      .list(`${meeting.user_id}/frames`);

    if (allDirs) {
      for (const d of allDirs) {
        if (d.name.startsWith(stem + "_part")) {
          dirPrefixes.push(`${meeting.user_id}/frames/${d.name}`);
        }
      }
    }

    const allFrameFiles: { path: string; timestamp: number; segPart: string }[] = [];
    for (const prefix of dirPrefixes) {
      const segName = prefix.split("/").pop() || "";
      const { data: files } = await supabaseAdmin.storage
        .from("recordings")
        .list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } });

      if (files) {
        for (const file of files) {
          if (!file.name.match(/\.(jpg|jpeg|png)$/i)) continue;
          const match = file.name.match(/frame_(\d+)/);
          const ts = match ? parseInt(match[1]) : 0;
          allFrameFiles.push({ path: `${prefix}/${file.name}`, timestamp: ts, segPart: segName });
        }
      }
    }

    allFrameFiles.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`Found ${allFrameFiles.length} frame files across ${dirPrefixes.length} directories`);

    if (allFrameFiles.length === 0) {
      return new Response(JSON.stringify({ error: "No frames found — generate frames first" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Download & deduplicate frames
    const frames: { base64: string; mimeType: string; timestamp: string; seconds: number }[] = [];
    const seenHashes = new Set<string>();

    for (const ff of allFrameFiles.slice(0, 40)) {
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

      const base64 = btoa(bytes.reduce((s, b) => s + String.fromCharCode(b), ""));
      const isJpeg = ff.path.match(/\.jpe?g$/i);
      const mimeType = isJpeg ? "image/jpeg" : "image/png";
      const mins = Math.floor(ff.timestamp / 60);
      const secs = ff.timestamp % 60;

      frames.push({
        base64,
        mimeType,
        timestamp: `${mins}:${String(secs).padStart(2, "0")}`,
        seconds: ff.timestamp,
      });

      if (frames.length >= 25) break;
    }

    console.log(`Loaded ${frames.length} unique frames for OCR`);

    // Helper: build image content parts
    function buildImageParts() {
      const parts: any[] = [];
      for (const frame of frames) {
        parts.push({ type: "text", text: `\n--- Klatka @ ${frame.timestamp} ---` });
        parts.push({
          type: "image_url",
          image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` },
        });
      }
      return parts;
    }

    // Helper: call AI
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
        if (response.status === 429) {
          throw { status: 429, message: "Rate limit — spróbuj za chwilę" };
        }
        if (response.status === 402) {
          throw { status: 402, message: "Brak kredytów AI" };
        }
        throw { status: 500, message: `AI error: ${response.status}` };
      }

      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) {
        console.error("No tool call in response:", JSON.stringify(aiResult).slice(0, 500));
        throw { status: 500, message: "AI did not return structured result" };
      }
      return JSON.parse(toolCall.function.arguments);
    }

    const results: any = {};

    // ========== CAPTIONS OCR (dialogi z paska na dole) ==========
    if (selectedMode === "captions" || selectedMode === "both") {
      console.log("Running CAPTIONS OCR...");
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
        ...buildImageParts(),
      ];

      const captionResult = await callAI(captionParts, [{
        type: "function",
        function: {
          name: "save_captions",
          description: "Save extracted captions/dialogues from video frames",
          parameters: {
            type: "object",
            properties: {
              transcript: {
                type: "string",
                description: "Chronologiczna transkrypcja dialogów z napisów na dole ekranu. Format: [MM:SS] Mówca: tekst.",
              },
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
      results.captions = captionResult;

      // Save captions
      await supabase.from("meeting_analyses").delete().eq("meeting_id", meetingId).eq("source", "captions-ocr");
      await supabase.from("meeting_analyses").insert({
        meeting_id: meetingId,
        source: "captions-ocr",
        analysis_json: captionResult,
      });
    }

    // ========== SLIDES OCR (treść prezentacji) ==========
    if (selectedMode === "slides" || selectedMode === "both") {
      console.log("Running SLIDES OCR...");
      const slideParts: any[] = [
        {
          type: "text",
          text: `Jesteś ekspertem OCR/analizy slajdów prezentacji.

Poniżej ${frames.length} klatek z nagrania spotkania biznesowego.

## CO CZYTAĆ
Skup się na **treści prezentacji/slajdów** wyświetlanej w **głównej (centralnej/górnej) części ekranu**.

⚠️ IGNORUJ napisy/subtitles z dolnej części ekranu (czarny pasek z dialogami) — to osobne źródło.
⚠️ Jeśli slajd się powtarza — pomiń duplikat.

## ZADANIE
Dla KAŻDEGO unikalnego slajdu:
1. Odczytaj CAŁĄ treść: tytuły, nagłówki, bullet pointy, tekst, dane liczbowe
2. Opisz wykresy (osie, wartości, trendy), tabele (odtwórz strukturę), diagramy
3. Zidentyfikuj typ slajdu (tytułowy, agenda, dane, wykres, tabela, podsumowanie)

## FORMAT
[MM:SS] 📊 SLAJD (typ): "Tytuł"
Treść: pełny tekst ze slajdu
Dane: wartości liczbowe, wykresy, tabele

Poniżej klatki:`,
        },
        ...buildImageParts(),
      ];

      const slideResult = await callAI(slideParts, [{
        type: "function",
        function: {
          name: "save_slides",
          description: "Save extracted slide content from presentation frames",
          parameters: {
            type: "object",
            properties: {
              slide_transcript: {
                type: "string",
                description: "Chronologiczna transkrypcja treści slajdów. Format: [MM:SS] 📊 SLAJD (typ): treść.",
              },
              slides: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timestamp: { type: "string" },
                    slide_type: { type: "string" },
                    title: { type: "string" },
                    full_text: { type: "string" },
                    data_values: { type: "string" },
                  },
                  required: ["timestamp", "title", "full_text"],
                  additionalProperties: false,
                },
              },
              total_slides: { type: "number" },
            },
            required: ["slide_transcript", "slides", "total_slides"],
            additionalProperties: false,
          },
        },
      }], { type: "function", function: { name: "save_slides" } });

      console.log(`Slides: ${slideResult.total_slides} slides, ${slideResult.slide_transcript?.length ?? 0} chars`);
      results.slides = slideResult;

      // Save slides
      await supabase.from("meeting_analyses").delete().eq("meeting_id", meetingId).eq("source", "slide-transcript");
      await supabase.from("meeting_analyses").insert({
        meeting_id: meetingId,
        source: "slide-transcript",
        analysis_json: slideResult,
      });
    }

    // ========== AGGREGATION (jeśli oba gotowe) ==========
    if (selectedMode === "both" && results.captions && results.slides) {
      console.log("Running AGGREGATION...");

      // Also load audio transcript if available
      const { data: transcriptLines } = await supabase
        .from("transcript_lines")
        .select("timestamp, speaker, text, line_order")
        .eq("meeting_id", meetingId)
        .order("line_order", { ascending: true })
        .limit(500);

      const audioTranscript = transcriptLines && transcriptLines.length > 0
        ? transcriptLines.map(l => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n")
        : null;

      const aggregatePrompt = `Jesteś ekspertem od analizy spotkań. Masz 3 źródła danych z tego samego spotkania:

## ŹRÓDŁO 1: DIALOGI Z NAPISÓW (OCR z paska na dole ekranu)
${results.captions.transcript || "Brak"}

## ŹRÓDŁO 2: TREŚĆ SLAJDÓW PREZENTACJI (OCR z głównej części ekranu)  
${results.slides.slide_transcript || "Brak"}

${audioTranscript ? `## ŹRÓDŁO 3: TRANSKRYPT AUDIO (Web Speech API / Whisper)
${audioTranscript.slice(0, 10000)}` : "## ŹRÓDŁO 3: Brak transkryptu audio"}

## ZADANIE
Stwórz JEDNĄ zagregowaną transkrypcję chronologiczną łączącą wszystkie źródła:

1. **Dialogi** — użyj napisów OCR jako bazy, uzupełnij/popraw transkryptem audio (jeśli jest)
2. **Slajdy** — w odpowiednich miejscach (wg timestampów) wstaw znaczniki slajdów:
   📊 SLAJD: "Tytuł" — kluczowa treść
3. **Kontekst** — powiąż co mówiono z jakim slajdem, zaznacz:
   - Co na slajdzie pokrywa się z dialogiem
   - Co jest TYLKO na slajdzie (dane, wykresy nieomówione ustnie)
   - Co powiedziano ustnie czego NIE MA na slajdach

Format chronologiczny:
[MM:SS] Mówca: wypowiedź
[MM:SS] 📊 SLAJD (typ): treść slajdu | Kontekst: co mówiono
[MM:SS] 💡 UWAGA: informacja z dialogu bez odpowiednika na slajdzie`;

      const aggregateResult = await callAI(
        [{ type: "text", text: aggregatePrompt }],
        [{
          type: "function",
          function: {
            name: "save_aggregated_transcript",
            description: "Save the aggregated transcript combining captions, slides and audio",
            parameters: {
              type: "object",
              properties: {
                integrated_transcript: {
                  type: "string",
                  description: "Pełna zagregowana transkrypcja łącząca dialogi, slajdy i audio chronologicznie.",
                },
                summary: {
                  type: "string",
                  description: "Krótkie podsumowanie spotkania (2-3 zdania) na podstawie wszystkich źródeł.",
                },
                slide_dialogue_correlations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      slide_timestamp: { type: "string" },
                      slide_title: { type: "string" },
                      discussed_at: { type: "string", description: "Timestamps kiedy omawiano ten slajd" },
                      extra_verbal_info: { type: "string", description: "Co powiedziano ustnie czego nie ma na slajdzie" },
                    },
                    required: ["slide_timestamp", "slide_title"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["integrated_transcript", "summary"],
              additionalProperties: false,
            },
          },
        }],
        { type: "function", function: { name: "save_aggregated_transcript" } }
      );

      console.log(`Aggregated: ${aggregateResult.integrated_transcript?.length ?? 0} chars`);
      results.aggregated = aggregateResult;

      // Save aggregated result
      await supabase.from("meeting_analyses").delete().eq("meeting_id", meetingId).eq("source", "merged");
      await supabase.from("meeting_analyses").insert({
        meeting_id: meetingId,
        source: "merged",
        analysis_json: aggregateResult,
      });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("transcribe-slides error:", e);
    const status = e.status || 500;
    return new Response(
      JSON.stringify({ error: e.message || (e instanceof Error ? e.message : "Unknown error") }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
