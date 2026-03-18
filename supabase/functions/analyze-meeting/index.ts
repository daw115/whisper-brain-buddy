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

    console.log(`Meeting: ${meeting.title}, recording: ${meeting.recording_filename}, user: ${meeting.user_id}`);

    // 2. Get frames from storage + deduplicate
    const frames: { base64: string; timestamp: string; mimeType: string }[] = [];
    if (meeting.recording_filename) {
      const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");
      console.log(`Looking for frames with stem: "${stem}"`);

      // Collect frames from main + segment directories
      const dirPrefixes = [`${meeting.user_id}/frames/${stem}`];
      
      const { data: allDirs, error: dirErr } = await supabaseAdmin.storage
        .from("recordings")
        .list(`${meeting.user_id}/frames`);
      
      console.log(`Dirs in frames/: ${allDirs?.length ?? 0} entries, error: ${dirErr?.message ?? 'none'}`);
      
      if (allDirs) {
        for (const d of allDirs) {
          console.log(`  dir entry: name="${d.name}", id=${d.id}`);
          // FIX: Don't require d.id — folders in Supabase Storage have id=null
          if (d.name.startsWith(stem + "_part")) {
            dirPrefixes.push(`${meeting.user_id}/frames/${d.name}`);
          }
        }
      }

      console.log(`Searching ${dirPrefixes.length} frame directories: ${dirPrefixes.map(p => p.split('/').pop()).join(', ')}`);

      const allFrameFiles: { path: string; timestamp: number }[] = [];
      for (const prefix of dirPrefixes) {
        const { data: files, error: listErr } = await supabaseAdmin.storage
          .from("recordings")
          .list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } });
        
        console.log(`  ${prefix.split('/').pop()}: ${files?.length ?? 0} files, error: ${listErr?.message ?? 'none'}`);
        
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
      console.log(`Found ${allFrameFiles.length} total frame files`);

      // Download and deduplicate frames using simple hash
      const seenHashes = new Set<string>();
      for (const ff of allFrameFiles.slice(0, 30)) {
        const { data } = await supabaseAdmin.storage
          .from("recordings")
          .download(ff.path);
        if (!data) {
          console.log(`  Failed to download: ${ff.path}`);
          continue;
        }

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
        const isJpeg = ff.path.match(/\.jpe?g$/i);
        const mimeType = isJpeg ? "image/jpeg" : "image/png";
        const secs = ff.timestamp;
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        frames.push({ base64, mimeType, timestamp: `${mins}:${String(s).padStart(2, "0")}` });

        if (frames.length >= 20) break;
      }
      console.log(`Loaded ${frames.length} unique frames (deduped from ${allFrameFiles.length})`);
    } else {
      console.log("No recording_filename — skipping frame loading");
    }

    // 3. Build transcript
    const transcriptLines = meeting.transcript_lines || [];
    const sorted = [...transcriptLines].sort((a: any, b: any) => a.line_order - b.line_order);
    const transcriptText = sorted.length > 0
      ? sorted.map((l: any) => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n")
      : "";

    const hasTranscript = transcriptText.length > 0;
    const hasSlides = frames.length > 0;

    console.log(`Analysis input: transcript=${hasTranscript} (${sorted.length} lines, ${transcriptText.length} chars), slides=${hasSlides} (${frames.length})`);

    // 4. Build multimodal content with improved prompt
    const contentParts: any[] = [];
    
    let contextDescription = "";
    if (hasTranscript && hasSlides) {
      contextDescription = `Masz do dyspozycji TRANSKRYPT rozmowy (${sorted.length} linii) oraz ${frames.length} SLAJDÓW z prezentacji.`;
    } else if (hasSlides) {
      contextDescription = `Masz do dyspozycji ${frames.length} SLAJDÓW z prezentacji (brak transkryptu — opisz zawartość wizualną).`;
    } else if (hasTranscript) {
      contextDescription = `Masz do dyspozycji TRANSKRYPT rozmowy (${sorted.length} linii, brak slajdów).`;
    } else {
      contextDescription = "Brak danych wejściowych.";
    }

    contentParts.push({
      type: "text",
      text: `Jesteś ekspertem AI do analizy spotkań biznesowych w systemie Cerebro.

${contextDescription}

## TWOJE ZADANIE

### 1. ANALIZA SLAJDÓW (jeśli dostępne)
Dla KAŻDEGO slajdu:
- Odczytaj CAŁĄ widoczną treść (tytuły, punkty, dane, wykresy, tabele)
- Zanotuj co dokładnie przedstawia slajd
- Powiąż go z odpowiednim fragmentem dyskusji na podstawie znacznika czasowego

### 2. KORELACJA SLAJD ↔ DIALOG
- Dopasuj każdy slajd do fragmentu transkryptu, który go omawia
- Wyciągnij CO mówili uczestnicy O danym slajdzie — ich komentarze, pytania, wątpliwości
- Zidentyfikuj dodatkowy kontekst z rozmowy, którego NIE MA na slajdach

### 3. PODSUMOWANIE
Napisz zwięzłe ale kompletne podsumowanie (3-6 zdań) obejmujące:
- Główny temat i cel spotkania
- Kluczowe ustalenia i decyzje
- Ważne dane liczbowe ze slajdów
- Wnioski i następne kroki

### 4. ZADANIA I DECYZJE
- Wyodrębnij KONKRETNE zadania do wykonania (kto, co, kiedy)
- Zapisz DECYZJE podjęte podczas spotkania z uzasadnieniem

${hasTranscript ? `## TRANSKRYPT:
---
${transcriptText.slice(0, 15000)}
---` : "## (Brak transkryptu)"}

${hasSlides ? `\nPoniżej ${frames.length} slajdów prezentacji w kolejności chronologicznej:` : ""}`,
    });

    for (const frame of frames) {
      contentParts.push({ type: "text", text: `\n--- Slajd @ ${frame.timestamp} ---` });
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` },
      });
    }

    if (!hasTranscript && !hasSlides) {
      return new Response(JSON.stringify({ error: "Brak danych do analizy — dodaj transkrypt lub wygeneruj klatki" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
            description: "Save structured meeting analysis with slide-dialogue correlation",
            parameters: {
              type: "object",
              properties: {
                summary: { 
                  type: "string", 
                  description: "Kompletne podsumowanie 3-6 zdań po polsku. Zawiera główny temat, kluczowe ustalenia, dane liczbowe ze slajdów i wnioski." 
                },
                sentiment: { 
                  type: "string", 
                  enum: ["pozytywny", "neutralny", "negatywny", "mieszany"] 
                },
                participants: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "Lista uczestników zidentyfikowanych z transkryptu"
                },
                tags: { 
                  type: "array", 
                  items: { type: "string" }, 
                  description: "3-7 tagów tematycznych" 
                },
                key_quotes: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "Najważniejsze cytaty z dyskusji (dokładne słowa uczestników)"
                },
                action_items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      task: { type: "string", description: "Konkretne zadanie do wykonania" },
                      owner: { type: "string", description: "Osoba odpowiedzialna" },
                      deadline: { type: "string", description: "Termin realizacji (jeśli podano)" },
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
                      decision: { type: "string", description: "Podjęta decyzja" },
                      rationale: { type: "string", description: "Uzasadnienie lub kontekst decyzji" },
                      timestamp: { type: "string", description: "Przybliżony moment podjęcia decyzji (MM:SS)" },
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
                      slide_timestamp: { type: "string", description: "Znacznik czasowy slajdu (MM:SS)" },
                      slide_content: { type: "string", description: "Pełna treść odczytana ze slajdu (tytuły, punkty, dane)" },
                      discussion_context: { type: "string", description: "Co mówili uczestnicy o tym slajdzie — komentarze, pytania, dodatkowy kontekst z dyskusji" },
                    },
                    required: ["slide_content"],
                    additionalProperties: false,
                  },
                  description: "Analiza każdego slajdu z korelacją do fragmentów dyskusji"
                },
              },
              required: ["summary", "sentiment", "tags", "action_items", "decisions", "slide_insights"],
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
      console.error("AI response without tool call:", JSON.stringify(aiResult).slice(0, 500));
      return new Response(JSON.stringify({ error: "AI did not return structured analysis" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const analysis = JSON.parse(toolCall.function.arguments);
    console.log(`Analysis result: summary=${analysis.summary?.length ?? 0} chars, actions=${analysis.action_items?.length ?? 0}, decisions=${analysis.decisions?.length ?? 0}, slides=${analysis.slide_insights?.length ?? 0}`);

    // 6. Save to meeting_analyses table
    await supabase.from("meeting_analyses").insert({
      meeting_id: meetingId,
      source: "gemini",
      analysis_json: analysis,
    });

    // 7. Update meeting summary + tags
    const updatePayload: any = {};
    if (analysis.summary) updatePayload.summary = analysis.summary;
    if (analysis.tags?.length) updatePayload.tags = analysis.tags;
    if (Object.keys(updatePayload).length > 0) {
      await supabase.from("meetings").update(updatePayload).eq("id", meetingId);
    }

    // 8. Save action items to dedicated table
    if (analysis.action_items?.length > 0) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const items = analysis.action_items.map((ai: any) => ({
          meeting_id: meetingId,
          user_id: user.id,
          task: ai.task,
          owner: ai.owner || "Nieprzypisane",
          deadline: ai.deadline || null,
        }));
        await supabase.from("action_items").insert(items);
      }
    }

    // 9. Save decisions to dedicated table
    if (analysis.decisions?.length > 0) {
      const decisionRows = analysis.decisions.map((d: any) => ({
        meeting_id: meetingId,
        decision: d.decision,
        rationale: d.rationale || null,
        timestamp: d.timestamp || null,
      }));
      await supabase.from("decisions").insert(decisionRows);
    }

    // 10. Save participants
    if (analysis.participants?.length > 0) {
      const existingParticipants = meeting.meeting_participants || [];
      const existingNames = new Set((existingParticipants as any[]).map((p: any) => p.name?.toLowerCase()));
      const newParticipants = analysis.participants
        .filter((name: string) => !existingNames.has(name.toLowerCase()))
        .map((name: string) => ({ meeting_id: meetingId, name }));
      if (newParticipants.length > 0) {
        await supabase.from("meeting_participants").insert(newParticipants);
      }
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
