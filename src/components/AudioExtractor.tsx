import { useState, useRef, useEffect } from "react";
import { Music, Loader2, Scissors, Download, Play, Trash2, FileAudio, Languages, Wifi, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

export const TRANSCRIPTION_LANGUAGES = [
  { code: "pl", label: "Polski" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "uk", label: "Українська" },
  { code: "ru", label: "Русский" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "cs", label: "Čeština" },
] as const;

export type TranscriptionLanguage = typeof TRANSCRIPTION_LANGUAGES[number]["code"];

interface AudioSegment {
  name: string;
  path: string;
  signedUrl?: string;
  sizeMB: string;
}

interface Props {
  recordingUrl: string;
  recordingFilename: string;
  recordingSizeBytes?: number | null;
  meetingId: string;
  onAudioReady?: (segments: { url: string; name: string }[]) => void;
  onTranscriptGenerated?: () => void;
}

type Phase = "idle" | "downloading" | "converting" | "uploading" | "splitting" | "uploading-parts" | "batch-transcribing";

const phaseLabels: Record<Phase, string> = {
  idle: "",
  downloading: "Pobieranie nagrania…",
  converting: "Konwersja do MP3 (FFmpeg)…",
  uploading: "Przesyłanie MP3 na serwer…",
  splitting: "Dzielenie MP3 na części…",
  "uploading-parts": "Przesyłanie części…",
  "batch-transcribing": "Transkrypcja segmentów…",
};

export default function AudioExtractor({
  recordingUrl,
  recordingFilename,
  recordingSizeBytes,
  meetingId,
  onAudioReady,
  onTranscriptGenerated,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [mainAudio, setMainAudio] = useState<{ url: string; sizeMB: string } | null>(null);
  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(true);
  const [chunkMB, setChunkMB] = useState(20);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [splitProgress, setSplitProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [language, setLanguage] = useState<TranscriptionLanguage>("pl");
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [transcribeMode, setTranscribeMode] = useState<"online" | "offline">("online");
  const ffmpegRef = useRef<any>(null);

  const stem = recordingFilename.replace(/\.[^.]+$/, "");
  const mp3Filename = `${stem}.mp3`;

  // Check if MP3 already exists on server
  useEffect(() => {
    checkExistingAudio();
  }, [recordingFilename]);

  async function checkExistingAudio() {
    setLoadingSegments(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check main MP3
      const mainPath = `${user.id}/audio/${mp3Filename}`;
      const { data: mainFile } = await supabase.storage
        .from("recordings")
        .createSignedUrl(mainPath, 3600);

      if (mainFile?.signedUrl) {
        // Get size via list
        const { data: list } = await supabase.storage
          .from("recordings")
          .list(`${user.id}/audio`, { search: mp3Filename });
        const fileInfo = list?.find((f) => f.name === mp3Filename);
        const sizeMB = fileInfo?.metadata?.size
          ? (fileInfo.metadata.size / (1024 * 1024)).toFixed(1)
          : "?";
        setMainAudio({ url: mainFile.signedUrl, sizeMB });
      }

      // Check audio segments
      await loadAudioSegments(user.id);
    } catch (err) {
      console.error("Check audio error:", err);
    } finally {
      setLoadingSegments(false);
    }
  }

  async function loadAudioSegments(userId: string) {
    const prefix = `${userId}/audio`;
    const { data: files } = await supabase.storage
      .from("recordings")
      .list(prefix);

    if (!files) return;

    const partFiles = files
      .filter((f) => f.name.startsWith(stem + "_part") && f.name.endsWith(".mp3"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (partFiles.length === 0) {
      setAudioSegments([]);
      return;
    }

    const segs: AudioSegment[] = [];
    for (const f of partFiles) {
      const path = `${prefix}/${f.name}`;
      const { data } = await supabase.storage
        .from("recordings")
        .createSignedUrl(path, 3600);
      segs.push({
        name: f.name,
        path,
        signedUrl: data?.signedUrl,
        sizeMB: f.metadata?.size
          ? (f.metadata.size / (1024 * 1024)).toFixed(1)
          : "?",
      });
    }
    setAudioSegments(segs);
  }

  async function getFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress: p }) => {
      setProgress(Math.round(p * 100));
    });
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }

  async function handleExtractAudio() {
    setPhase("downloading");
    setProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      // 1. Download video
      toast.loading("Pobieranie nagrania…", { id: "audio-extract" });
      const res = await fetch(recordingUrl);
      const videoBlob = await res.blob();
      const videoBytes = new Uint8Array(await videoBlob.arrayBuffer());

      // 2. Convert to MP3
      setPhase("converting");
      toast.loading("Konwersja do MP3…", { id: "audio-extract" });
      const ffmpeg = await getFFmpeg();

      await ffmpeg.writeFile("input.webm", videoBytes);
      await ffmpeg.exec([
        "-i", "input.webm",
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "64k",
        "-f", "mp3",
        "output.mp3",
      ]);

      const mp3Data = await ffmpeg.readFile("output.mp3");
      const mp3Blob = new Blob([mp3Data], { type: "audio/mpeg" });

      await ffmpeg.deleteFile("input.webm");
      await ffmpeg.deleteFile("output.mp3");

      // 3. Upload to storage
      setPhase("uploading");
      toast.loading("Przesyłanie MP3 na serwer…", { id: "audio-extract" });

      const path = `${user.id}/audio/${mp3Filename}`;
      const { error } = await supabase.storage
        .from("recordings")
        .upload(path, mp3Blob, { contentType: "audio/mpeg", upsert: true });

      if (error) throw error;

      const { data: signedData } = await supabase.storage
        .from("recordings")
        .createSignedUrl(path, 3600);

      const sizeMB = (mp3Blob.size / (1024 * 1024)).toFixed(1);
      setMainAudio({ url: signedData?.signedUrl || "", sizeMB });

      toast.success(`Audio wyodrębnione! MP3: ${sizeMB} MB`, { id: "audio-extract" });
    } catch (err: any) {
      console.error("Extract audio error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"), { id: "audio-extract" });
    } finally {
      setPhase("idle");
      setProgress(0);
    }
  }

  async function handleSplitAudio() {
    if (!mainAudio?.url) return;

    setPhase("splitting");
    setSplitProgress({ current: 0, total: 0, percent: 0 });

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      toast.loading("Pobieranie MP3…", { id: "audio-split" });
      const res = await fetch(mainAudio.url);
      const mp3Blob = await res.blob();
      const mp3Bytes = new Uint8Array(await mp3Blob.arrayBuffer());

      const ffmpeg = await getFFmpeg();
      await ffmpeg.writeFile("main.mp3", mp3Bytes);

      // Get duration
      let durationSec = 0;
      const logHandler = ({ message }: { message: string }) => {
        const match = message.match(/Duration:\s+(\d+):(\d+):(\d+)\.(\d+)/);
        if (match) {
          durationSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
        }
      };
      ffmpeg.on("log", logHandler);
      await ffmpeg.exec(["-i", "main.mp3", "-f", "null", "-t", "0", "/dev/null"]).catch(() => {});

      if (durationSec <= 0) {
        durationSec = mp3Blob.size / (8 * 1024); // ~64kbps estimate
        if (durationSec < 10) durationSec = 60;
      }

      const chunkBytes = chunkMB * 1024 * 1024;
      const bytesPerSec = mp3Blob.size / durationSec;
      const segDuration = Math.max(10, Math.floor(chunkBytes / bytesPerSec));
      const totalParts = Math.ceil(durationSec / segDuration);

      if (totalParts <= 1) {
        toast.info("Plik MP3 jest mniejszy niż zadany rozmiar — nie wymaga podziału", { id: "audio-split" });
        setPhase("idle");
        return;
      }

      toast.loading(`Dzielenie na ~${totalParts} części…`, { id: "audio-split" });

      await ffmpeg.exec([
        "-i", "main.mp3",
        "-c", "copy",
        "-f", "segment",
        "-segment_time", String(segDuration),
        "-reset_timestamps", "1",
        "chunk_%03d.mp3",
      ]);

      // Read parts
      const parts: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < 999; i++) {
        const chunkName = `chunk_${String(i).padStart(3, "0")}.mp3`;
        try {
          const data = await ffmpeg.readFile(chunkName) as Uint8Array;
          if (data.length > 0) parts.push({ name: chunkName, data });
        } catch {
          break;
        }
      }

      // Upload parts
      setPhase("uploading-parts");
      setSplitProgress({ current: 0, total: parts.length, percent: 0 });

      for (let i = 0; i < parts.length; i++) {
        const partName = `${stem}_part${i + 1}.mp3`;
        const path = `${user.id}/audio/${partName}`;
        const partBlob = new Blob([new Uint8Array(parts[i].data)], { type: "audio/mpeg" });

        toast.loading(`Przesyłanie części ${i + 1}/${parts.length}…`, { id: "audio-split" });

        await supabase.storage
          .from("recordings")
          .upload(path, partBlob, { contentType: "audio/mpeg", upsert: true });

        setSplitProgress({
          current: i + 1,
          total: parts.length,
          percent: Math.round(((i + 1) / parts.length) * 100),
        });
      }

      // Cleanup FFmpeg FS
      try {
        await ffmpeg.deleteFile("main.mp3");
        for (const p of parts) await ffmpeg.deleteFile(p.name).catch(() => {});
      } catch {}

      toast.success(`Podzielono na ${parts.length} części MP3`, { id: "audio-split", duration: 5000 });
      await loadAudioSegments(user.id);
    } catch (err: any) {
      console.error("Split audio error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"), { id: "audio-split" });
    } finally {
      setPhase("idle");
      setSplitProgress({ current: 0, total: 0, percent: 0 });
    }
  }

  async function handleDeleteSegments() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const paths = audioSegments.map((s) => s.path);
      if (paths.length === 0) return;
      await supabase.storage.from("recordings").remove(paths);
      setAudioSegments([]);
      toast.success("Usunięto segmenty audio");
    } catch (err: any) {
      toast.error("Błąd usuwania: " + err.message);
    }
  }

  async function handleBatchTranscribe() {
    const segsWithUrl = audioSegments.filter((s) => s.signedUrl);
    if (segsWithUrl.length === 0) {
      toast.info("Brak segmentów audio do transkrypcji");
      return;
    }

    setPhase("batch-transcribing");
    setBatchProgress({ current: 0, total: segsWithUrl.length });

    // First delete existing transcript lines for this meeting
    await supabase.from("transcript_lines").delete().eq("meeting_id", meetingId);

    let allLines: { timestamp: string; speaker: string; text: string }[] = [];
    let globalLineOrder = 0;

    for (let i = 0; i < segsWithUrl.length; i++) {
      const seg = segsWithUrl[i];
      setBatchProgress({ current: i + 1, total: segsWithUrl.length });
      toast.loading(`Transkrypcja segmentu ${i + 1}/${segsWithUrl.length}…`, { id: "batch-transcribe" });

      try {
        // Download segment and convert to base64
        const res = await fetch(seg.signedUrl!);
        const blob = await res.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());

        const sizeMB = bytes.length / (1024 * 1024);
        if (sizeMB > 20) {
          toast.warning(`Segment ${i + 1} za duży (${sizeMB.toFixed(1)} MB) — pominięto`, { id: "batch-transcribe" });
          continue;
        }

        const base64 = uint8ToBase64(bytes);

        const { data, error } = await supabase.functions.invoke("transcribe-audio", {
          body: { audioBase64: base64, mimeType: "audio/mpeg", language },
        });

        if (error) {
          console.error(`Segment ${i + 1} error:`, error);
          toast.warning(`Segment ${i + 1}: ${error.message || "błąd"}`, { id: "batch-transcribe" });
          continue;
        }
        if (data?.error) {
          console.error(`Segment ${i + 1} AI error:`, data.error);
          toast.warning(`Segment ${i + 1}: ${data.error}`, { id: "batch-transcribe" });
          continue;
        }

        const lines = (data?.lines || []).map((l: any) => ({
          timestamp: l.timestamp || "00:00",
          speaker: l.speaker || "Mówca",
          text: l.text,
        })).filter((l: any) => l.text?.trim());

        // Save lines to DB immediately
        if (lines.length > 0) {
          const rows = lines.map((line: any) => ({
            meeting_id: meetingId,
            timestamp: line.timestamp,
            speaker: line.speaker,
            text: line.text,
            line_order: globalLineOrder++,
          }));

          const { error: insertError } = await supabase.from("transcript_lines").insert(rows);
          if (insertError) {
            console.error(`Segment ${i + 1} insert error:`, insertError);
          }
          allLines.push(...lines);
        }

        // Small delay to avoid rate limiting
        if (i < segsWithUrl.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err: any) {
        console.error(`Segment ${i + 1} exception:`, err);
        toast.warning(`Segment ${i + 1}: ${err.message || "błąd"}`, { id: "batch-transcribe" });
      }
    }

    // Update meeting summary
    if (allLines.length > 0) {
      const fullText = allLines.map((l) => l.text).join(" ");
      await supabase.from("meetings").update({ summary: fullText.slice(0, 500) }).eq("id", meetingId);
    }

    setPhase("idle");
    setBatchProgress({ current: 0, total: 0 });

    if (allLines.length > 0) {
      toast.success(`Transkrypcja zakończona — ${allLines.length} fragmentów z ${segsWithUrl.length} segmentów`, {
        id: "batch-transcribe",
        duration: 5000,
      });
      onTranscriptGenerated?.();
    } else {
      toast.warning("Nie udało się transkrybować żadnego segmentu", { id: "batch-transcribe" });
    }
  }

  const busy = phase !== "idle";
  const totalMB = recordingSizeBytes ? Math.round(recordingSizeBytes / (1024 * 1024)) : null;
  // Rough MP3 estimate: 64kbps audio from video => ~8KB/s => totalMB * ratio
  const estimatedMp3MB = totalMB ? Math.max(1, Math.round(totalMB * 0.05)) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider flex items-center gap-1.5">
          <FileAudio className="w-3.5 h-3.5" />
          Audio (MP3)
        </h3>
        <div className="flex items-center gap-1.5">
          <Languages className="w-3 h-3 text-muted-foreground" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as TranscriptionLanguage)}
            disabled={busy}
            className="text-[10px] bg-muted/50 border border-border rounded px-1.5 py-0.5 text-foreground"
          >
            {TRANSCRIPTION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main MP3 */}
      {mainAudio ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-primary font-medium">✓ {mp3Filename}</span>
            <span className="text-muted-foreground font-mono-data">{mainAudio.sizeMB} MB</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={mainAudio.url}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  const r = await fetch(mainAudio.url);
                  const b = await r.blob();
                  const url = URL.createObjectURL(b);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = mp3Filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch {
                  window.open(mainAudio.url, "_blank");
                }
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Download className="w-3 h-3" /> Pobierz
            </a>
            <button
              onClick={() => {
                const audio = new Audio(mainAudio.url);
                audio.play();
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Play className="w-3 h-3" /> Odtwórz
            </button>
          </div>

          {/* Split controls */}
          <div className="pt-2 border-t border-border space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Scissors className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Podziel MP3 na części po:</span>
              <input
                type="number"
                min={1}
                max={100}
                value={chunkMB}
                onChange={(e) => {
                  const n = parseInt(e.target.value);
                  if (n >= 1 && n <= 100) setChunkMB(n);
                }}
                disabled={busy}
                className="w-14 text-xs bg-muted/50 border border-border rounded px-2 py-0.5 text-foreground text-center"
              />
              <span className="text-[10px] text-muted-foreground">MB</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {[5, 10, 20, 50].map((v) => (
                <button
                  key={v}
                  onClick={() => setChunkMB(v)}
                  disabled={busy}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    chunkMB === v
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v} MB
                </button>
              ))}
            </div>
            <button
              onClick={handleSplitAudio}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {phase === "splitting" || phase === "uploading-parts" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {phaseLabels[phase]}
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  Podziel MP3
                </>
              )}
            </button>
          </div>

          {/* Split progress */}
          {(phase === "splitting" || phase === "uploading-parts") && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{phaseLabels[phase]} {splitProgress.total > 0 && `(${splitProgress.current}/${splitProgress.total})`}</span>
                {splitProgress.total > 0 && <span className="font-mono-data">{splitProgress.percent}%</span>}
              </div>
              <Progress value={splitProgress.total > 0 ? splitProgress.percent : undefined} className="h-1.5" />
            </div>
          )}

          {/* Audio segments list */}
          {audioSegments.length > 0 && (
            <div className="pt-2 border-t border-border space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-muted-foreground font-mono-data tracking-wider">
                  Segmenty audio ({audioSegments.length})
                </span>
                <button
                  onClick={handleDeleteSegments}
                  className="flex items-center gap-1 text-[10px] text-destructive hover:text-destructive/80 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Usuń
                </button>
              </div>
              {audioSegments.map((seg, idx) => (
                <div key={seg.name} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground font-mono-data w-5 text-right">{idx + 1}.</span>
                  <span className="text-foreground truncate flex-1">{seg.name}</span>
                  <span className="text-muted-foreground font-mono-data">{seg.sizeMB} MB</span>
                  {seg.signedUrl && (
                    <>
                      <button
                        onClick={() => {
                          if (playingIdx === idx) {
                            setPlayingIdx(null);
                          } else {
                            const audio = new Audio(seg.signedUrl);
                            audio.play();
                            setPlayingIdx(idx);
                            audio.onended = () => setPlayingIdx(null);
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <a
                        href={seg.signedUrl}
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            const r = await fetch(seg.signedUrl!);
                            const b = await r.blob();
                            const url = URL.createObjectURL(b);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = seg.name;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } catch {
                            window.open(seg.signedUrl!, "_blank");
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    </>
                  )}
                </div>
              ))}

              {/* Batch transcribe button */}
              <div className="pt-2 border-t border-border">
                <button
                  onClick={handleBatchTranscribe}
                  disabled={busy}
                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                >
                  {phase === "batch-transcribing" ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Transkrypcja {batchProgress.current}/{batchProgress.total}…
                    </>
                  ) : (
                    <>
                      <FileAudio className="w-3.5 h-3.5" />
                      Transkrybuj wszystkie (Gemini)
                    </>
                  )}
                </button>
                {phase === "batch-transcribing" && batchProgress.total > 0 && (
                  <div className="mt-1.5">
                    <Progress
                      value={Math.round((batchProgress.current / batchProgress.total) * 100)}
                      className="h-1.5"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Segment {batchProgress.current} z {batchProgress.total} • język: {TRANSCRIPTION_LANGUAGES.find(l => l.code === language)?.label}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {estimatedMp3MB && (
            <p className="text-[10px] text-muted-foreground">
              ~{totalMB} MB video → ~{estimatedMp3MB} MB MP3 (szacunkowo)
            </p>
          )}
          <button
            onClick={handleExtractAudio}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {phaseLabels[phase]} {progress > 0 && `${progress}%`}
              </>
            ) : (
              <>
                <Music className="w-3.5 h-3.5" />
                Wyodrębnij audio (MP3)
              </>
            )}
          </button>
          {busy && phase === "converting" && progress > 0 && (
            <Progress value={progress} className="h-1.5" />
          )}
        </div>
      )}
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
