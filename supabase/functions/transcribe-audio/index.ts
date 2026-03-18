import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { audioBase64, mimeType = "audio/mpeg", language = "pl", frames = [] } = await req.json();

    if (!audioBase64) {
      return new Response(JSON.stringify({ error: "audioBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // frames: optional array of { base64: string, timestamp: string }
    const hasFrames = Array.isArray(frames) && frames.length > 0;
    console.log(`Frames provided: ${hasFrames ? frames.length : 0}`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Check base64 size - Gemini supports up to ~20MB inline
    const estimatedBytes = (audioBase64.length * 3) / 4;
    const estimatedMB = estimatedBytes / (1024 * 1024);
    console.log(`Audio size: ~${estimatedMB.toFixed(1)} MB`);

    if (estimatedMB > 20) {
      return new Response(
        JSON.stringify({ error: "Plik audio za duży (max ~20 MB). Podziel nagranie na mniejsze części." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const languageName = language === "pl" ? "polski" : language === "en" ? "angielski" : language;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: (() => {
              const parts: any[] = [];

              const frameNote = hasFrames
                ? `\n- Masz również ${frames.length} klatek/slajdów z prezentacji — użyj ich jako kontekstu wizualnego do lepszego zrozumienia treści`
                : "";

              parts.push({
                type: "text",
                text: `Jesteś profesjonalnym transkrybentem. Dokonaj dokładnej transkrypcji poniższego nagrania audio.

Zasady:
- Język nagrania: ${languageName}
- Transkrybuj DOKŁADNIE to co słyszysz, nie streszczaj
- Rozpoznaj różnych mówców jeśli to możliwe (Mówca 1, Mówca 2, itd.)
- Dodaj znaczniki czasowe co ~30 sekund w formacie [MM:SS]
- Zachowaj naturalną interpunkcję
- Oznacz niezrozumiałe fragmenty jako [niezrozumiałe]
- Jeśli są dźwięki tła, zaznacz je w nawiasach kwadratowych np. [śmiech], [cisza]${frameNote}
${hasFrames ? `- Każdy slajd ma znacznik czasu — dopasuj treść slajdu do odpowiedniego momentu w transkrypcji
- Jeśli mówca omawia treść slajdu, zaznacz to w transkrypcji np. [slajd @ MM:SS]` : ""}

Zwróć transkrypcję jako strukturyzowane dane.`,
              });

              // Add audio
              parts.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${audioBase64}` },
              });

              // Add frame images as visual context
              if (hasFrames) {
                for (const frame of frames.slice(0, 10)) {
                  parts.push({ type: "text", text: `--- Slajd @ ${frame.timestamp || "?"} ---` });
                  parts.push({
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
                  });
                }
              }

              return parts;
            })(),
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_transcript",
              description: "Save the structured transcript of the audio recording",
              parameters: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        timestamp: { type: "string", description: "Timestamp in MM:SS format" },
                        speaker: { type: "string", description: "Speaker label e.g. Mówca 1" },
                        text: { type: "string", description: "Transcribed text" },
                      },
                      required: ["timestamp", "speaker", "text"],
                      additionalProperties: false,
                    },
                  },
                  full_text: { type: "string", description: "Full transcript as plain text" },
                  detected_language: { type: "string", description: "Detected language code" },
                  speakers_count: { type: "number", description: "Number of distinct speakers detected" },
                },
                required: ["lines", "full_text"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_transcript" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit — spróbuj za chwilę." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Brak kredytów AI." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: `AI error: ${response.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      // Fallback: try to extract text from message content
      const content = aiResult.choices?.[0]?.message?.content || "";
      return new Response(
        JSON.stringify({
          lines: [{ timestamp: "00:00", speaker: "Mówca", text: content }],
          full_text: content,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcript = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(transcript), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe-audio error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
