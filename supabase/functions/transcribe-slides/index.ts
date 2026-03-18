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

    console.log(`Loaded ${frames.length} unique frames for slide transcription`);

    // 4. Build Gemini request — extract text from slides
    const contentParts: any[] = [];
    contentParts.push({
      type: "text",
      text: `Jesteś ekspertem OCR do odczytu napisów/dialogów ze spotkań wideo.

Poniżej ${frames.length} klatek z nagrania spotkania biznesowego (np. Teams, Zoom). Każda klatka ma timestamp.

## CO CZYTAĆ
Na każdej klatce szukaj **napisów/subtitles/dialogów** — to tekst wyświetlany w **dolnej części ekranu**, zazwyczaj na **czarnym lub ciemnym tle** (pasek z napisami automatycznymi, live captions).

⚠️ IGNORUJ treść slajdów/prezentacji w głównej części ekranu — interesują nas TYLKO dialogi/napisy z paska na dole.
⚠️ Jeśli na klatce NIE MA napisów na dole — pomiń tę klatkę.

## ZADANIE
1. Odczytaj tekst z paska napisów na dole ekranu
2. Zidentyfikuj mówcę (jeśli widoczne imię/nazwa przed tekstem)
3. Połącz fragmenty z kolejnych klatek w spójne zdania (napisy często są ucięte)
4. Pomiń duplikaty — te same napisy pojawiają się na wielu klatkach

## FORMAT WYNIKU
Chronologiczna transkrypcja dialogów:
[MM:SS] Mówca: "Pełne zdanie odczytane z napisów"

Jeśli mówca nieznany, użyj "Uczestnik".
Łącz fragmenty napisów z kolejnych klatek w kompletne wypowiedzi.

Poniżej klatki:`,
    });

    for (const frame of frames) {
      contentParts.push({ type: "text", text: `\n--- Slajd @ ${frame.timestamp} ---` });
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` },
      });
    }

    // 5. Call Gemini
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: contentParts }],
        tools: [{
          type: "function",
          function: {
            name: "save_slide_transcript",
            description: "Save extracted slide transcript from presentation frames",
            parameters: {
              type: "object",
              properties: {
                slide_transcript: {
                  type: "string",
                  description: "Pełna transkrypcja wizualna slajdów w formacie chronologicznym. Każda pozycja na nowej linii: [MM:SS] 📊 SLAJD (typ): treść. Zawiera CAŁY tekst odczytany z każdego slajdu.",
                },
                slides: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      timestamp: { type: "string", description: "Timestamp MM:SS" },
                      slide_type: { type: "string", description: "Typ slajdu: tytułowy, agenda, dane, wykres, tabela, podsumowanie, etc." },
                      title: { type: "string", description: "Tytuł/nagłówek slajdu" },
                      full_text: { type: "string", description: "CAŁY tekst ze slajdu — bullet pointy, dane, opisy" },
                      data_values: { type: "string", description: "Kluczowe wartości liczbowe, wykresy, tabele (jeśli są)" },
                    },
                    required: ["timestamp", "title", "full_text"],
                    additionalProperties: false,
                  },
                  description: "Lista slajdów ze szczegółową treścią",
                },
                total_slides: {
                  type: "number",
                  description: "Łączna liczba unikalnych slajdów",
                },
              },
              required: ["slide_transcript", "slides", "total_slides"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_slide_transcript" } },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit — spróbuj za chwilę" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI error: ${response.status}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call in response:", JSON.stringify(aiResult).slice(0, 500));
      return new Response(JSON.stringify({ error: "AI did not return structured result" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);
    console.log(`Slide transcript: ${result.total_slides} slides, ${result.slide_transcript?.length ?? 0} chars`);

    // 6. Save as meeting_analyses with source "slide-transcript"
    // Delete previous slide-transcript if exists
    await supabase.from("meeting_analyses")
      .delete()
      .eq("meeting_id", meetingId)
      .eq("source", "slide-transcript");

    await supabase.from("meeting_analyses").insert({
      meeting_id: meetingId,
      source: "slide-transcript",
      analysis_json: result,
    });

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe-slides error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
