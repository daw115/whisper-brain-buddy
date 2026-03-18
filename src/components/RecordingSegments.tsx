import { useState, useEffect, useRef } from "react";
import { Play, Download, Image, Loader2, ChevronDown, ChevronUp, Trash2, Images, X, Music, FileAudio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import FrameRegenerator from "@/components/FrameRegenerator";
import type { ProgressInfo } from "@/lib/frame-extractor";

interface SegmentFile {
  name: string;
  path: string;
  signedUrl?: string;
  sizeMB: string;
}

interface Props {
  recordingFilename: string;
  meetingId?: string;
  onFramesGenerated?: () => void;
  onTranscriptGenerated?: () => void;
}

export default function RecordingSegments({ recordingFilename, meetingId, onFramesGenerated, onTranscriptGenerated }: Props) {
  const [segments, setSegments] = useState<SegmentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [expandedFrames, setExpandedFrames] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ segIdx: number; total: number; phase: string; percent: number } | null>(null);
  const [batchInterval, setBatchInterval] = useState(30);
  const batchAbortRef = useRef<AbortController | null>(null);

  // Per-segment MP3 state
  const [convertingMp3, setConvertingMp3] = useState<number | null>(null);
  const [mp3Urls, setMp3Urls] = useState<Record<number, { url: string; sizeMB: string }>>({});
  const [transcribingIdx, setTranscribingIdx] = useState<number | null>(null);
  const [transcribePhase, setTranscribePhase] = useState("");
  const ffmpegRef = useRef<any>(null);

  const stem = recordingFilename.replace(/\.[^.]+$/, "");

  useEffect(() => {
    loadSegments();
  }, [recordingFilename]);

  async function loadSegments() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: files } = await supabase.storage
        .from("recordings")
        .list(user.id, { limit: 100, sortBy: { column: "name", order: "asc" } });

      if (!files) return;

      const partFiles = files
        .filter((f) => {
          const n = f.name;
          return (
            n.startsWith(stem + "_part") &&
            (n.endsWith(".webm") || n.endsWith(".mp4") || n.endsWith(".mkv"))
          );
        })
        .sort((a, b) => {
          const numA = parseInt(a.name.match(/_part(\d+)/)?.[1] || "0");
          const numB = parseInt(b.name.match(/_part(\d+)/)?.[1] || "0");
          return numA - numB;
        });

      if (partFiles.length === 0) {
        setSegments([]);
        return;
      }

      const segs: SegmentFile[] = [];
      for (const f of partFiles) {
        const path = `${user.id}/${f.name}`;
        const { data } = await supabase.storage
          .from("recordings")
          .createSignedUrl(path, 60 * 60);
        segs.push({
          name: f.name,
          path,
          signedUrl: data?.signedUrl || undefined,
          sizeMB: ((f.metadata as any)?.size
            ? ((f.metadata as any).size / (1024 * 1024)).toFixed(1)
            : "?"),
        });
      }

      setSegments(segs);
    } catch (err) {
      console.error("Error loading segments:", err);
    } finally {
      setLoading(false);
    }
  }

  async function getFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }

  async function handleConvertMp3(idx: number) {
    const seg = segments[idx];
    if (!seg.signedUrl) return;
    setConvertingMp3(idx);

    try {
      toast.loading(`Konwersja segmentu #${idx + 1} do MP3…`, { id: `mp3-${idx}` });
      const { fetchFile } = await import("@ffmpeg/util");
      const ffmpeg = await getFFmpeg();

      const videoData = await fetchFile(seg.signedUrl);
      await ffmpeg.writeFile("seg_input.webm", videoData);

      await ffmpeg.exec(["-i", "seg_input.webm", "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-f", "mp3", "seg_output.mp3"]);

      const rawData = await ffmpeg.readFile("seg_output.mp3");
      const blob = new Blob([rawData as any], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);

      await ffmpeg.deleteFile("seg_input.webm");
      await ffmpeg.deleteFile("seg_output.mp3");

      setMp3Urls((prev) => ({ ...prev, [idx]: { url, sizeMB } }));
      toast.success(`MP3 segmentu #${idx + 1}: ${sizeMB} MB`, { id: `mp3-${idx}` });
    } catch (err: any) {
      toast.error("Błąd konwersji: " + (err.message || "nieznany"), { id: `mp3-${idx}` });
    } finally {
      setConvertingMp3(null);
    }
  }

  function handleDownloadMp3(idx: number) {
    const mp3 = mp3Urls[idx];
    if (!mp3) return;
    const seg = segments[idx];
    const a = document.createElement("a");
    a.href = mp3.url;
    a.download = seg.name.replace(/\.[^.]+$/, ".mp3");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleTranscribeSegment(idx: number) {
    const seg = segments[idx];
    if (!seg.signedUrl || !meetingId) return;
    setTranscribingIdx(idx);
    setTranscribePhase("converting");

    try {
      toast.loading(`Transkrypcja segmentu #${idx + 1}…`, { id: `trans-${idx}` });

      const { fetchFile } = await import("@ffmpeg/util");
      
      // Create a fresh FFmpeg instance to avoid FS conflicts
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });

      const videoData = await fetchFile(seg.signedUrl);
      await ffmpeg.writeFile("tr_input.webm", videoData);

      await ffmpeg.exec(["-i", "tr_input.webm", "-vn", "-ar", "16000", "-ac", "1", "-f", "f32le", "tr_output.pcm"]);

      const pcmData = await ffmpeg.readFile("tr_output.pcm") as Uint8Array;
      await ffmpeg.deleteFile("tr_input.webm");
      await ffmpeg.deleteFile("tr_output.pcm");
      ffmpeg.terminate();

      const audioData = new Float32Array(pcmData.buffer);

      setTranscribePhase("loading-model");
      toast.loading(`Ładowanie Whisper…`, { id: `trans-${idx}` });

      const { pipeline } = await import("@huggingface/transformers");
      const transcriber = await pipeline("automatic-speech-recognition", "onnx-community/whisper-small", {
        dtype: "q4",
        device: "wasm",
      });

      setTranscribePhase("transcribing");
      toast.loading(`Whisper transkrybuje segment #${idx + 1}…`, { id: `trans-${idx}` });

      const result = await transcriber(audioData, {
        language: "polish",
        task: "transcribe",
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      const chunks = (result as any).chunks || [];
      let lines: { timestamp: string; speaker: string; text: string }[] = [];

      if (chunks.length > 0) {
        lines = chunks.map((chunk: any) => {
          const startSec = chunk.timestamp?.[0] || 0;
          const mins = Math.floor(startSec / 60);
          const secs = Math.floor(startSec % 60);
          return {
            timestamp: `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`,
            speaker: `Seg${idx + 1}`,
            text: (chunk.text || "").trim(),
          };
        }).filter((l: any) => l.text.length > 0);
      } else {
        const text = typeof result === "string" ? result : (result as any).text || "";
        if (text.trim()) {
          lines = [{ timestamp: "00:00", speaker: `Seg${idx + 1}`, text: text.trim() }];
        }
      }

      if (lines.length === 0) {
        toast.warning("Nie rozpoznano mowy w segmencie", { id: `trans-${idx}` });
        return;
      }

      // Get existing transcript lines count to append (not overwrite)
      setTranscribePhase("saving");
      const { data: existing } = await supabase
        .from("transcript_lines")
        .select("line_order")
        .eq("meeting_id", meetingId)
        .order("line_order", { ascending: false })
        .limit(1);

      const startOrder = existing && existing.length > 0 ? existing[0].line_order + 1 : 0;

      const rows = lines.map((line, i) => ({
        meeting_id: meetingId,
        timestamp: line.timestamp,
        speaker: line.speaker,
        text: line.text,
        line_order: startOrder + i,
      }));

      const { error: insertError } = await supabase.from("transcript_lines").insert(rows);
      if (insertError) throw insertError;

      try { await (transcriber as any).dispose?.(); } catch {}

      toast.success(`Segment #${idx + 1}: ${lines.length} linii transkryptu dodanych`, { id: `trans-${idx}`, duration: 4000 });
      onTranscriptGenerated?.();
    } catch (err: any) {
      console.error("Segment transcribe error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"), { id: `trans-${idx}` });
    } finally {
      setTranscribingIdx(null);
      setTranscribePhase("");
    }
  }

  async function handleDownload(seg: SegmentFile) {
    if (!seg.signedUrl) return;
    try {
      const res = await fetch(seg.signedUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = seg.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(seg.signedUrl, "_blank");
    }
  }

  async function handleDelete(seg: SegmentFile) {
    if (!confirm(`Usunąć segment "${seg.name}"?`)) return;
    try {
      const { error } = await supabase.storage.from("recordings").remove([seg.path]);
      if (error) throw error;
      toast.success(`Usunięto ${seg.name}`);
      setSegments((prev) => prev.filter((s) => s.path !== seg.path));
      if (playingIdx !== null) setPlayingIdx(null);
      if (expandedFrames !== null) setExpandedFrames(null);
    } catch (err: any) {
      toast.error("Błąd usuwania: " + (err.message || "nieznany"));
    }
  }

  async function handleDeleteAll() {
    if (!confirm(`Usunąć wszystkie ${segments.length} segmentów?`)) return;
    try {
      const paths = segments.map((s) => s.path);
      const { error } = await supabase.storage.from("recordings").remove(paths);
      if (error) throw error;
      toast.success(`Usunięto ${segments.length} segmentów`);
      setSegments([]);
      setPlayingIdx(null);
      setExpandedFrames(null);
    } catch (err: any) {
      toast.error("Błąd usuwania: " + (err.message || "nieznany"));
    }
  }

  async function handleBatchFrames() {
    const segsWithUrl = segments.filter((s) => s.signedUrl);
    if (segsWithUrl.length === 0) return;

    const ac = new AbortController();
    batchAbortRef.current = ac;
    setBatchGenerating(true);
    let totalFrames = 0;

    try {
      const { extractFrames, uploadFrames } = await import("@/lib/frame-extractor");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      for (let i = 0; i < segsWithUrl.length; i++) {
        if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");
        const seg = segsWithUrl[i];
        setBatchProgress({ segIdx: i + 1, total: segsWithUrl.length, phase: "loading", percent: 0 });

        const res = await fetch(seg.signedUrl!);
        const videoBlob = await res.blob();
        if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");

        setBatchProgress({ segIdx: i + 1, total: segsWithUrl.length, phase: "extracting", percent: 0 });
        const frames = await extractFrames(videoBlob, batchInterval, 50, (info) => {
          setBatchProgress({ segIdx: i + 1, total: segsWithUrl.length, phase: info.phase, percent: info.percent });
        }, ac.signal);

        if (frames.length > 0) {
          const segStem = seg.name.replace(/\.[^.]+$/, "");
          await uploadFrames(supabase, user.id, segStem, frames, (info) => {
            setBatchProgress({ segIdx: i + 1, total: segsWithUrl.length, phase: info.phase, percent: info.percent });
          }, ac.signal);
          totalFrames += frames.length;
        }
      }

      toast.success(`Wygenerowano ${totalFrames} klatek z ${segsWithUrl.length} segmentów`);
      onFramesGenerated?.();
    } catch (err: any) {
      if (err?.name === "AbortError") {
        toast.info("Generowanie klatek anulowane");
      } else {
        toast.error("Błąd: " + (err.message || "nieznany"));
      }
    } finally {
      batchAbortRef.current = null;
      setBatchGenerating(false);
      setBatchProgress(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Szukanie segmentów…
      </div>
    );
  }

  if (segments.length === 0) return null;

  const phaseLabels: Record<string, string> = {
    loading: "Pobieranie",
    extracting: "Wyodrębnianie",
    uploading: "Przesyłanie",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Segmenty ({segments.length})
        </button>
        {expanded && !batchGenerating && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteAll}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
              title="Usuń wszystkie segmenty"
            >
              <Trash2 className="w-3 h-3" />
              Usuń wszystkie
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="space-y-2">
          {/* Batch frame generation */}
          <div className="border border-border rounded-md p-3 bg-muted/20 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Images className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="text-[11px] font-medium text-foreground">Klatki ze wszystkich segmentów</span>
              <span className="text-[10px] text-muted-foreground">co</span>
              <input
                type="number"
                min={1}
                max={300}
                value={batchInterval}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (v >= 1 && v <= 300) setBatchInterval(v);
                }}
                disabled={batchGenerating}
                className="w-14 text-xs bg-muted/50 border border-border rounded px-2 py-0.5 text-foreground text-center"
              />
              <span className="text-[10px] text-muted-foreground">sek</span>
            </div>

            {batchGenerating && batchProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    Segment {batchProgress.segIdx}/{batchProgress.total} — {phaseLabels[batchProgress.phase] || batchProgress.phase}
                  </span>
                  <span className="font-mono">{batchProgress.percent}%</span>
                </div>
                <Progress value={((batchProgress.segIdx - 1) / batchProgress.total) * 100 + (batchProgress.percent / batchProgress.total)} className="h-1.5" />
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={handleBatchFrames}
                disabled={batchGenerating}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              >
                {batchGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Przetwarzanie…
                  </>
                ) : (
                  <>
                    <Images className="w-3.5 h-3.5" />
                    Generuj klatki ze wszystkich
                  </>
                )}
              </button>
              {batchGenerating && (
                <button
                  onClick={() => batchAbortRef.current?.abort()}
                  className="flex items-center gap-1 text-[10px] font-medium text-destructive hover:text-destructive/80 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Anuluj
                </button>
              )}
            </div>
          </div>

          {segments.map((seg, idx) => (
            <div key={seg.name} className="border border-border rounded-md overflow-hidden">
              {/* Segment header */}
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-mono-data text-primary font-bold flex-shrink-0">
                    #{idx + 1}
                  </span>
                  <span className="text-[10px] font-mono-data text-muted-foreground truncate">
                    {seg.name}
                  </span>
                  <span className="text-[10px] font-mono-data text-muted-foreground/60 flex-shrink-0">
                    {seg.sizeMB} MB
                  </span>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {seg.signedUrl && (
                    <>
                      <button
                        onClick={() => setPlayingIdx(playingIdx === idx ? null : idx)}
                        className="p-1 text-primary hover:text-primary/80 transition-colors"
                        title="Odtwórz"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDownload(seg)}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        title="Pobierz"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      {/* MP3 convert */}
                      {mp3Urls[idx] ? (
                        <button
                          onClick={() => handleDownloadMp3(idx)}
                          className="p-1 text-primary hover:text-primary/80 transition-colors"
                          title={`Pobierz MP3 (${mp3Urls[idx].sizeMB} MB)`}
                        >
                          <Music className="w-3 h-3" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleConvertMp3(idx)}
                          disabled={convertingMp3 !== null}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          title="Konwertuj do MP3"
                        >
                          {convertingMp3 === idx ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Music className="w-3 h-3" />
                          )}
                        </button>
                      )}
                      {/* Transcribe */}
                      {meetingId && (
                        <button
                          onClick={() => handleTranscribeSegment(idx)}
                          disabled={transcribingIdx !== null}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          title="Transkrybuj segment (Whisper offline)"
                        >
                          {transcribingIdx === idx ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <FileAudio className="w-3 h-3" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedFrames(expandedFrames === idx ? null : idx)}
                        className={`p-1 transition-colors ${
                          expandedFrames === idx
                            ? "text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Generuj klatki"
                      >
                        <Image className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(seg)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Usuń segment"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Transcribing indicator */}
              {transcribingIdx === idx && (
                <div className="px-3 py-1.5 bg-primary/5 border-t border-border">
                  <p className="text-[10px] text-primary flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {transcribePhase === "converting" && "Konwersja audio…"}
                    {transcribePhase === "loading-model" && "Ładowanie modelu Whisper…"}
                    {transcribePhase === "transcribing" && "Transkrypcja offline…"}
                    {transcribePhase === "saving" && "Zapisywanie…"}
                  </p>
                </div>
              )}

              {/* Video player */}
              {playingIdx === idx && seg.signedUrl && (
                <video
                  src={seg.signedUrl}
                  controls
                  autoPlay
                  className="w-full bg-black"
                  style={{ maxHeight: 200 }}
                />
              )}

              {/* Frame extractor for this segment */}
              {expandedFrames === idx && seg.signedUrl && (
                <div className="px-3 py-2 border-t border-border bg-muted/10">
                  <FrameRegenerator
                    recordingUrl={seg.signedUrl}
                    recordingFilename={seg.name}
                    onComplete={() => onFramesGenerated?.()}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
