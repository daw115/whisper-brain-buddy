import { useState, useEffect } from "react";
import { Download, Copy, Check, ImageIcon, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { MeetingWithRelations } from "@/hooks/use-meetings";
import { toast } from "sonner";

interface Props {
  meeting: MeetingWithRelations;
}

interface FrameInfo {
  path: string;
  url: string;
  timestamp?: string;
}

export default function AnalysisPromptGenerator({ meeting }: Props) {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadFrames();
  }, [meeting.id, meeting.recording_filename]);

  async function loadFrames() {
    if (!meeting.recording_filename) {
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");
    const prefix = `${user.id}/frames/${stem}`;

    const { data: files } = await supabase.storage
      .from("recordings")
      .list(`${user.id}/frames/${stem}`, { limit: 100 });

    if (!files?.length) {
      setLoading(false);
      return;
    }

    // Get signed URLs for all frames
    const frameInfos: FrameInfo[] = [];
    for (const file of files) {
      const path = `${prefix}/${file.name}`;
      const { data } = await supabase.storage
        .from("recordings")
        .createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) {
        // Extract frame number for timestamp estimation
        const match = file.name.match(/frame_(\d+)/);
        const num = match ? parseInt(match[1]) : 0;
        const secs = num * 30; // approximate
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        frameInfos.push({
          path,
          url: data.signedUrl,
          timestamp: `${mins}:${String(s).padStart(2, "0")}`,
        });
      }
    }

    setFrames(frameInfos);
    setLoading(false);
  }

  function buildPrompt(): string {
    const transcriptText = meeting.transcript_lines
      ?.map((l) => `[${l.timestamp}] ${l.speaker}: ${l.text}`)
      .join("\n") || "(brak transkryptu)";

    const slideNote = frames.length > 0
      ? `\n\nDODATKOWO: W załączeniu ${frames.length} zrzutów ekranu slajdów prezentowanych podczas spotkania. 
Przeanalizuj treść slajdów i powiąż je z dyskusją w transkrypcie. Odnieś się do konkretnych slajdów w podsumowaniu.`
      : "";

    return `Przeanalizuj poniższe spotkanie i zwróć wynik w formacie JSON.
${slideNote}

TRANSKRYPT:
---
${transcriptText.slice(0, 12000)}
---

Zwróć DOKŁADNIE taki JSON (bez komentarzy, bez markdown):
{
  "summary": "Zwięzłe podsumowanie spotkania w 2-4 zdaniach, odnoszące się zarówno do dyskusji jak i prezentowanych materiałów/slajdów",
  "sentiment": "pozytywny | neutralny | negatywny | mieszany",
  "participants": ["Imię Nazwisko uczestnika 1", "Imię Nazwisko uczestnika 2"],
  "key_quotes": [
    "Najważniejszy cytat ze spotkania - Autor"
  ],
  "tags": ["temat1", "temat2"],
  "action_items": [
    {
      "task": "Opis zadania do wykonania",
      "owner": "Osoba odpowiedzialna",
      "deadline": "YYYY-MM-DD lub null"
    }
  ],
  "decisions": [
    {
      "decision": "Podjęta decyzja",
      "rationale": "Uzasadnienie lub null",
      "timestamp": "MM:SS lub null"
    }
  ],
  "slide_insights": [
    {
      "slide_description": "Co jest na slajdzie",
      "context": "Jak slajd odnosi się do dyskusji",
      "key_data": "Kluczowe dane/wykresy/tabele ze slajdu"
    }
  ]
}

ZASADY:
1. Zidentyfikuj mówców po kontekście
2. Action items = konkretne zadania z właścicielem
3. Decisions = wyraźnie podjęte decyzje
4. Key quotes = najważniejsze wypowiedzi
5. Sentiment = ogólny ton spotkania
6. Tags = główne tematy (max 5)
7. Summary = zwięzłe, informacyjne, po polsku
8. Slide insights = analiza każdego slajdu i jego związku z rozmową
9. Jeśli na slajdach są dane liczbowe, wykresy lub tabele — wyciągnij kluczowe wartości`;
  }

  function handleCopy() {
    navigator.clipboard.writeText(buildPrompt());
    setCopied(true);
    toast.success("Prompt skopiowany do schowka");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownloadFrames() {
    setDownloading(true);
    try {
      for (const frame of frames) {
        const a = document.createElement("a");
        a.href = frame.url;
        a.download = frame.path.split("/").pop() || "frame.jpg";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Small delay between downloads
        await new Promise((r) => setTimeout(r, 300));
      }
      toast.success(`${frames.length} klatek pobranych`);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Sprawdzam klatki slajdów…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">
        Przygotuj analizę dla ChatGPT
      </h2>

      {/* Frames preview */}
      {frames.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" />
              {frames.length} klatek slajdów wykryto
            </p>
            <button
              onClick={handleDownloadFrames}
              disabled={downloading}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Pobierz klatki
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {frames.slice(0, 8).map((frame, i) => (
              <div key={i} className="relative group">
                <img
                  src={frame.url}
                  alt={`Slajd @ ${frame.timestamp}`}
                  className="w-full aspect-video object-cover rounded border border-border"
                />
                <span className="absolute bottom-0.5 right-0.5 text-[9px] font-mono-data bg-background/80 px-1 rounded">
                  {frame.timestamp}
                </span>
              </div>
            ))}
            {frames.length > 8 && (
              <div className="flex items-center justify-center aspect-video rounded border border-border bg-muted text-xs text-muted-foreground">
                +{frames.length - 8} więcej
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Brak klatek slajdów. Nagraj spotkanie, aby automatycznie przechwycić slajdy.
        </p>
      )}

      {/* Prompt section */}
      <div className="border border-border rounded-md">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
          <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Prompt do ChatGPT
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Skopiowano" : "Kopiuj prompt"}
          </button>
        </div>
        <pre className="p-3 text-[11px] leading-relaxed text-muted-foreground max-h-48 overflow-auto whitespace-pre-wrap font-mono-data">
          {buildPrompt().slice(0, 800)}…
        </pre>
      </div>

      {/* Instructions */}
      <div className="bg-muted/30 border border-border rounded-md p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">Jak użyć:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Skopiuj prompt (przycisk powyżej)</li>
          {frames.length > 0 && <li>Pobierz klatki slajdów i wrzuć je do ChatGPT jako obrazy</li>}
          <li>Wklej prompt do ChatGPT (model GPT-4o obsługuje obrazy)</li>
          <li>Skopiuj wynikowy JSON</li>
          <li>Wrzuć JSON przez stronę <strong>Batch Upload</strong> w Cerebro</li>
        </ol>
      </div>
    </div>
  );
}
