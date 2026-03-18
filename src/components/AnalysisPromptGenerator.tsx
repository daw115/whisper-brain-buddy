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

export default function AnalysisPromptGenerator({ meeting, recordingUrl, framesVersion = 0 }: Props) {
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [integratedTranscript, setIntegratedTranscript] = useState<string | null>(null);
  const [uniqueFrames, setUniqueFrames] = useState<FrameInfo[]>([]);
  const [showAllFrames, setShowAllFrames] = useState(false);

  useEffect(() => {
    loadData();
  }, [meeting.id, framesVersion]);

  async function loadData() {
    setLoading(true);
    await Promise.all([loadIntegratedTranscript(), loadUniqueFrames()]);
    setLoading(false);
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
          if (json.conversation_transcript || json.integrated_transcript) {
            setIntegratedTranscript(json.conversation_transcript || json.integrated_transcript);
            return;
          }
        }
      }
    } catch {}
  }

  async function loadUniqueFrames() {
    try {
      const { data } = await supabase
        .from("meeting_analyses")
        .select("analysis_json")
        .eq("meeting_id", meeting.id)
        .eq("source", "unique-frames")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data?.analysis_json) {
        setUniqueFrames([]);
        return;
      }

      const json = data.analysis_json as any;
      const framePaths = json.frames as { path: string; timestamp_formatted: string }[] | undefined;
      if (!framePaths?.length) {
        setUniqueFrames([]);
        return;
      }

      const loaded: FrameInfo[] = [];
      for (const f of framePaths) {
        const { data: urlData } = await supabase.storage
          .from("recordings")
          .createSignedUrl(f.path, 60 * 60);
        if (urlData?.signedUrl) {
          loaded.push({ path: f.path, url: urlData.signedUrl, timestamp: f.timestamp_formatted });
        }
      }
      setUniqueFrames(loaded);
    } catch {
      setUniqueFrames([]);
    }
  }

  function buildPrompt(): string {
    const hasIntegrated = !!integratedTranscript;

    return `Jesteś ekspertem AI do analizy spotkań biznesowych w systemie Cerebro.

## DANE WEJŚCIOWE
${hasIntegrated ? "- Zagregowana transkrypcja chronologiczna (dialogi uczestników połączone z audio przez AI)" : "- Brak zagregowanej transkrypcji — przeanalizuj załączone materiały"}
${uniqueFrames.length > 0 ? `- ${uniqueFrames.length} obrazów slajdów prezentacji (unikalne klatki)` : ""}

${hasIntegrated ? `## ZAGREGOWANA TRANSKRYPCJA
Poniższa transkrypcja łączy dialogi uczestników (odczytane z napisów live captions) z transkryptem audio w kolejności chronologicznej.

---
${integratedTranscript!.slice(0, 25000)}
---` : ""}

${uniqueFrames.length > 0 ? `## ZAŁĄCZONE OBRAZY SLAJDÓW
W archiwum ZIP znajduje się ${uniqueFrames.length} unikalnych obrazów slajdów prezentacji.
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
  "summary": "Kompletne podsumowanie 3-6 zdań po polsku.",
  "integrated_transcript": "ZINTEGROWANY chronologiczny zapis spotkania z wstawionymi slajdami.",
  "sentiment": "pozytywny | neutralny | negatywny | mieszany",
  "participants": ["Imię Nazwisko"],
  "tags": ["temat1", "temat2"],
  "key_quotes": ["Najważniejszy cytat"],
  "action_items": [{ "task": "Zadanie", "owner": "Osoba", "deadline": "YYYY-MM-DD lub null" }],
  "decisions": [{ "decision": "Decyzja", "rationale": "Uzasadnienie", "timestamp": "MM:SS" }],
  "slide_insights": [{
    "slide_timestamp": "MM:SS",
    "slide_title": "Tytuł slajdu",
    "slide_content": "Pełna treść ze slajdu",
    "discussion_context": "Co mówili uczestnicy",
    "extra_context": "Info z dialogu niewidoczne na slajdzie",
    "discrepancies": "Rozbieżności"
  }]
}

