import { useState, useEffect } from "react";
import { Download, Copy, Check, ImageIcon, Loader2, FileText, Music, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { MeetingWithRelations } from "@/hooks/use-meetings";
import { toast } from "sonner";

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
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [convertingMp3, setConvertingMp3] = useState(false);
  const [mp3Url, setMp3Url] = useState<string | null>(null);
  const [mp3Size, setMp3Size] = useState<string | null>(null);
  const [showAllFrames, setShowAllFrames] = useState(false);

  useEffect(() => {
    loadFrames();
  }, [meeting.id, meeting.recording_filename, framesVersion]);

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

    // Scan for frames from main recording AND all segments
    const allFrameInfos: FrameInfo[] = [];
    const prefixes = [`${user.id}/frames/${stem}`];

    // Also look for segment frame folders: stem_part1, stem_part2, etc.
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
          // Add segment prefix for clarity
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

  function buildPrompt(): string {
    const transcriptLines = meeting.transcript_lines || [];
    const hasTranscript = transcriptLines.length > 0;

    // Check if transcript has multiple sources (segments)
    const speakers = new Set(transcriptLines.map((l) => l.speaker));
    const hasSegmentSources = [...speakers].some((s) => s.startsWith("Seg"));

    const transcriptSection = hasTranscript
      ? `TRANSKRYPT${hasSegmentSources ? " (z wielu segmentów, oznaczony źródłem)" : " (z Web Speech API, może zawierać błędy)"}:
---
${transcriptLines
  .sort((a, b) => a.line_order - b.line_order)
  .map((l) => `[${l.timestamp}] ${l.speaker}: ${l.text}`)
  .join("\n")
  .slice(0, 15000)}
---
${transcriptLines.length > 0 ? `\nŁącznie: ${transcriptLines.length} linii transkryptu` : ""}`
      : `TRANSKRYPT: Brak automatycznego transkryptu.
WAŻNE: Wgrano plik MP3 z nagraniem — najpierw go odsłuchaj i stranskrybuj, a potem przeanalizuj razem ze slajdami.`;

    const frameSection = frames.length > 0
      ? `\nZAŁĄCZONE OBRAZY: ${frames.length} klatek slajdów z prezentacji (z nagrania głównego i/lub segmentów).
Przeanalizuj treść każdego slajdu — odczytaj tekst, dane liczbowe, wykresy, tabele.
Powiąż treść slajdów z rozmową.`
      : "";

    return `Przeanalizuj spotkanie biznesowe i zwróć wynik w formacie JSON.

DANE WEJŚCIOWE:
${recordingUrl ? "- Plik MP3 z nagraniem audio spotkania (wgrany jako załącznik)" : ""}
${frames.length > 0 ? `- ${frames.length} zrzutów ekranu slajdów prezentacji (wgrane jako obrazy)` : ""}
${hasTranscript ? `- Transkrypt: ${transcriptLines.length} linii${hasSegmentSources ? " (z wielu segmentów nagrania, oznaczone Seg1, Seg2…)" : ""}` : ""}

${transcriptSection}
${frameSection}

ZADANIA:
1. ${hasTranscript ? "Przeanalizuj dostarczony transkrypt" : "Odsłuchaj/przeanalizuj plik MP3 — stranskrybuj rozmowę"}
${hasTranscript && recordingUrl ? "2. Jeśli wgrany jest też MP3 — odsłuchaj go i uzupełnij/zweryfikuj transkrypt" : ""}
${frames.length > 0 ? `${hasTranscript && recordingUrl ? "3" : "2"}. Przeanalizuj treść slajdów — odczytaj tekst, dane, wykresy` : ""}
${frames.length > 0 ? `${hasTranscript && recordingUrl ? "4" : "3"}. Powiąż kontekst rozmowy z odpowiednimi slajdami` : ""}
- Wyciągnij decyzje, zadania i podsumowanie

Zwróć DOKŁADNIE taki JSON (bez komentarzy, bez markdown):
{
  "summary": "Zwięzłe podsumowanie spotkania w 2-4 zdaniach po polsku",
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
  ]${frames.length > 0 ? `,
  "slide_insights": [
    {
      "slide_description": "Co jest na slajdzie",
      "context": "Jak slajd odnosi się do dyskusji",
      "key_data": "Kluczowe dane/wykresy/tabele"
    }
  ]` : ""}
}

ZASADY:
1. Zidentyfikuj mówców po głosie/kontekście
2. Action items = konkretne zadania z właścicielem
3. Decisions = wyraźnie podjęte decyzje
4. Summary = zwięzłe, po polsku
5. Tags = główne tematy (max 5)
${hasSegmentSources ? "6. Transkrypty z segmentów (Seg1, Seg2…) to części tego samego spotkania — potraktuj je jako ciągłą rozmowę" : ""}
${frames.length > 0 ? `${hasSegmentSources ? "7" : "6"}. Slide insights = analiza każdego slajdu i powiązanie z rozmową` : ""}`;
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
        Sprawdzam dane spotkania…
      </div>
    );
  }

  const transcriptLines = meeting.transcript_lines || [];
  const hasTranscript = transcriptLines.length > 0;
  const step1Ready = !!mp3Url;

  return (
    <div className="space-y-4">
      <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">
        Analiza w ChatGPT Plus
      </h2>

      {/* Model recommendation */}
      <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
        <p className="text-xs font-medium text-primary mb-1">🤖 Użyj modelu: GPT-4o</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          GPT-4o obsługuje audio (MP3) + obrazy (slajdy) w jednym czacie.
          Otwórz <strong>chat.openai.com</strong> → wybierz <strong>GPT-4o</strong> → załącz pliki.
        </p>
      </div>

      {/* Data summary */}
      <div className="bg-muted/30 border border-border rounded-md p-3 space-y-1">
        <p className="text-[11px] font-medium text-foreground">📊 Dostępne dane:</p>
        <ul className="text-[10px] text-muted-foreground space-y-0.5">
          {hasTranscript && (
            <li className="flex items-center gap-1">
              <Check className="w-3 h-3 text-primary" />
              Transkrypt: {transcriptLines.length} linii
              {[...new Set(transcriptLines.map((l) => l.speaker))].some((s) => s.startsWith("Seg")) && " (z wielu segmentów)"}
            </li>
          )}
          {!hasTranscript && (
            <li className="text-muted-foreground/60">✗ Brak transkryptu — wgraj MP3 do ChatGPT</li>
          )}
          {recordingUrl && <li className="flex items-center gap-1"><Check className="w-3 h-3 text-primary" /> Nagranie dostępne do konwersji MP3</li>}
          {frames.length > 0 && <li className="flex items-center gap-1"><Check className="w-3 h-3 text-primary" /> {frames.length} klatek slajdów</li>}
        </ul>
      </div>

      {/* Step 1: MP3 */}
      <div className="border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5" />
            Krok 1: Przygotuj MP3
          </span>
          {step1Ready && <Check className="w-3.5 h-3.5 text-primary" />}
        </div>

        {hasTranscript && !step1Ready && (
          <p className="text-[10px] text-muted-foreground/80 italic">
            Masz już transkrypt — MP3 jest opcjonalny (do weryfikacji przez ChatGPT).
          </p>
        )}

        {recordingUrl ? (
          mp3Url ? (
            <button
              onClick={downloadMp3}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Pobierz MP3 ({mp3Size} MB)
            </button>
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
          )
        ) : (
          <p className="text-[10px] text-muted-foreground italic">Brak nagrania</p>
        )}
      </div>

      {/* Step 2: Frames */}
      <div className="border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5" />
            Krok 2: Pobierz slajdy
          </span>
          {frames.length > 0 && <span className="text-[10px] font-mono-data text-muted-foreground">{frames.length} klatek</span>}
        </div>

        {frames.length > 0 ? (
          <>
            <div className="grid grid-cols-4 gap-1">
              {(showAllFrames ? frames : frames.slice(0, 8)).map((frame, i) => (
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
            {frames.length > 8 && (
              <button
                onClick={() => setShowAllFrames(!showAllFrames)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAllFrames ? "Pokaż mniej" : `Pokaż wszystkie (${frames.length})`}
              </button>
            )}
            <button
              onClick={handleDownloadFrames}
              disabled={downloading}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Pobierz wszystkie klatki ({frames.length})
            </button>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            Brak klatek slajdów. Zostaną przechwycone automatycznie podczas następnego nagrania.
          </p>
        )}
      </div>

      {/* Step 3: Prompt */}
      <div className="border border-border rounded-md overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
          <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Krok 3: Skopiuj prompt
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
          Jak użyć w ChatGPT Plus:
        </p>
        <ol className="list-decimal list-inside space-y-1 text-[11px]">
          <li>Otwórz <strong>chat.openai.com</strong> → model <strong>GPT-4o</strong></li>
          {recordingUrl && !hasTranscript && <li>Wgraj plik <strong>MP3</strong> (krok 1) jako załącznik</li>}
          {recordingUrl && hasTranscript && <li><em>(Opcjonalnie)</em> Wgraj <strong>MP3</strong> do weryfikacji transkryptu</li>}
          {frames.length > 0 && <li>Wgraj <strong>klatki slajdów</strong> (krok 2) jako obrazy</li>}
          <li>Wklej <strong>prompt</strong> (krok 3) — zawiera transkrypt{hasTranscript ? ` (${transcriptLines.length} linii)` : ""}</li>
          <li>Wyślij i poczekaj na wynik</li>
          <li>Skopiuj wynikowy <strong>JSON</strong></li>
          <li>Wklej JSON w sekcji <strong>"Importuj wynik analizy"</strong> poniżej</li>
        </ol>
        {hasTranscript && (
          <p className="text-[10px] text-primary/80 mt-1">
            💡 Transkrypt jest już wbudowany w prompt — ChatGPT go przeanalizuje bez potrzeby osobnego pliku.
          </p>
        )}
      </div>
    </div>
  );
}
