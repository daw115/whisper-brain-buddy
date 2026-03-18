import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// No jpeg-js import — we skip server-side image cropping to avoid CPU limits

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
    const body = await req.json();
    const { meetingId, mode, batchOffset = 0, batchSize = 30 } = body;
    if (!meetingId) throw new Error("meetingId is required");

    // mode: "crop-split" | "ocr-captions" | "describe-slides" | "aggregate"
    const selectedMode = mode || "crop-split";

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
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const { error } = await supabase.from("meeting_analyses").insert({
          meeting_id: meetingId, source, analysis_json: json,
        });
        if (!error) return;
        console.error(`Failed to save ${source} (attempt ${attempt}/${maxRetries}):`, error);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        } else {
          throw new Error(`Failed to save ${source} after ${maxRetries} attempts`);
        }
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

    // Collect all frame file paths sorted by timestamp
    async function collectFramePaths(): Promise<{ path: string; timestamp: number }[]> {
      if (!meeting.recording_filename) throw { status: 400, message: "No recording filename" };

      const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");
      const dirPrefixes = [`${meeting.user_id}/frames/${stem}`];

      const { data: allDirs } = await supabaseAdmin.storage
        .from("recordings").list(`${meeting.user_id}/frames`);

      if (allDirs) {
        for (const d of allDirs) {
          if (d.name.startsWith(stem + "_part") || d.name.startsWith(stem + "_sub")) {
            dirPrefixes.push(`${meeting.user_id}/frames/${d.name}`);
          }
        }
      }

      const allFiles: { path: string; timestamp: number }[] = [];
      for (const prefix of dirPrefixes) {
        const { data: files } = await supabaseAdmin.storage
          .from("recordings")
          .list(prefix, { limit: 200, sortBy: { column: "name", order: "asc" } });
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
      return allFiles;
    }

    // Hash raw JPEG bytes for dedup (no decode needed)
    function hashFrameBytes(jpegBytes: Uint8Array): string {
      let hash = 0;
      // Sample bytes across the image, skip header
      const start = Math.min(500, jpegBytes.length);
      const end = Math.min(jpegBytes.length, 8000);
      for (let i = start; i < end; i += 3) {
        hash = ((hash << 5) - hash + jpegBytes[i]) | 0;
      }
      return hash.toString(36);
    }

    function formatTs(seconds: number): string {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    function bytesToBase64(bytes: Uint8Array): string {
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }

    type CaptionEntry = { timestamp: string; speaker: string; text: string };

    function dedupeCaptionEntries(entries: CaptionEntry[]): CaptionEntry[] {
      const deduped: CaptionEntry[] = [];
      for (const entry of entries) {
        const normalized: CaptionEntry = {
          timestamp: String(entry.timestamp || "").trim(),
          speaker: String(entry.speaker || "Unknown").trim(),
          text: String(entry.text || "").trim(),
        };
        if (!normalized.text) continue;

        const previous = deduped[deduped.length - 1];
        if (
          previous &&
          previous.speaker === normalized.speaker &&
          previous.text === normalized.text
        ) {
          continue;
        }

        deduped.push(normalized);
      }
      return deduped;
    }

    const results: Record<string, any> = {};

    // ========== STEP 3: DEDUPLICATE FRAMES (batched, no image decoding) ==========
    if (selectedMode === "crop-split") {
      console.log(`Step 3: Deduplicate frames batch offset=${batchOffset} size=${batchSize}...`);
      const framePaths = await collectFramePaths();
      const totalFrames = framePaths.length;

      // Load existing hashes from previous batches (for cross-batch dedup)
      const prevData = batchOffset > 0 ? await loadLatest("crop-split") as any : null;
      const seenHashes = new Map<string, number>();
      const existingUniqueFrames: any[] = prevData?.unique_slides ?? [];
      if (prevData?.slide_hashes) {
        for (const [h, ts] of Object.entries(prevData.slide_hashes)) {
          seenHashes.set(h, ts as number);
        }
      }

      const batchFrames = framePaths.slice(batchOffset, batchOffset + batchSize);
      const newUnique: any[] = [];
      let processedCount = 0;

      for (const frame of batchFrames) {
        const { data: blob } = await supabaseAdmin.storage.from("recordings").download(frame.path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const tsFormatted = formatTs(frame.timestamp);

        // Dedup by raw byte hash (no decode needed)
        const frameHash = hashFrameBytes(bytes);
        if (!seenHashes.has(frameHash)) {
          seenHashes.set(frameHash, frame.timestamp);
          newUnique.push({ path: frame.path, timestamp: frame.timestamp, ts_formatted: tsFormatted });
        }
        processedCount++;
      }

      const allUnique = [...existingUniqueFrames, ...newUnique];
      const totalProcessed = batchOffset + processedCount;
      const hasMore = totalProcessed < totalFrames;

      // Serialize hashes for cross-batch dedup
      const slideHashesObj: Record<string, number> = {};
      seenHashes.forEach((ts, h) => { slideHashesObj[h] = ts; });

      console.log(`Dedup batch done: ${processedCount} frames (${totalProcessed}/${totalFrames}), ${allUnique.length} unique total`);

      // All frames are also caption sources (Gemini will read captions from full frames)
      const allFrameRefs = [
        ...(prevData?.caption_crops ?? []),
        ...batchFrames.map(f => ({ path: f.path, timestamp: f.timestamp, ts_formatted: formatTs(f.timestamp) })),
      ];

      const cropData = {
        unique_slides: allUnique,
        caption_crops: allFrameRefs,
        slide_hashes: slideHashesObj,
        total_frames: totalProcessed,
        total_unique_slides: allUnique.length,
        total_captions: allFrameRefs.length,
        has_more: hasMore,
        next_offset: hasMore ? totalProcessed : null,
        frames_total: totalFrames,
      };

      // Delete previous and save updated
      if (batchOffset > 0) {
        await supabase.from("meeting_analyses").delete()
          .eq("meeting_id", meetingId).eq("source", "crop-split");
      }
      await saveAnalysis("crop-split", cropData);
      results.cropSplit = cropData;
    }

    // ========== STEP 4: OCR CAPTIONS ==========
    if (selectedMode === "ocr-captions") {
      console.log(`Step 4: OCR caption crops batch offset=${batchOffset} size=${batchSize}...`);

      const cropData = await loadLatest("crop-split") as any;
      if (!cropData?.caption_crops?.length) {
        throw { status: 400, message: "Run crop-split first" };
      }

      const captionCrops = cropData.caption_crops as { path: string; timestamp: number; ts_formatted: string }[];
      const currentBatchSize = Math.max(1, Math.min(batchSize, 12));
      const currentBatch = captionCrops.slice(batchOffset, batchOffset + currentBatchSize);
      const previousResult = batchOffset > 0 ? await loadLatest("captions-ocr") as any : null;

      if (currentBatch.length === 0) {
        throw { status: 400, message: "No caption frames left to process" };
      }

      const imageParts: any[] = [];
      for (const cap of currentBatch) {
        const { data: blob } = await supabaseAdmin.storage.from("recordings").download(cap.path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const base64 = bytesToBase64(bytes);
        imageParts.push({ type: "text", text: `\n--- Napis @ ${cap.ts_formatted} ---` });
        imageParts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } });
      }

      if (imageParts.length === 0) {
        throw { status: 400, message: "Could not load caption frames for OCR" };
      }

      const ocrParts: any[] = [
        {
          type: "text",
          text: `Jesteś ekspertem OCR. Poniżej ${currentBatch.length} screenów z jednego batcha nagrania spotkania Teams.

Na DOLE każdego ekranu znajduje się ciemny pasek z napisami (live captions/subtitles). Zignoruj resztę ekranu (prezentację) — skupiaj się WYŁĄCZNIE na dolnym pasku z napisami.

## ZADANIE
1. Odczytaj tekst z każdego paska
2. Zidentyfikuj mówcę (imię widoczne obok tekstu)
3. Połącz fragmenty w spójne zdania (napisy Teams są urywane w połowie zdań)
4. Połącz powtarzające się fragmenty w jedno pełne zdanie
5. NIE duplikuj — jeśli kolejne klatki mają ten sam tekst, zapisz go tylko raz

Zwróć wynik jako listę chronologicznych wypowiedzi tylko dla dostarczonych screenów.`,
        },
        ...imageParts,
      ];

      const batchResult = await callAI(ocrParts, [{
        type: "function",
        function: {
          name: "save_caption_ocr",
          description: "Save OCR results from caption bar crops",
          parameters: {
            type: "object",
            properties: {
              entries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timestamp: { type: "string", description: "MM:SS" },
                    speaker: { type: "string", description: "Imię mówcy" },
                    text: { type: "string", description: "Pełne zdanie" },
                  },
                  required: ["timestamp", "speaker", "text"],
                  additionalProperties: false,
                },
              },
              speakers: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["entries", "speakers"],
            additionalProperties: false,
          },
        },
      }], { type: "function", function: { name: "save_caption_ocr" } });

      const mergedEntries = dedupeCaptionEntries([
        ...(previousResult?.entries ?? []),
        ...(batchResult.entries ?? []),
      ]);
      const mergedSpeakers = Array.from(new Set([
        ...(previousResult?.speakers_identified ?? []),
        ...(batchResult.speakers ?? []),
      ].filter(Boolean)));
      const totalProcessed = Math.min(batchOffset + currentBatch.length, captionCrops.length);
      const hasMore = totalProcessed < captionCrops.length;
      const transcript = mergedEntries.map((e) => `[${e.timestamp}] ${e.speaker}: ${e.text}`).join("\n");

      const ocrResult = {
        transcript,
        entries: mergedEntries,
        total_entries: mergedEntries.length,
        speakers_identified: mergedSpeakers,
        processed_frames: totalProcessed,
        frames_total: captionCrops.length,
        has_more: hasMore,
        next_offset: hasMore ? totalProcessed : null,
      };

      console.log(`OCR merged total: ${mergedEntries.length} entries, processed ${totalProcessed}/${captionCrops.length}`);
      await supabase.from("meeting_analyses").delete()
        .eq("meeting_id", meetingId).eq("source", "captions-ocr");
      await saveAnalysis("captions-ocr", ocrResult);
      results.captions = ocrResult;
    }

    // ========== STEP 5: DESCRIBE SLIDES ==========
    if (selectedMode === "describe-slides") {
      console.log(`Step 5: Describe unique slides batch offset=${batchOffset} size=${batchSize}...`);

      // Check pdf-slides first (user-uploaded PDF), then fall back to crop-split (frame dedup)
      const pdfData = await loadLatest("pdf-slides") as any;
      const cropData = await loadLatest("crop-split") as any;
      const slideSource = pdfData?.unique_slides?.length ? pdfData : cropData;
      if (!slideSource?.unique_slides?.length) {
        throw { status: 400, message: "Upload a PDF or run crop-split first" };
      }

      const slides = cropData.unique_slides as { path: string; timestamp: number; ts_formatted: string }[];
      const currentBatchSize = Math.max(1, Math.min(batchSize, 8));
      const currentBatch = slides.slice(batchOffset, batchOffset + currentBatchSize);
      const previousResult = batchOffset > 0 ? await loadLatest("slide-descriptions") as any : null;

      if (currentBatch.length === 0) {
        throw { status: 400, message: "No slides left to describe" };
      }

      const imageParts: any[] = [];
      for (const slide of currentBatch) {
        const { data: blob } = await supabaseAdmin.storage.from("recordings").download(slide.path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const base64 = bytesToBase64(bytes);
        imageParts.push({ type: "text", text: `\n--- Slajd @ ${slide.ts_formatted} (pierwszy raz) ---` });
        imageParts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } });
      }

      if (imageParts.length === 0) {
        throw { status: 400, message: "Could not load slide frames for description" };
      }

      const describeParts: any[] = [
        {
          type: "text",
          text: `Jesteś ekspertem od analizy prezentacji. Poniżej ${currentBatch.length} unikalnych slajdów z jednego batcha nagrania spotkania.
Każdy slajd pojawił się po raz pierwszy w podanym timestampie.

## ZADANIE
Dla każdego dostarczonego slajdu:
1. Podaj **tytuł** slajdu
2. Opisz **pełną treść**: bullet pointy, dane liczbowe, wykresy, tabele, diagramy
3. Wyciągnij **kluczowe informacje** (liczby, nazwy, daty, wnioski)
4. Krótko opisz **kontekst** slajdu w prezentacji (np. "agenda", "wyniki Q1", "plan działań")

Kolejność: chronologicznie, zgodnie z timestampami. Zwróć tylko opisy dla dostarczonych slajdów.`,
        },
        ...imageParts,
      ];

      const descResult = await callAI(describeParts, [{
        type: "function",
        function: {
          name: "save_slide_descriptions",
          description: "Save detailed descriptions of unique presentation slides",
          parameters: {
            type: "object",
            properties: {
              slides: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timestamp: { type: "string", description: "MM:SS kiedy slajd pojawił się pierwszy raz" },
                    slide_title: { type: "string", description: "Tytuł slajdu" },
                    content: { type: "string", description: "Pełna treść slajdu: bullet pointy, dane, tabele" },
                    key_info: { type: "string", description: "Kluczowe informacje: liczby, wnioski" },
                    context: { type: "string", description: "Kontekst w prezentacji" },
                  },
                  required: ["timestamp", "slide_title", "content", "key_info", "context"],
                  additionalProperties: false,
                },
              },
              presentation_summary: { type: "string", description: "Krótkie podsumowanie batcha prezentacji" },
            },
            required: ["slides", "presentation_summary"],
            additionalProperties: false,
          },
        },
      }], { type: "function", function: { name: "save_slide_descriptions" } });

      const mergedSlides = [
        ...(previousResult?.slides ?? []),
        ...(descResult.slides ?? []),
      ];
      const mergedSummary = [
        previousResult?.presentation_summary,
        descResult.presentation_summary,
      ].filter(Boolean).join("\n\n");
      const totalProcessed = Math.min(batchOffset + currentBatch.length, slides.length);
      const hasMore = totalProcessed < slides.length;

      const mergedResult = {
        slides: mergedSlides,
        presentation_summary: mergedSummary,
        processed_slides: totalProcessed,
        slides_total: slides.length,
        has_more: hasMore,
        next_offset: hasMore ? totalProcessed : null,
      };

      console.log(`Described total ${mergedSlides.length} slides, processed ${totalProcessed}/${slides.length}`);
      await supabase.from("meeting_analyses").delete()
        .eq("meeting_id", meetingId).eq("source", "slide-descriptions");
      await saveAnalysis("slide-descriptions", mergedResult);
      results.slideDescriptions = mergedResult;
    }

    // ========== AGGREGATE (captions + audio + slides) ==========
    if (selectedMode === "aggregate") {
      console.log("Running AGGREGATION...");

      const captionSource = await loadLatest("captions-ocr") as any;
      if (!captionSource) {
        throw { status: 400, message: "Missing captions — run OCR captions first" };
      }

      const slideDescs = await loadLatest("slide-descriptions") as any;

      const { data: transcriptLines } = await supabase
        .from("transcript_lines")
        .select("timestamp, speaker, text, line_order")
        .eq("meeting_id", meetingId)
        .order("line_order", { ascending: true })
        .limit(500);

      const audioTranscript = transcriptLines && transcriptLines.length > 0
        ? transcriptLines.map(l => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n")
        : null;

      const slideDescText = slideDescs?.slides?.length > 0
        ? slideDescs.slides
            .map((s: any) => `[${s.timestamp}] 📊 ${s.slide_title}: ${s.content}`)
            .join("\n").slice(0, 15000)
        : null;

      const ocrEntries = captionSource.entries as any[] | undefined;
      const ocrDialogText = ocrEntries && ocrEntries.length > 0
        ? ocrEntries.map((e: any) => `[${e.timestamp}] ${e.speaker}: ${e.text}`).join("\n").slice(0, 15000)
        : captionSource.transcript?.slice(0, 15000) || "Brak";

      const aggregatePrompt = `Jesteś ekspertem od analizy spotkań. Masz dane z tego samego spotkania z dwóch niezależnych źródeł + opisy slajdów.

${audioTranscript ? `## ŹRÓDŁO 1 (BAZA): TRANSKRYPT AUDIO (Whisper/Gemini STT)
Timestampy są ciągłe od początku do końca nagrania.
${audioTranscript.slice(0, 20000)}` : "## ŹRÓDŁO 1: Brak transkryptu audio"}

## ŹRÓDŁO 2: DIALOGI OCR (odczytane z paska live captions na dole ekranu)
Timestampy odpowiadają momentom pojawienia się klatki.
${ocrDialogText}

${slideDescText ? `## ŹRÓDŁO 3: OPISY SLAJDÓW (treść prezentacji)
Każdy slajd podany z timestampem pierwszego pojawienia się.
${slideDescText}` : ""}

## ZADANIE — AGREGACJA LINIA PO LINII

Idź chronologicznie przez transkrypt audio (ŹRÓDŁO 1) i dla każdej linii:

1. **Znajdź odpowiednik w OCR** (ŹRÓDŁO 2) po zbliżonym timestampie (±30s tolerancji)
2. **Porównaj treść** obu wersji tej samej wypowiedzi:
   - Jeśli audio jest poprawne i zrozumiałe → zostaw audio bez zmian
   - Jeśli OCR ma lepszą/pełniejszą wersję → użyj wersji OCR
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
