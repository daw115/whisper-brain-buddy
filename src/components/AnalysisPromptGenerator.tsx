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

  useEffect(() => {
    loadFrames();
  }, [meeting.id, meeting.recording_filename, framesVersion]);

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

    const frameInfos: FrameInfo[] = [];
    for (const file of files) {
      const path = `${prefix}/${file.name}`;
      const { data } = await supabase.storage
        .from("recordings")
        .createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) {
        // Extract timestamp from filename: frame_0.jpg, frame_1.jpg etc.
        // or frame_0s.jpg, frame_30s.jpg pattern
        const matchSec = file.name.match(/frame_(\d+)s/);
        const matchIdx = file.name.match(/frame_(\d+)/);
        let timestamp = "0:00";
        if (matchSec) {
          const secs = parseInt(matchSec[1]);
          timestamp = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
        } else if (matchIdx) {
          // Guess interval from sorted file count & names
          const num = parseInt(matchIdx[1]);
          timestamp = `#${num}`;
        }
        frameInfos.push({ path, url: data.signedUrl, timestamp });
      }
    }

    setFrames(frameInfos);
    setLoading(false);
  }

  function buildPrompt(): string {
    const hasTranscript = meeting.transcript_lines && meeting.transcript_lines.length > 0;

    const transcriptSection = hasTranscript
      ? `TRANSKRYPT Z WEB SPEECH API (może zawierać błędy):
---
${meeting.transcript_lines!.map((l) => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n").slice(0, 12000)}
---`
      : `TRANSKRYPT: Brak automatycznego transkryptu. 
WAŻNE: Wgrano plik MP3 z nagraniem — najpierw go odsłuchaj i stranskrybuj, a potem przeanalizuj razem ze slajdami.`;

    const frameSection = frames.length > 0
      ? `\nZAŁĄCZONE OBRAZY: ${frames.length} klatek slajdów z prezentacji (co ~30s nagrania).
Przeanalizuj treść każdego slajdu — odczytaj tekst, dane liczbowe, wykresy, tabele.
Powiąż treść slajdów z rozmową.`
      : "";

    return `Przeanalizuj spotkanie biznesowe i zwróć wynik w formacie JSON.

DANE WEJŚCIOWE:
- Plik MP3 z nagraniem audio spotkania (wgrany jako załącznik)
${frames.length > 0 ? `- ${frames.length} zrzutów ekranu slajdów prezentacji (wgrane jako obrazy)` : ""}
${hasTranscript ? "- Automatyczny transkrypt z Web Speech API (poniżej)" : ""}

${transcriptSection}
${frameSection}

ZADANIA:
1. Odsłuchaj/przeanalizuj plik MP3 — stranskrybuj rozmowę
2. ${frames.length > 0 ? "Przeanalizuj treść slajdów — odczytaj tekst, dane, wykresy" : "Przeanalizuj treść rozmowy"}
3. ${frames.length > 0 ? "Powiąż kontekst rozmowy z odpowiednimi slajdami" : "Zidentyfikuj kluczowe tematy"}
4. Wyciągnij decyzje, zadania i podsumowanie

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
6. ${frames.length > 0 ? "Slide insights = analiza każdego slajdu i powiązanie z rozmową" : "Skup się na kluczowych wątkach rozmowy"}`;
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
      ffmpeg.on("progress", ({ progress: p }) => {
        // progress is available but we show indeterminate for simplicity
      });

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

  const step1Ready = !!mp3Url;
  const step2Ready = frames.length === 0 || true; // frames are always downloadable if present

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

      {/* Step 1: MP3 */}
      <div className="border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5" />
            Krok 1: Przygotuj MP3
          </span>
          {step1Ready && <Check className="w-3.5 h-3.5 text-primary" />}
        </div>

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
              {frames.slice(0, 8).map((frame, i) => (
                <div key={i} className="relative">
                  <img
                    src={frame.url}
                    alt={`Slajd @ ${frame.timestamp}`}
                    className="w-full aspect-video object-cover rounded border border-border"
                  />
                  <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono-data bg-background/80 px-0.5 rounded">
                    {frame.timestamp}
                  </span>
                </div>
              ))}
              {frames.length > 8 && (
                <div className="flex items-center justify-center aspect-video rounded border border-border bg-muted text-[10px] text-muted-foreground">
                  +{frames.length - 8}
                </div>
              )}
            </div>
            <button
              onClick={handleDownloadFrames}
              disabled={downloading}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Pobierz wszystkie klatki
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
          {buildPrompt().slice(0, 600)}…
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
          {recordingUrl && <li>Wgraj plik <strong>MP3</strong> (krok 1) jako załącznik</li>}
          {frames.length > 0 && <li>Wgraj <strong>klatki slajdów</strong> (krok 2) jako obrazy</li>}
          <li>Wklej <strong>prompt</strong> (krok 3) i wyślij</li>
          <li>Skopiuj wynikowy <strong>JSON</strong></li>
          <li>Wklej JSON w sekcji <strong>"Importuj wynik analizy"</strong> poniżej</li>
        </ol>
      </div>
    </div>
  );
}
