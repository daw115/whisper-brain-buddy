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

    // mode: "unique-frames" | "captions" | "aggregate"
    const selectedMode = mode || "unique-frames";

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

    // Load and deduplicate frames
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

    // Load frames + build image parts for AI
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
    if (selectedMode === "unique-frames") {
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

    // ========== CAPTIONS + SLIDE CONTENT OCR ==========
    if (selectedMode === "captions") {
      console.log("Running CAPTIONS + SLIDE CONTENT OCR...");
      // Load unique frames
      let uniqueFrames: { path: string; timestamp: number }[];
      const savedFrames = await loadLatest("unique-frames") as any;
      if (savedFrames?.frames) {
        uniqueFrames = savedFrames.frames.map((f: any) => ({ path: f.path, timestamp: f.timestamp }));
      } else {
        uniqueFrames = await loadUniqueFrames();
      }
      const frames = await loadFramesForAI(uniqueFrames);

      const captionParts: any[] = [
        {
          type: "text",
          text: `Jesteś ekspertem OCR do analizy klatek z nagrań spotkań wideo (Teams/Zoom).

Poniżej ${frames.length} klatek z nagrania spotkania biznesowego.

## ZADANIE 1: DIALOGI (napisy/live captions)
Na każdej klatce szukaj **napisów/subtitles** — tekst w **dolnej części ekranu** na **czarnym/ciemnym tle** (live captions).
- Odczytaj tekst z paska napisów
- Zidentyfikuj mówcę (jeśli widoczne imię/nazwa)
- Połącz fragmenty w spójne zdania
- Pomiń duplikaty

## ZADANIE 2: TREŚĆ SLAJDÓW/PREZENTACJI
Dla każdej klatki przeanalizuj **główną część ekranu** (prezentację/slajd):
- Odczytaj tytuł slajdu
- Opisz PEŁNĄ treść: bullet pointy, dane liczbowe, wykresy, tabele, diagramy
- Zanotuj co się zmieniło vs poprzednia klatka (nowy slajd? ta sama treść?)

## FORMAT
Zwróć ZARÓWNO dialogi jak i opisy slajdów.

Poniżej klatki:`,
        },
        ...buildImageParts(frames),
      ];

      const captionResult = await callAI(captionParts, [{
        type: "function",
        function: {
          name: "save_ocr_results",
          description: "Save extracted captions/dialogues AND slide content descriptions",
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
                description: "Dialogi z paska live captions na dole ekranu.",
              },
              total_entries: { type: "number" },
              slide_descriptions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timestamp: { type: "string", description: "Timestamp klatki MM:SS" },
                    slide_title: { type: "string", description: "Tytuł slajdu" },
                    slide_content: { type: "string", description: "Pełna treść slajdu: bullet pointy, dane, tabele" },
                    is_new_slide: { type: "boolean", description: "Czy to nowy slajd vs poprzedni" },
                  },
                  required: ["timestamp", "slide_title", "slide_content", "is_new_slide"],
                  additionalProperties: false,
                },
                description: "Opisy treści slajdów/prezentacji z głównej części ekranu.",
              },
              speakers_identified: {
                type: "array",
                items: { type: "string" },
                description: "Lista zidentyfikowanych mówców (pełne imiona z live captions).",
              },
            },
            required: ["transcript", "entries", "total_entries", "slide_descriptions", "speakers_identified"],
            additionalProperties: false,
          },
        },
      }], { type: "function", function: { name: "save_ocr_results" } });

      console.log(`OCR: ${captionResult.total_entries} dialog entries, ${captionResult.slide_descriptions?.length ?? 0} slide descriptions`);
      await saveAnalysis("captions-ocr", captionResult);
      results.captions = captionResult;
    }

    // ========== AGGREGATION (captions + audio) ==========
    if (selectedMode === "aggregate") {
      console.log("Running AGGREGATION...");

      const captionSource = await loadLatest("captions-ocr") as any;
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

      // Build slide descriptions text
      const slideDescs = captionSource.slide_descriptions as any[] | undefined;
      const slideDescText = slideDescs && slideDescs.length > 0
        ? slideDescs
            .filter((s: any) => s.is_new_slide !== false)
            .map((s: any) => `[${s.timestamp}] 📊 ${s.slide_title}: ${s.slide_content}`)
            .join("\n")
        : null;

      // Build OCR dialog entries for line-by-line comparison
      const ocrEntries = captionSource.entries as any[] | undefined;
      const ocrDialogText = ocrEntries && ocrEntries.length > 0
        ? ocrEntries.map((e: any) => `[${e.timestamp}] ${e.speaker}: ${e.text}`).join("\n")
        : captionSource.transcript || "Brak";

      const aggregatePrompt = `Jesteś ekspertem od analizy spotkań. Masz dane z tego samego spotkania z dwóch niezależnych źródeł + opisy slajdów.

${audioTranscript ? `## ŹRÓDŁO 1 (BAZA): TRANSKRYPT AUDIO (Whisper/Gemini STT)
Timestampy są ciągłe od początku do końca nagrania.
${audioTranscript.slice(0, 20000)}` : "## ŹRÓDŁO 1: Brak transkryptu audio"}

## ŹRÓDŁO 2: DIALOGI OCR (odczytane z paska live captions na dole ekranu)
Timestampy odpowiadają momentom pojawienia się klatki.
${ocrDialogText}

${slideDescText ? `## ŹRÓDŁO 3: OPISY SLAJDÓW (treść prezentacji odczytana z klatek)
${slideDescText}` : ""}

## ZADANIE — AGREGACJA LINIA PO LINII

Idź chronologicznie przez transkrypt audio (ŹRÓDŁO 1) i dla każdej linii:

1. **Znajdź odpowiednik w OCR** (ŹRÓDŁO 2) po zbliżonym timestampie (±30s tolerancji)
2. **Porównaj treść** obu wersji tej samej wypowiedzi:
   - Jeśli audio jest poprawne i zrozumiałe → zostaw audio bez zmian
   - Jeśli OCR ma lepszą/pełniejszą wersję (np. audio źle rozpoznało słowo) → użyj wersji OCR
   - Jeśli OCR ma imię mówcy a audio ma "Mówca"/"unknown" → użyj imienia z OCR
3. **Slajdy** — w odpowiednich momentach wstaw znacznik 📊 z opisem slajdu (ŹRÓDŁO 3)
4. **NIE generuj nowych wypowiedzi** — tylko koryguj istniejące na podstawie porównania
5. **NIE usuwaj linii** z audio — każda linia powinna mieć odpowiednik w wyniku

Format wyniku:
[MM:SS] Mówca: wypowiedź
[MM:SS] 📊 SLAJD: "Tytuł" — opis treści slajdu`;

      const aggregateResult = await callAI(
        [{ type: "text", text: aggregatePrompt }],
        [{
          type: "function",
          function: {
            name: "save_aggregated_transcript",
            description: "Save the aggregated transcript combining captions, audio and slide markers",
            parameters: {
              type: "object",
              properties: {
                integrated_transcript: {
                  type: "string",
                  description: "Pełna zagregowana transkrypcja z dialogami i znacznikami slajdów chronologicznie.",
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
                slide_markers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      timestamp: { type: "string" },
                      slide_title: { type: "string" },
                      slide_summary: { type: "string" },
                    },
                    required: ["timestamp", "slide_title", "slide_summary"],
                    additionalProperties: false,
                  },
                  description: "Lista slajdów z ich pozycjami w chronologii spotkania.",
                },
              },
              required: ["integrated_transcript", "summary", "speakers", "slide_markers"],
              additionalProperties: false,
            },
          },
        }],
        { type: "function", function: { name: "save_aggregated_transcript" } },
      );

      console.log(`Aggregated: ${aggregateResult.integrated_transcript?.length ?? 0} chars, ${aggregateResult.slide_markers?.length ?? 0} slide markers`);
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
