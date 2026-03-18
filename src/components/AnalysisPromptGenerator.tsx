import { useState, useEffect, useMemo } from "react";
import { Download, Copy, Check, ImageIcon, Loader2, FileText, Music, Package, Archive } from "lucide-react";
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
  const [convertingMp3, setConvertingMp3] = useState(false);
  const [mp3Url, setMp3Url] = useState<string | null>(null);
  const [mp3Size, setMp3Size] = useState<string | null>(null);
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
    if (geminiSlides.length === 0) return frames; // no filter if no slide analysis

    // Build a set of normalized timestamps from Gemini slides
    const slideTimestamps = new Set<string>();
    for (const slide of geminiSlides) {
      // Normalize: "01:30" -> "1:30", keep as-is too
      const ts = slide.timestamp;
      slideTimestamps.add(ts);
      // Also add without leading zero
      const noLeading = ts.replace(/^0+(\d+:)/, "$1");
      slideTimestamps.add(noLeading);
      // Convert MM:SS to total seconds for matching
      const parts = ts.split(":");
      if (parts.length === 2) {
        const totalSec = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        slideTimestamps.add(`${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`);
      }
    }

    // Match frames whose timestamp (possibly with segment prefix) matches
    const matched = frames.filter(f => {
      if (!f.timestamp) return false;
      // Strip segment prefix like "S1/" for matching
      const cleanTs = f.timestamp.replace(/^S\d+\//, "");
      return slideTimestamps.has(cleanTs);
    });

    // If matching yields very few results (< 30% of slides), fall back to all frames
    return matched.length >= Math.max(1, geminiSlides.length * 0.3) ? matched : frames;
  }, [frames, geminiSlides]);

  function buildPrompt(): string {
    const transcriptLines = meeting.transcript_lines || [];
    const hasTranscript = transcriptLines.length > 0;
    const hasIntegrated = !!integratedTranscript;

    const transcriptSection = hasIntegrated
      ? `ZAGREGOWANA TRANSKRYPCJA (audio + slajdy, chronologicznie):
---
${integratedTranscript!.slice(0, 20000)}
---
Powyższa transkrypcja łączy dialog uczestników z treścią slajdów (oznaczonych 📊 SLAJD:).
Została już zweryfikowana i skorygowana — traktuj ją jako główne źródło danych.`
      : hasTranscript
      ? `TRANSKRYPT AUDIO:
---
${transcriptLines
  .sort((a, b) => a.line_order - b.line_order)
  .map((l) => `[${l.timestamp}] ${l.speaker}: ${l.text}`)
  .join("\n")
  .slice(0, 15000)}
---`
      : `TRANSKRYPT: Brak automatycznego transkryptu.
WAŻNE: Wgrano plik MP3 z nagraniem — najpierw go odsłuchaj i stranskrybuj, a potem przeanalizuj razem ze slajdami.`;

    const frameSection = selectedFrames.length > 0
      ? `\nZAŁĄCZONE OBRAZY: ${selectedFrames.length} wybranych slajdów prezentacji (wyselekcjonowane przez AI).
Przeanalizuj treść każdego slajdu — odczytaj tekst, dane liczbowe, wykresy, tabele.
Powiąż treść slajdów z dialogiem w transkrypcji.`
      : "";

    return `Przeanalizuj spotkanie biznesowe i zwróć wynik w formacie JSON.

DANE WEJŚCIOWE:
${hasIntegrated ? "- Zagregowana transkrypcja (dialog + slajdy w jednym dokumencie chronologicznym)" : ""}
${!hasIntegrated && hasTranscript ? `- Transkrypt audio: ${transcriptLines.length} linii` : ""}
${recordingUrl ? "- Plik MP3 z nagraniem audio spotkania (wgrany jako załącznik)" : ""}
${selectedFrames.length > 0 ? `- ${selectedFrames.length} wyselekcjonowanych slajdów prezentacji (wgrane jako obrazy)` : ""}

${transcriptSection}
${frameSection}

ZADANIA:
1. Na podstawie transkrypcji${hasIntegrated ? " (która już łączy dialog z treścią slajdów)" : ""} przeanalizuj przebieg spotkania
${selectedFrames.length > 0 ? "2. Przeanalizuj załączone obrazy slajdów — zweryfikuj dane, odczytaj wykresy/tabele, wyłap szczegóły niejęte w transkrypcji" : ""}
${selectedFrames.length > 0 ? "3. Dla KAŻDEGO slajdu opisz: co zawiera, co mówiono w kontekście, jakie decyzje/wnioski wynikły" : ""}
- Wyciągnij decyzje, zadania i podsumowanie

SZCZEGÓLNY NACISK NA:
- **Analiza slajdów**: Każdy slajd = osobny insight z pełną treścią + kontekstem dialogu
- **Dane liczbowe**: Wyciągnij WSZYSTKIE liczby, procenty, kwoty ze slajdów i dialogu
- **Rozbieżności**: Co mówiono innego niż jest na slajdach
- **Kontekst ukryty**: Informacje z dialogu których NIE MA na slajdach (decyzje ustne, komentarze)

Zwróć DOKŁADNIE taki JSON (bez komentarzy, bez markdown):
{
  "summary": "Zwięzłe podsumowanie spotkania w 3-5 zdaniach po polsku, z kluczowymi danymi liczbowymi",
  "sentiment": "pozytywny | neutralny | negatywny | mieszany",
  "participants": ["Imię Nazwisko uczestnika 1", "Imię Nazwisko uczestnika 2"],
  "key_quotes": ["Najważniejszy cytat — Autor"],
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
  ]${selectedFrames.length > 0 ? `,
  "slide_insights": [
    {
      "slide_timestamp": "MM:SS",
      "slide_title": "Tytuł slajdu",
      "slide_content": "Pełna treść: tytuły, punkty, dane, wykresy",
      "discussion_context": "Co mówili uczestnicy o tym slajdzie",
      "extra_context": "Informacje z dialogu których NIE MA na slajdzie",
      "discrepancies": "Rozbieżności między slajdem a tym co powiedziano (jeśli są)"
    }
  ]` : ""}
}

ZASADY:
1. Zidentyfikuj mówców po kontekście
2. Action items = konkretne zadania z właścicielem
3. Decisions = wyraźnie podjęte decyzje
4. Summary = zwięzłe, z danymi liczbowymi, po polsku
5. Tags = główne tematy (max 7)
${selectedFrames.length > 0 ? "6. Slide insights = SZCZEGÓŁOWA analiza KAŻDEGO slajdu z korelacją do dialogu — to najważniejsza część!" : ""}`;
  }

  function handleCopy() {
    navigator.clipboard.writeText(buildPrompt());
    setCopied(true);
    toast.success("Prompt skopiowany do schowka");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleConvertMp3() {
    if (!recordingUrl) return;
    setConvertingMp3(true);

    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
        wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
      });

      toast.info("Pobieranie nagrania…");
      const videoData = await fetchFile(recordingUrl);
      await ffmpeg.writeFile("input.webm", videoData);

      toast.info("Konwersja do MP3… To może potrwać kilka minut.");
      await ffmpeg.exec(["-i", "input.webm", "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-f", "mp3", "output.mp3"]);

      const rawData = await ffmpeg.readFile("output.mp3");
      const blob = new Blob([rawData as any], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      setMp3Url(url);
      setMp3Size((blob.size / (1024 * 1024)).toFixed(1));

      await ffmpeg.deleteFile("input.webm");
      await ffmpeg.deleteFile("output.mp3");

      toast.success(`MP3 gotowy: ${(blob.size / (1024 * 1024)).toFixed(1)} MB`);
    } catch (err: any) {
      console.error("FFmpeg error:", err);
      toast.error("Błąd konwersji: " + (err.message || "nieznany"));
    } finally {
      setConvertingMp3(false);
    }
  }

  function downloadMp3() {
    if (!mp3Url) return;
    const a = document.createElement("a");
    a.href = mp3Url;
    a.download = (meeting.recording_filename || "recording").replace(/\.[^.]+$/, ".mp3");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleDownloadZip() {
    setDownloading(true);
    try {
      const zip = new JSZip();
      const safeTitle = meeting.title.replace(/[^a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]/g, "_").slice(0, 50);

      // 1. Add prompt.txt
      toast.info("Pakuję prompt…");
      zip.file("prompt.txt", buildPrompt());

      // 2. Add selected frames (fetch as blob)
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

      // 3. Add MP3 if ready
      if (mp3Url) {
        toast.info("Pakuję MP3…");
        const resp = await fetch(mp3Url);
        const blob = await resp.blob();
        const mp3Name = (meeting.recording_filename || "recording").replace(/\.[^.]+$/, ".mp3");
        zip.file(mp3Name, blob);
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

  const transcriptLines = meeting.transcript_lines || [];
  const hasTranscript = transcriptLines.length > 0;
  const hasGeminiFilter = geminiSlides.length > 0 && selectedFrames.length < frames.length;

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
        disabled={downloading || convertingMp3}
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
              selectedFrames.length > 0 ? `${selectedFrames.length} slajdów` : null,
              mp3Url ? "MP3" : null,
            ].filter(Boolean).join(" + ")})
          </>
        )}
      </button>
      <p className="text-[10px] text-muted-foreground text-center">
        Jeden plik ZIP: prompt.txt
        {selectedFrames.length > 0 ? ` + ${selectedFrames.length} slajdów${hasGeminiFilter ? " (wybrane przez Gemini)" : ""}` : ""}
        {mp3Url ? " + MP3" : ""}
        {!mp3Url && recordingUrl ? " (skonwertuj MP3 poniżej aby dodać)" : ""}
      </p>

      {/* Model recommendation */}
      <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
        <p className="text-xs font-medium text-primary mb-1">🤖 Użyj modelu: GPT-4o</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Rozpakuj ZIP i wgraj wszystkie pliki do <strong>chat.openai.com</strong> → <strong>GPT-4o</strong>.
        </p>
      </div>

      {/* Data summary */}
      <div className="bg-muted/30 border border-border rounded-md p-3 space-y-1">
        <p className="text-[11px] font-medium text-foreground">📊 Zawartość paczki:</p>
        <ul className="text-[10px] text-muted-foreground space-y-0.5">
          {integratedTranscript && (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              ✨ Zagregowana transkrypcja (audio + slajdy) — w prompcie
            </li>
          )}
          {!integratedTranscript && hasTranscript && (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              Transkrypt audio: {transcriptLines.length} linii — w prompcie
            </li>
          )}
          {!integratedTranscript && !hasTranscript && (
            <li className="text-muted-foreground/60">✗ Brak transkryptu — wgraj MP3 do ChatGPT</li>
          )}
          {selectedFrames.length > 0 && (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              {selectedFrames.length} slajdów
              {hasGeminiFilter && ` (z ${frames.length} klatek — wybrane przez Gemini)`}
            </li>
          )}
          {mp3Url && <li className="flex items-center gap-1"><Check className="w-3 h-3 text-primary" /> MP3 ({mp3Size} MB)</li>}
          {recordingUrl && !mp3Url && <li className="text-muted-foreground/60">⚠ MP3 nieskonwertowany — skonwertuj poniżej</li>}
        </ul>
      </div>

      {/* MP3 conversion */}
      {recordingUrl && (
        <div className="border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5" />
              Przygotuj MP3
            </span>
            {mp3Url && <Check className="w-3.5 h-3.5 text-primary" />}
          </div>

          {mp3Url ? (
            <p className="text-[10px] text-primary flex items-center gap-1">
              <Check className="w-3 h-3" /> MP3 gotowy ({mp3Size} MB) — zostanie dodany do ZIP
            </p>
          ) : (
            <button
              onClick={handleConvertMp3}
              disabled={convertingMp3}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {convertingMp3 ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Konwertuję…
                </>
              ) : (
                <>
                  <Music className="w-3.5 h-3.5" />
                  Konwertuj nagranie do MP3
                </>
              )}
            </button>
          )}
        </div>
      )}

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
          <li>Wgraj <strong>wszystkie pliki</strong> z rozpakowanego folderu</li>
          <li>Wyślij i poczekaj na wynik JSON</li>
          <li>Wklej JSON w sekcji <strong>"Importuj wynik analizy"</strong> poniżej</li>
        </ol>
      </div>
    </div>
  );
}
