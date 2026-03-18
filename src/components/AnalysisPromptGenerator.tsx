import { useState, useEffect, useMemo } from "react";
import { Download, Copy, Check, ImageIcon, Loader2, FileText, Package, Archive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { MeetingWithRelations } from "@/hooks/use-meetings";
import { toast } from "sonner";
import JSZip from "jszip";

interface Props {
  meeting: MeetingWithRelations;
  recordingUrl: string | null;
  framesVersion?: number;
}

interface FrameInfo {
  path: string;
  url: string;
  timestamp?: string;
}

interface SlideInfo {
  timestamp: string;
  title: string;
  full_text: string;
  slide_type?: string;
  data_values?: string;
}

export default function AnalysisPromptGenerator({ meeting, recordingUrl, framesVersion = 0 }: Props) {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showAllFrames, setShowAllFrames] = useState(false);
  const [slideTranscript, setSlideTranscript] = useState<string | null>(null);
  const [integratedTranscript, setIntegratedTranscript] = useState<string | null>(null);
  const [geminiSlides, setGeminiSlides] = useState<SlideInfo[]>([]);

  useEffect(() => {
    loadFrames();
    loadSlideTranscript();
    loadIntegratedTranscript();
  }, [meeting.id, meeting.recording_filename, framesVersion]);

  async function loadSlideTranscript() {
    try {
      const { data } = await supabase
        .from("meeting_analyses")
        .select("analysis_json")
        .eq("meeting_id", meeting.id)
        .eq("source", "slide-transcript")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.analysis_json) {
        const json = data.analysis_json as any;
        if (json.slide_transcript) {
          setSlideTranscript(json.slide_transcript);
        }
        if (json.slides && Array.isArray(json.slides)) {
          setGeminiSlides(json.slides);
        }
      }
    } catch {}
  }

  async function loadIntegratedTranscript() {
    try {
      for (const src of ["merged", "gemini"]) {
        const { data } = await supabase
          .from("meeting_analyses")
          .select("analysis_json")
          .eq("meeting_id", meeting.id)
          .eq("source", src)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.analysis_json) {
          const json = data.analysis_json as any;
          if (json.integrated_transcript) {
            setIntegratedTranscript(json.integrated_transcript);
            return;
          }
        }
      }
    } catch {}
  }

  async function loadFrames() {
    setLoading(true);
    setFrames([]);
    if (!meeting.recording_filename) {
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const stem = meeting.recording_filename.replace(/\.[^.]+$/, "");
    const allFrameInfos: FrameInfo[] = [];
    const prefixes = [`${user.id}/frames/${stem}`];

    const { data: frameDirs } = await supabase.storage
      .from("recordings")
      .list(`${user.id}/frames`, { limit: 200 });

    if (frameDirs) {
      for (const dir of frameDirs) {
        if (dir.name.startsWith(stem + "_part")) {
          prefixes.push(`${user.id}/frames/${dir.name}`);
        }
      }
    }

    for (const prefix of prefixes) {
      const { data: files } = await supabase.storage
        .from("recordings")
        .list(prefix, { limit: 100 });

      if (!files?.length) continue;

      for (const file of files) {
        const path = `${prefix}/${file.name}`;
        const { data } = await supabase.storage
          .from("recordings")
          .createSignedUrl(path, 60 * 60);
        if (data?.signedUrl) {
          const matchSec = file.name.match(/frame_(\d+)s/);
          const matchIdx = file.name.match(/frame_(\d+)/);
          let timestamp = "0:00";
          if (matchSec) {
            const secs = parseInt(matchSec[1]);
            timestamp = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
          } else if (matchIdx) {
            const num = parseInt(matchIdx[1]);
            timestamp = `#${num}`;
          }
          const segMatch = prefix.match(/_part(\d+)$/);
          if (segMatch) {
            timestamp = `S${segMatch[1]}/${timestamp}`;
          }
          allFrameInfos.push({ path, url: data.signedUrl, timestamp });
        }
      }
    }

    setFrames(allFrameInfos);
    setLoading(false);
  }

  // Filter frames to only those selected by Gemini slide-transcript
  const selectedFrames = useMemo(() => {
    if (geminiSlides.length === 0) return []; // no slides OCR = no frames to include

    // Build a set of normalized timestamps from Gemini slides
    const slideTimestamps = new Set<string>();
    for (const slide of geminiSlides) {
      const ts = slide.timestamp;
      slideTimestamps.add(ts);
      const noLeading = ts.replace(/^0+(\d+:)/, "$1");
      slideTimestamps.add(noLeading);
      const parts = ts.split(":");
      if (parts.length === 2) {
        const totalSec = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        slideTimestamps.add(`${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`);
      }
    }

    // Match frames whose timestamp matches slide timestamps
    const matched = frames.filter(f => {
      if (!f.timestamp) return false;
      const cleanTs = f.timestamp.replace(/^S\d+\//, "");
      return slideTimestamps.has(cleanTs);
    });

    return matched;
  }, [frames, geminiSlides]);

  function buildPrompt(): string {
    const hasIntegrated = !!integratedTranscript;

    return `Jesteś ekspertem AI do analizy spotkań biznesowych w systemie Cerebro.

## DANE WEJŚCIOWE
${hasIntegrated ? "- Zagregowana transkrypcja chronologiczna (dialogi uczestników + treść slajdów, połączone przez AI)" : "- Brak zagregowanej transkrypcji — przeanalizuj załączone materiały"}
${selectedFrames.length > 0 ? `- ${selectedFrames.length} obrazów slajdów prezentacji (wybrane unikalne slajdy)` : ""}

${hasIntegrated ? `## ZAGREGOWANA TRANSKRYPCJA
Poniższa transkrypcja łączy dialogi uczestników (odczytane z napisów na dole ekranu) z treścią slajdów (📊 SLAJD:) w kolejności chronologicznej. Została już zagregowana przez AI — traktuj ją jako wiarygodne źródło.

---
${integratedTranscript!.slice(0, 25000)}
---` : ""}

${selectedFrames.length > 0 ? `## ZAŁĄCZONE OBRAZY SLAJDÓW
W archiwum ZIP znajduje się ${selectedFrames.length} obrazów slajdów prezentacji.
Dla KAŻDEGO slajdu:
1. Odczytaj CAŁĄ treść: tytuły, bullet pointy, dane liczbowe, wykresy, tabele
2. Zweryfikuj dane z transkrypcji — wyłap szczegóły nieujęte w tekście
3. Powiąż treść slajdu z odpowiednim momentem dialogu` : ""}

## ZADANIA
1. Przeanalizuj przebieg spotkania na podstawie transkrypcji i slajdów
2. Dla KAŻDEGO slajdu: opisz treść, kontekst dyskusji, wnioski
3. Wyciągnij decyzje, zadania i podsumowanie
4. Zidentyfikuj rozbieżności między slajdami a dialogiem
5. Wyłap kontekst ukryty — informacje z dialogu których NIE MA na slajdach

## SZCZEGÓLNY NACISK NA
- **Analiza slajdów**: Każdy slajd = osobny insight z pełną treścią + kontekstem dialogu
- **Dane liczbowe**: WSZYSTKIE liczby, procenty, kwoty ze slajdów i dialogu
- **Rozbieżności**: Co mówiono innego niż jest na slajdach
- **Kontekst ukryty**: Decyzje ustne, komentarze, background niewidoczny na slajdach

## FORMAT WYNIKU
Zwróć DOKŁADNIE taki JSON (bez komentarzy, bez markdown):
{
  "summary": "Kompletne podsumowanie 3-6 zdań po polsku. Główny temat, kluczowe ustalenia, dane liczbowe, wnioski i następne kroki.",
  "integrated_transcript": "ZINTEGROWANY chronologiczny zapis spotkania. Format: [MM:SS] Mówca: tekst... oraz 📊 SLAJD: treść slajdu wstawiona w odpowiednie miejsca dialogu.",
  "sentiment": "pozytywny | neutralny | negatywny | mieszany",
  "participants": ["Imię Nazwisko uczestnika 1", "Imię Nazwisko uczestnika 2"],
  "tags": ["temat1", "temat2"],
  "key_quotes": ["Najważniejszy cytat — dokładne słowa uczestnika"],
  "action_items": [
    {
      "task": "Konkretne zadanie do wykonania",
      "owner": "Osoba odpowiedzialna",
      "deadline": "YYYY-MM-DD lub null"
    }
  ],
  "decisions": [
    {
      "decision": "Podjęta decyzja",
      "rationale": "Uzasadnienie lub kontekst",
      "timestamp": "MM:SS lub null"
    }
  ],
  "slide_insights": [
    {
      "slide_timestamp": "MM:SS",
      "slide_title": "Tytuł/nagłówek slajdu",
      "slide_content": "Pełna treść ze slajdu: tytuły, punkty, dane, wykresy, tabele",
      "discussion_context": "Co mówili uczestnicy o tym slajdzie — komentarze, pytania, wątpliwości",
      "extra_context": "Informacje z dialogu których NIE MA na slajdzie (uwagi, decyzje ustne, background)",
      "discrepancies": "Rozbieżności między slajdem a tym co powiedziano ustnie (jeśli są)"
    }
  ]
}

## ZASADY
1. Zidentyfikuj mówców po kontekście — użyj pełnych imion
2. Action items = konkretne zadania z właścicielem
3. Decisions = wyraźnie podjęte decyzje (nie domysły)
4. Summary = zwięzłe, z danymi liczbowymi, po polsku
5. Tags = główne tematy (max 7)
6. Slide insights = SZCZEGÓŁOWA analiza KAŻDEGO slajdu z korelacją do dialogu — to najważniejsza część!
7. integrated_transcript = poprawiona/wzbogacona wersja transkrypcji z wstawionymi slajdami`;
  }

  function handleCopy() {
    navigator.clipboard.writeText(buildPrompt());
    setCopied(true);
    toast.success("Prompt skopiowany do schowka");
    setTimeout(() => setCopied(false), 2000);
  }




  async function handleDownloadZip() {
    setDownloading(true);
    try {
      const zip = new JSZip();
      const safeTitle = meeting.title.replace(/[^a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]/g, "_").slice(0, 50);

      // 1. Add prompt.txt
      toast.info("Pakuję prompt…");
      zip.file("prompt.txt", buildPrompt());

      // 2. Add integrated transcript as separate file if available
      if (integratedTranscript) {
        zip.file("transkrypcja_zagregowana.txt", integratedTranscript);
      }

      // 3. Add selected slide images
      if (selectedFrames.length > 0) {
        toast.info(`Pakuję ${selectedFrames.length} slajdów…`);
        const slidesFolder = zip.folder("slajdy");
        for (let i = 0; i < selectedFrames.length; i++) {
          const frame = selectedFrames[i];
          try {
            const resp = await fetch(frame.url);
            const blob = await resp.blob();
            const ext = blob.type.includes("png") ? "png" : "jpg";
            const name = `slajd_${String(i + 1).padStart(2, "0")}_${frame.timestamp?.replace(/[:/]/g, "m") || i}.${ext}`;
            slidesFolder!.file(name, blob);
          } catch (err) {
            console.warn(`Failed to fetch frame ${i}:`, err);
          }
        }
      }

      // 4. Generate and download ZIP
      toast.info("Generuję archiwum ZIP…");
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = zipUrl;
      a.download = `${safeTitle}_paczka_GPT.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(zipUrl);

      const sizeMB = (zipBlob.size / (1024 * 1024)).toFixed(1);
      toast.success(`Paczka ZIP pobrana (${sizeMB} MB). Wgraj do ChatGPT GPT-4o.`);
    } catch (err: any) {
      console.error("ZIP error:", err);
      toast.error("Błąd tworzenia ZIP: " + (err.message || "nieznany"));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Sprawdzam dane spotkania…
      </div>
    );
  }

  const hasGeminiFilter = geminiSlides.length > 0 && selectedFrames.length < frames.length;
  const hasIntegrated = !!integratedTranscript;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">
          Paczka danych ChatGPT
        </h2>
      </div>

      {/* One-click ZIP download */}
      <button
        onClick={handleDownloadZip}
        disabled={downloading}
        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 press-effect"
      >
        {downloading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Pakuję ZIP…
          </>
        ) : (
          <>
            <Archive className="w-4 h-4" />
            Pobierz ZIP ({[
              "prompt",
              hasIntegrated ? "transkrypcja" : null,
              selectedFrames.length > 0 ? `${selectedFrames.length} slajdów` : null,
            ].filter(Boolean).join(" + ")})
          </>
        )}
      </button>

      {!hasIntegrated && !selectedFrames.length && (
        <p className="text-[10px] text-muted-foreground/60 text-center">
          ⚠ Najpierw uruchom OCR (dialogi + slajdy + agregacja) aby przygotować dane
        </p>
      )}

      {/* Model recommendation */}
      <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
        <p className="text-xs font-medium text-primary mb-1">🤖 Użyj modelu: GPT-4o</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Rozpakuj ZIP i wgraj <strong>wszystkie pliki</strong> do <strong>chat.openai.com</strong> → <strong>GPT-4o</strong>.
        </p>
      </div>

      {/* Data summary */}
      <div className="bg-muted/30 border border-border rounded-md p-3 space-y-1">
        <p className="text-[11px] font-medium text-foreground">📦 Zawartość paczki:</p>
        <ul className="text-[10px] text-muted-foreground space-y-0.5">
          <li className="flex items-center gap-1">
            <Check className="w-3 h-3 text-primary" />
            prompt.txt — instrukcja analizy (identyczna jak Gemini)
          </li>
          {hasIntegrated && (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              ✨ transkrypcja_zagregowana.txt — dialogi + slajdy chronologicznie
            </li>
          )}
          {!hasIntegrated && (
            <li className="text-muted-foreground/60">✗ Brak zagregowanej transkrypcji — uruchom OCR</li>
          )}
          {selectedFrames.length > 0 && (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              {selectedFrames.length} slajdów prezentacji
              {hasGeminiFilter && ` (z ${frames.length} klatek)`}
            </li>
          )}
          {selectedFrames.length === 0 && (
            <li className="text-muted-foreground/60">✗ Brak slajdów — uruchom OCR</li>
          )}
        </ul>
      </div>

      {/* Selected frames preview */}
      {selectedFrames.length > 0 && (
        <div className="border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" />
              Slajdy w paczce
            </span>
            <span className="text-[10px] font-mono-data text-muted-foreground">
              {selectedFrames.length}{hasGeminiFilter ? ` / ${frames.length}` : ""} klatek
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {(showAllFrames ? selectedFrames : selectedFrames.slice(0, 8)).map((frame, i) => (
              <div key={i} className="relative group">
                <img
                  src={frame.url}
                  alt={`Slajd @ ${frame.timestamp}`}
                  className="w-full aspect-video object-cover rounded border border-border"
                  loading="lazy"
                />
                <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono-data bg-background/80 px-0.5 rounded">
                  {frame.timestamp}
                </span>
              </div>
            ))}
          </div>
          {selectedFrames.length > 8 && (
            <button
              onClick={() => setShowAllFrames(!showAllFrames)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAllFrames ? "Pokaż mniej" : `Pokaż wszystkie (${selectedFrames.length})`}
            </button>
          )}
          {hasGeminiFilter && (
            <p className="text-[10px] text-primary/80">
              🎯 Gemini wybrała {selectedFrames.length} unikalnych slajdów z {frames.length} klatek
            </p>
          )}
        </div>
      )}

      {/* Prompt preview */}
      <div className="border border-border rounded-md overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
          <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Prompt (w ZIP)
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Skopiowano!" : "Kopiuj"}
          </button>
        </div>
        <pre className="p-3 text-[10px] leading-relaxed text-muted-foreground max-h-36 overflow-auto whitespace-pre-wrap font-mono-data">
          {buildPrompt().slice(0, 800)}…
        </pre>
      </div>

      {/* Instructions */}
      <div className="bg-muted/30 border border-border rounded-md p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" />
          Jak użyć:
        </p>
        <ol className="list-decimal list-inside space-y-1 text-[11px]">
          <li>Kliknij <strong>Pobierz ZIP</strong> powyżej</li>
          <li>Rozpakuj archiwum</li>
          <li>Otwórz <strong>chat.openai.com</strong> → model <strong>GPT-4o</strong></li>
          <li>Wgraj <strong>wszystkie pliki</strong> z rozpakowanego folderu (prompt + transkrypcja + slajdy)</li>
          <li>Wyślij i poczekaj na wynik JSON</li>
          <li>Wklej JSON w sekcji <strong>"Importuj wynik analizy"</strong> poniżej</li>
        </ol>
      </div>
    </div>
  );
}