## ZASADY
1. Zidentyfikuj mówców po kontekście — użyj pełnych imion
2. Action items = konkretne zadania z właścicielem
3. Decisions = wyraźnie podjęte decyzje
4. Summary = zwięzłe, z danymi liczbowymi, po polsku
5. Tags = główne tematy (max 7)
6. Slide insights = SZCZEGÓŁOWA analiza KAŻDEGO slajdu z korelacją do dialogu
7. integrated_transcript = poprawiona wersja transkrypcji z wstawionymi slajdami`;
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

      toast.info("Pakuję prompt…");
      zip.file("prompt.txt", buildPrompt());

      if (integratedTranscript) {
        zip.file("transkrypcja_zagregowana.txt", integratedTranscript);
      }

      if (uniqueFrames.length > 0) {
        toast.info(`Pakuję ${uniqueFrames.length} unikalnych slajdów…`);
        const slidesFolder = zip.folder("slajdy");
        for (let i = 0; i < uniqueFrames.length; i++) {
          const frame = uniqueFrames[i];
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

  const hasIntegrated = !!integratedTranscript;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">
          Paczka danych ChatGPT
        </h2>
      </div>

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
              uniqueFrames.length > 0 ? `${uniqueFrames.length} slajdów` : null,
            ].filter(Boolean).join(" + ")})
          </>
        )}
      </button>

      {!hasIntegrated && !uniqueFrames.length && (
        <p className="text-[10px] text-muted-foreground/60 text-center">
          ⚠ Najpierw uruchom OCR (klatki + dialogi + agregacja) aby przygotować dane
        </p>
      )}

      <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
        <p className="text-xs font-medium text-primary mb-1">🤖 Użyj modelu: GPT-4o</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Rozpakuj ZIP i wgraj <strong>wszystkie pliki</strong> do <strong>chat.openai.com</strong> → <strong>GPT-4o</strong>.
          ChatGPT sam odczyta treść slajdów z obrazów.
        </p>
      </div>

      <div className="bg-muted/30 border border-border rounded-md p-3 space-y-1">
        <p className="text-[11px] font-medium text-foreground">📦 Zawartość paczki:</p>
        <ul className="text-[10px] text-muted-foreground space-y-0.5">
          <li className="flex items-center gap-1">
            <Check className="w-3 h-3 text-primary" />
            prompt.txt — instrukcja analizy
          </li>
          {hasIntegrated ? (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              transkrypcja_zagregowana.txt — dialogi chronologicznie
            </li>
          ) : (
            <li className="text-muted-foreground/60">✗ Brak zagregowanej transkrypcji — uruchom OCR</li>
          )}
          {uniqueFrames.length > 0 ? (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              {uniqueFrames.length} unikalnych slajdów prezentacji (ChatGPT zrobi OCR)
            </li>
          ) : (
            <li className="text-muted-foreground/60">✗ Brak slajdów — uruchom OCR</li>
          )}
        </ul>
      </div>

      {/* Frame thumbnails */}
      {uniqueFrames.length > 0 && (
        <div className="border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" />
              Slajdy w paczce
            </span>
            <span className="text-[10px] font-mono-data text-muted-foreground">
              {uniqueFrames.length} unikalnych
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(showAllFrames ? uniqueFrames : uniqueFrames.slice(0, 8)).map((frame, i) => (
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
          {uniqueFrames.length > 8 && (
            <button
              onClick={() => setShowAllFrames(!showAllFrames)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAllFrames ? "Pokaż mniej" : `Pokaż wszystkie (${uniqueFrames.length})`}
            </button>
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

      <div className="bg-muted/30 border border-border rounded-md p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" />
          Jak użyć:
        </p>
        <ol className="list-decimal list-inside space-y-1 text-[11px]">
          <li>Kliknij <strong>Pobierz ZIP</strong> powyżej</li>
          <li>Rozpakuj archiwum</li>
          <li>Otwórz <strong>chat.openai.com</strong> → model <strong>GPT-4o</strong></li>
          <li>Wgraj <strong>wszystkie pliki</strong> z folderu (prompt + transkrypcja + slajdy)</li>
          <li>ChatGPT sam odczyta slajdy z obrazów + przeanalizuje transkrypcję</li>
          <li>Wklej wynik JSON w sekcji <strong>"Importuj wynik analizy"</strong> poniżej</li>
        </ol>
      </div>
    </div>
  );
}
