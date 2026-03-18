import { useState, useRef } from "react";
import { FileAudio, Loader2, Wifi, WifiOff, Languages } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { TRANSCRIPTION_LANGUAGES, type TranscriptionLanguage } from "@/components/AudioExtractor";

interface Props {
  meetingId: string;
  recordingUrl: string;
  recordingFilename: string;
  onComplete?: () => void;
}

type Phase = "idle" | "converting" | "loading-model" | "transcribing" | "saving";

const phaseLabels: Record<Phase, string> = {
  idle: "",
  converting: "Konwersja audio…",
  "loading-model": "Pobieranie modelu Whisper…",
  transcribing: "Transkrypcja offline…",
  saving: "Zapisywanie…",
};

export default function TranscribeButton({ meetingId, recordingUrl, recordingFilename, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [convertProgress, setConvertProgress] = useState(0);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [mode, setMode] = useState<"offline" | "online">("offline");
  const [language, setLanguage] = useState<TranscriptionLanguage>("pl");
  const ffmpegRef = useRef<any>(null);

  async function convertToWav(): Promise<Float32Array> {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { fetchFile } = await import("@ffmpeg/util");

    if (!ffmpegRef.current) {
      const ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress: p }) => {
        setConvertProgress(Math.round(p * 100));
      });
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
      ffmpegRef.current = ffmpeg;
    }

    const ffmpeg = ffmpegRef.current;
    const videoData = await fetchFile(recordingUrl);
    await ffmpeg.writeFile("input.webm", videoData);

    // Convert to raw PCM f32le at 16kHz mono
    await ffmpeg.exec([
      "-i", "input.webm",
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      "-f", "f32le",
      "output.pcm",
    ]);

    const pcmData = await ffmpeg.readFile("output.pcm") as Uint8Array;
    await ffmpeg.deleteFile("input.webm");
    await ffmpeg.deleteFile("output.pcm");

    // Convert Uint8Array (raw bytes) to Float32Array
    return new Float32Array(pcmData.buffer);
  }

  async function handleOfflineTranscribe() {
    setPhase("converting");
    setConvertProgress(0);
    setTranscribeProgress(0);

    try {
      toast.loading("Konwersja audio…", { id: "transcribe" });

      const audioData = await convertToWav();
      const durationSec = audioData.length / 16000;
      console.log(`Audio: ${durationSec.toFixed(0)}s, ${(audioData.length * 4 / 1024 / 1024).toFixed(1)} MB PCM`);

      // Load Whisper model
      setPhase("loading-model");
      toast.loading("Ładowanie modelu Whisper (pierwsze uruchomienie pobierze ~50 MB)…", { id: "transcribe" });

      const { pipeline } = await import("@huggingface/transformers");

      const transcriber = await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-small",
        {
          dtype: "q4",
          device: "wasm",
        }
      );

      // Transcribe
      setPhase("transcribing");
      toast.loading("Transkrypcja offline w toku…", { id: "transcribe" });

      const result = await transcriber(audioData, {
        language: "polish",
        task: "transcribe",
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      console.log("Whisper result:", result);

      // Parse result into transcript lines
      const chunks = (result as any).chunks || [];
      let lines: { timestamp: string; speaker: string; text: string }[] = [];

      if (chunks.length > 0) {
        lines = chunks.map((chunk: any) => {
          const startSec = chunk.timestamp?.[0] || 0;
          const mins = Math.floor(startSec / 60);
          const secs = Math.floor(startSec % 60);
          return {
            timestamp: `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`,
            speaker: "Mówca",
            text: (chunk.text || "").trim(),
          };
        }).filter((l: any) => l.text.length > 0);
      } else {
        // Single text result
        const text = typeof result === "string" ? result : (result as any).text || "";
        if (text.trim()) {
          lines = [{ timestamp: "00:00", speaker: "Mówca", text: text.trim() }];
        }
      }

      if (lines.length === 0) {
        toast.warning("Nie rozpoznano mowy w nagraniu", { id: "transcribe" });
        return;
      }

      // Save to database
      await saveTranscript(lines);

      // Dispose model
      try {
        await (transcriber as any).dispose?.();
      } catch {}

    } catch (err: any) {
      console.error("Whisper transcribe error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"), { id: "transcribe" });
    } finally {
      setPhase("idle");
      setConvertProgress(0);
      setTranscribeProgress(0);
    }
  }

  async function handleOnlineTranscribe() {
    setPhase("converting");
    setConvertProgress(0);

    try {
      toast.loading("Konwersja do MP3…", { id: "transcribe" });

      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      if (!ffmpegRef.current) {
        const ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress: p }) => {
          setConvertProgress(Math.round(p * 100));
        });
        const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
        await ffmpeg.load({
          coreURL: `${baseURL}/ffmpeg-core.js`,
          wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });
        ffmpegRef.current = ffmpeg;
      }

      const ffmpeg = ffmpegRef.current;
      const videoData = await fetchFile(recordingUrl);
      await ffmpeg.writeFile("input.webm", videoData);

      await ffmpeg.exec(["-i", "input.webm", "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-f", "mp3", "output.mp3"]);

      const mp3Data = await ffmpeg.readFile("output.mp3") as Uint8Array;
      await ffmpeg.deleteFile("input.webm");
      await ffmpeg.deleteFile("output.mp3");

      const mp3SizeMB = mp3Data.length / (1024 * 1024);
      if (mp3SizeMB > 20) {
        toast.error("Plik MP3 za duży (>20 MB). Podziel nagranie na segmenty.", { id: "transcribe" });
        return;
      }

      setPhase("transcribing");
      toast.loading(`MP3 (${mp3SizeMB.toFixed(1)} MB) → Transkrypcja AI…`, { id: "transcribe" });

      const base64 = uint8ToBase64(mp3Data);
      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: { audioBase64: base64, mimeType: "audio/mpeg", language: "pl" },
      });

      if (error) throw new Error(error.message || "Błąd transkrypcji");
      if (data?.error) throw new Error(data.error);

      const lines = (data?.lines || []).map((l: any) => ({
        timestamp: l.timestamp || "00:00",
        speaker: l.speaker || "Mówca",
        text: l.text,
      }));

      if (lines.length === 0) {
        toast.warning("Nie rozpoznano mowy", { id: "transcribe" });
        return;
      }

      await saveTranscript(lines);
    } catch (err: any) {
      console.error("Online transcribe error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"), { id: "transcribe" });
    } finally {
      setPhase("idle");
      setConvertProgress(0);
    }
  }

  async function saveTranscript(lines: { timestamp: string; speaker: string; text: string }[]) {
    setPhase("saving");
    toast.loading("Zapisywanie transkryptu…", { id: "transcribe" });

    await supabase.from("transcript_lines").delete().eq("meeting_id", meetingId);

    const rows = lines.map((line, idx) => ({
      meeting_id: meetingId,
      timestamp: line.timestamp,
      speaker: line.speaker,
      text: line.text,
      line_order: idx,
    }));

    const { error: insertError } = await supabase.from("transcript_lines").insert(rows);
    if (insertError) throw insertError;

    const fullText = lines.map((l) => l.text).join(" ");
    if (fullText) {
      await supabase.from("meetings").update({ summary: fullText.slice(0, 500) }).eq("id", meetingId);
    }

    toast.success(`Transkrypcja zakończona — ${lines.length} fragmentów`, { id: "transcribe", duration: 5000 });
    onComplete?.();
  }

  function handleTranscribe() {
    if (mode === "offline") {
      handleOfflineTranscribe();
    } else {
      handleOnlineTranscribe();
    }
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode("offline")}
          disabled={busy}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
            mode === "offline"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <WifiOff className="w-3 h-3" />
          Offline (Whisper)
        </button>
        <button
          onClick={() => setMode("online")}
          disabled={busy}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
            mode === "online"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <Wifi className="w-3 h-3" />
          Online (Gemini)
        </button>
      </div>

      {mode === "offline" && !busy && (
        <p className="text-[10px] text-muted-foreground">
          Whisper small — działa w przeglądarce, bez wysyłania danych. Pierwsze uruchomienie pobierze model (~50 MB).
        </p>
      )}

      {busy && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground">
            {phaseLabels[phase]}
            {phase === "converting" && convertProgress > 0 && ` ${convertProgress}%`}
          </p>
          <Progress
            value={phase === "converting" ? convertProgress : undefined}
            className="h-1.5"
          />
        </div>
      )}

      <button
        onClick={handleTranscribe}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {phaseLabels[phase]}
          </>
        ) : (
          <>
            <FileAudio className="w-3.5 h-3.5" />
            Transkrybuj {mode === "offline" ? "(Whisper)" : "(AI)"}
          </>
        )}
      </button>
    </div>
  );
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
