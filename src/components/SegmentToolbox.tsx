import { useState, useRef, useEffect } from "react";
import {
  Music, Loader2, Scissors, Download, Play, Trash2, FileAudio, Languages,
  Wifi, WifiOff, Image, Images, CheckSquare, Square, ChevronDown, ChevronUp, X, Merge
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import FrameRegenerator from "@/components/FrameRegenerator";
import type { ProgressInfo } from "@/lib/frame-extractor";

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

type TranscriptionLanguage = (typeof TRANSCRIPTION_LANGUAGES)[number]["code"];

interface VideoSegment {
  name: string;
  path: string;
  signedUrl?: string;
  sizeMB: string;
  partNumber: number;
}

interface AudioSegment {
  name: string;
  path: string;
  signedUrl?: string;
  sizeMB: string;
}

interface Props {
  recordingFilename: string;
  recordingSizeBytes?: number | null;
  meetingId: string;
  framesVersion?: number;
  onFramesGenerated?: () => void;
  onTranscriptGenerated?: () => void;
}

type Phase = "idle" | "extracting-mp3" | "splitting" | "uploading-parts" | "batch-transcribing" | "batch-frames";

export default function SegmentToolbox({
  recordingFilename,
  recordingSizeBytes,
  meetingId,
  framesVersion = 0,
  onFramesGenerated,
  onTranscriptGenerated,
}: Props) {
  // Video segments
  const [videoSegments, setVideoSegments] = useState<VideoSegment[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<Set<number>>(new Set());
  const [loadingVideo, setLoadingVideo] = useState(true);

  // Audio sub-segments
  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<Set<number>>(new Set());
  const [loadingAudio, setLoadingAudio] = useState(true);
  const [audioExpanded, setAudioExpanded] = useState(true);

  // Tool state
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [language, setLanguage] = useState<TranscriptionLanguage>("pl");
  const [transcribeMode, setTranscribeMode] = useState<"online" | "offline">("online");
  const [chunkMB, setChunkMB] = useState(20);
  const [frameInterval, setFrameInterval] = useState(30);
  const [expandedFrameIdx, setExpandedFrameIdx] = useState<number | null>(null);
  const [cachedFrames, setCachedFrames] = useState<{ base64: string; timestamp: string }[]>([]);

  const ffmpegRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stem = recordingFilename.replace(/\.[^.]+$/, "").replace(/_part\d+$/, "");
  const busy = phase !== "idle";

  // Load video segments
  useEffect(() => { loadVideoSegments(); }, [recordingFilename]);
  useEffect(() => { loadAudioSegments(); }, [recordingFilename]);
  useEffect(() => { loadFramesForContext(); }, [recordingFilename, framesVersion]);

  async function loadVideoSegments() {
    setLoadingVideo(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: files } = await supabase.storage.from("recordings").list(user.id, { limit: 200, sortBy: { column: "name", order: "asc" } });
      if (!files) return;

      const ext = recordingFilename.match(/\.[^.]+$/)?.[0] || ".webm";
      const partFiles = files
        .filter(f => f.name.startsWith(stem + "_part") && /\.(webm|mp4|mkv)$/.test(f.name))
        .sort((a, b) => parseInt(a.name.match(/_part(\d+)/)?.[1] || "0") - parseInt(b.name.match(/_part(\d+)/)?.[1] || "0"));

      const baseFile = files.find(f => f.name === `${stem}${ext}`);

      const segs: VideoSegment[] = [];
      const filesToProcess = partFiles.length > 0 ? partFiles : (baseFile ? [baseFile] : []);

      for (const f of filesToProcess) {
        const path = `${user.id}/${f.name}`;
        const partNum = parseInt(f.name.match(/_part(\d+)/)?.[1] || "0");
        const sizeMB = (f.metadata as any)?.size ? ((f.metadata as any).size / (1024 * 1024)).toFixed(1) : "?";
        const { data: urlData } = await supabase.storage.from("recordings").createSignedUrl(path, 3600);
        segs.push({ name: f.name, path, signedUrl: urlData?.signedUrl, sizeMB, partNumber: partNum });
      }

      setVideoSegments(segs);
      setSelectedVideo(new Set(segs.map((_, i) => i)));
    } catch (err) { console.error("Load video segments:", err); }
    finally { setLoadingVideo(false); }
  }

  async function loadAudioSegments() {
    setLoadingAudio(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: files } = await supabase.storage.from("recordings").list(`${user.id}/audio`);
      if (!files) { setAudioSegments([]); return; }

      const partFiles = files
        .filter(f => f.name.startsWith(stem) && f.name.endsWith(".mp3"))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      const segs: AudioSegment[] = [];
      for (const f of partFiles) {
        const path = `${user.id}/audio/${f.name}`;
        const { data } = await supabase.storage.from("recordings").createSignedUrl(path, 3600);
        segs.push({
          name: f.name,
          path,
          signedUrl: data?.signedUrl,
          sizeMB: f.metadata?.size ? (f.metadata.size / (1024 * 1024)).toFixed(1) : "?",
        });
      }
      setAudioSegments(segs);
      if (segs.length > 0) setSelectedAudio(new Set(segs.map((_, i) => i)));
    } catch (err) { console.error("Load audio segments:", err); }
    finally { setLoadingAudio(false); }
  }

  async function loadFramesForContext() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const prefixes = [`${user.id}/frames/${stem}`];
      const { data: allDirs } = await supabase.storage.from("recordings").list(`${user.id}/frames`);
      if (allDirs) {
        for (const d of allDirs) {
          if (d.name.startsWith(stem + "_part") && d.id) prefixes.push(`${user.id}/frames/${d.name}`);
        }
      }
      const frameFiles: { path: string; timestamp: number }[] = [];
      for (const prefix of prefixes) {
        const { data: files } = await supabase.storage.from("recordings").list(prefix, { limit: 50, sortBy: { column: "name", order: "asc" } });
        if (files) {
          for (const f of files) {
            if (!f.name.match(/\.(jpg|jpeg|png)$/i)) continue;
            const match = f.name.match(/frame_(\d+)s?\./);
            frameFiles.push({ path: `${prefix}/${f.name}`, timestamp: match ? parseInt(match[1]) : 0 });
          }
        }
      }
      if (frameFiles.length === 0) { setCachedFrames([]); return; }
      frameFiles.sort((a, b) => a.timestamp - b.timestamp);
      const selected = frameFiles.slice(0, 20);
      const { data: signed } = await supabase.storage.from("recordings").createSignedUrls(selected.map(f => f.path), 3600);
      if (!signed) { setCachedFrames([]); return; }
      const frames: { base64: string; timestamp: string }[] = [];
      const seenHashes = new Set<string>();
      for (let i = 0; i < signed.length; i++) {
        if (!signed[i].signedUrl) continue;
        try {
          const res = await fetch(signed[i].signedUrl);
          const blob = await res.blob();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const hashSlice = bytes.slice(0, 2048);
          let hash = 0;
          for (let j = 0; j < hashSlice.length; j += 4) hash = ((hash << 5) - hash + hashSlice[j]) | 0;
          const hashStr = hash.toString(36);
          if (seenHashes.has(hashStr)) continue;
          seenHashes.add(hashStr);
          const secs = selected[i].timestamp;
          const mins = Math.floor(secs / 60);
          const s = secs % 60;
          frames.push({ base64: uint8ToBase64(bytes), timestamp: `${mins}:${String(s).padStart(2, "0")}` });
        } catch { /* skip */ }
      }
      setCachedFrames(frames);
    } catch (err) {
      console.error("Load frames context:", err);
      setCachedFrames([]);
    }
  }

  async function getFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress: p }: { progress: number }) => setProgress(Math.round(p * 100)));
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({ coreURL: `${baseURL}/ffmpeg-core.js`, wasmURL: `${baseURL}/ffmpeg-core.wasm` });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }

  // --- TOOL 1: Extract MP3 from selected video segments ---
  async function handleExtractMp3() {
    const selected = getSelectedVideoSegments();
    if (selected.length === 0) { toast.info("Zaznacz segmenty wideo"); return; }

    setPhase("extracting-mp3");
    setProgress(0);
    setBatchProgress({ current: 0, total: selected.length, percent: 0 });

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");
      const ffmpeg = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");

      for (let i = 0; i < selected.length; i++) {
        const seg = selected[i];
        if (!seg.signedUrl) continue;
        setBatchProgress({ current: i + 1, total: selected.length, percent: Math.round(((i + 1) / selected.length) * 100) });
        toast.loading(`MP3 z segmentu ${i + 1}/${selected.length}…`, { id: "extract-mp3" });

        const inputName = `input_${i}.webm`;
        const outputName = `output_${i}.mp3`;
        const videoData = await fetchFile(seg.signedUrl);
        await ffmpeg.writeFile(inputName, videoData);
        await ffmpeg.exec(["-i", inputName, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-f", "mp3", outputName]);
        const mp3Data = await ffmpeg.readFile(outputName);
        const mp3Blob = new Blob([mp3Data], { type: "audio/mpeg" });

        const mp3Name = seg.name.replace(/\.[^.]+$/, ".mp3");
        const path = `${user.id}/audio/${mp3Name}`;
        await supabase.storage.from("recordings").upload(path, mp3Blob, { contentType: "audio/mpeg", upsert: true });

        try { await ffmpeg.deleteFile(inputName); await ffmpeg.deleteFile(outputName); } catch {}
      }

      toast.success(`Wyodrębniono MP3 z ${selected.length} segmentów`, { id: "extract-mp3" });
      await loadAudioSegments();
    } catch (err: any) {
      toast.error("Błąd: " + (err.message || "nieznany"), { id: "extract-mp3" });
    } finally {
      setPhase("idle");
      setProgress(0);
      setBatchProgress({ current: 0, total: 0, percent: 0 });
    }
  }

  // --- TOOL 2: Split selected MP3s into smaller parts ---
  async function handleSplitMp3() {
    const selected = getSelectedAudioSegments();
    if (selected.length === 0) { toast.info("Zaznacz segmenty audio"); return; }

    setPhase("splitting");
    setBatchProgress({ current: 0, total: selected.length, percent: 0 });

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");
      const ffmpeg = await getFFmpeg();

      let totalParts = 0;

      for (let i = 0; i < selected.length; i++) {
        const seg = selected[i];
        if (!seg.signedUrl) continue;
        setBatchProgress({ current: i + 1, total: selected.length, percent: Math.round(((i + 1) / selected.length) * 100) });
        toast.loading(`Dzielenie ${i + 1}/${selected.length}…`, { id: "split-mp3" });

        const res = await fetch(seg.signedUrl);
        const mp3Blob = await res.blob();
        const mp3Bytes = new Uint8Array(await mp3Blob.arrayBuffer());
        await ffmpeg.writeFile("split_input.mp3", mp3Bytes);

        // Get duration
        let durationSec = 0;
        const logHandler = ({ message }: { message: string }) => {
          const match = message.match(/Duration:\s+(\d+):(\d+):(\d+)/);
          if (match) durationSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
        };
        ffmpeg.on("log", logHandler);
        await ffmpeg.exec(["-i", "split_input.mp3", "-f", "null", "-t", "0", "/dev/null"]).catch(() => {});

        if (durationSec <= 0) durationSec = Math.max(60, mp3Blob.size / (8 * 1024));

        const chunkBytes = chunkMB * 1024 * 1024;
        const bytesPerSec = mp3Blob.size / durationSec;
        const segDuration = Math.max(10, Math.floor(chunkBytes / bytesPerSec));

        if (Math.ceil(durationSec / segDuration) <= 1) continue;

        await ffmpeg.exec(["-i", "split_input.mp3", "-c", "copy", "-f", "segment", "-segment_time", String(segDuration), "-reset_timestamps", "1", "split_%03d.mp3"]);

        const segStem = seg.name.replace(/\.mp3$/, "");
        for (let j = 0; j < 999; j++) {
          const chunkName = `split_${String(j).padStart(3, "0")}.mp3`;
          try {
            const data = await ffmpeg.readFile(chunkName) as Uint8Array;
            if (data.length === 0) break;
            const partBlob = new Blob([new Uint8Array(data)], { type: "audio/mpeg" });
            const partPath = `${user.id}/audio/${segStem}_chunk${j + 1}.mp3`;
            await supabase.storage.from("recordings").upload(partPath, partBlob, { contentType: "audio/mpeg", upsert: true });
            totalParts++;
            try { await ffmpeg.deleteFile(chunkName); } catch {}
          } catch { break; }
        }
        try { await ffmpeg.deleteFile("split_input.mp3"); } catch {}
      }

      toast.success(`Podzielono na ${totalParts} części`, { id: "split-mp3" });
      await loadAudioSegments();
    } catch (err: any) {
      toast.error("Błąd: " + (err.message || "nieznany"), { id: "split-mp3" });
    } finally {
      setPhase("idle");
      setBatchProgress({ current: 0, total: 0, percent: 0 });
    }
  }

  // --- TOOL 3: Transcribe with Gemini (online) or Whisper (offline) ---
  async function handleBatchTranscribe() {
    const selected = getSelectedAudioSegments();
    if (selected.length === 0) { toast.info("Zaznacz segmenty audio do transkrypcji"); return; }

    setPhase("batch-transcribing");
    setBatchProgress({ current: 0, total: selected.length, percent: 0 });

    // Clear existing transcript
    await supabase.from("transcript_lines").delete().eq("meeting_id", meetingId);

    let globalLineOrder = 0;
    let allLines: { timestamp: string; speaker: string; text: string }[] = [];
    let transcriber: any = null;

    if (transcribeMode === "offline") {
      toast.loading("Ładowanie modelu Whisper (~50 MB)…", { id: "batch-transcribe" });
      try {
        const { pipeline } = await import("@huggingface/transformers");
        transcriber = await pipeline("automatic-speech-recognition", "onnx-community/whisper-small", { dtype: "q4", device: "wasm" });
      } catch (err: any) {
        toast.error("Nie udało się załadować Whisper: " + err.message, { id: "batch-transcribe" });
        setPhase("idle");
        return;
      }
    }

    const whisperLangMap: Record<string, string> = {
      pl: "polish", en: "english", de: "german", fr: "french", es: "spanish",
      it: "italian", pt: "portuguese", uk: "ukrainian", ru: "russian", cs: "czech",
    };

    for (let i = 0; i < selected.length; i++) {
      const seg = selected[i];
      if (!seg.signedUrl) continue;
      setBatchProgress({ current: i + 1, total: selected.length, percent: Math.round(((i + 1) / selected.length) * 100) });
      toast.loading(`Transkrypcja ${i + 1}/${selected.length} (${transcribeMode === "offline" ? "Whisper" : "Gemini"})…`, { id: "batch-transcribe" });

      try {
        const res = await fetch(seg.signedUrl);
        const blob = await res.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let lines: { timestamp: string; speaker: string; text: string }[] = [];

        if (transcribeMode === "online") {
          const sizeMB = bytes.length / (1024 * 1024);
          if (sizeMB > 20) { toast.warning(`Segment ${i + 1} za duży (${sizeMB.toFixed(1)} MB)`, { id: "batch-transcribe" }); continue; }
          const base64 = uint8ToBase64(bytes);
          const { data, error } = await supabase.functions.invoke("transcribe-audio", {
            body: { audioBase64: base64, mimeType: "audio/mpeg", language, frames: cachedFrames.length > 0 ? cachedFrames : undefined },
          });
          if (error || data?.error) { console.error(`Seg ${i + 1}:`, error || data?.error); continue; }
          lines = (data?.lines || []).map((l: any) => ({ timestamp: l.timestamp || "00:00", speaker: l.speaker || "Mówca", text: l.text })).filter((l: any) => l.text?.trim());
        } else {
          const audioCtx = new AudioContext({ sampleRate: 16000 });
          const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
          const channelData = audioBuffer.getChannelData(0);
          await audioCtx.close();
          const result = await transcriber(channelData, {
            language: whisperLangMap[language] || "polish", task: "transcribe", return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
          });
          const chunks = (result as any).chunks || [];
          if (chunks.length > 0) {
            lines = chunks.map((chunk: any) => {
              const startSec = chunk.timestamp?.[0] || 0;
              return { timestamp: `${String(Math.floor(startSec / 60)).padStart(2, "0")}:${String(Math.floor(startSec % 60)).padStart(2, "0")}`, speaker: "Mówca", text: (chunk.text || "").trim() };
            }).filter((l: any) => l.text.length > 0);
          } else {
            const text = typeof result === "string" ? result : (result as any).text || "";
            if (text.trim()) lines = [{ timestamp: "00:00", speaker: "Mówca", text: text.trim() }];
          }
        }

        if (lines.length > 0) {
          const rows = lines.map((line) => ({ meeting_id: meetingId, timestamp: line.timestamp, speaker: line.speaker, text: line.text, line_order: globalLineOrder++ }));
          await supabase.from("transcript_lines").insert(rows);
          allLines.push(...lines);
        }

        if (transcribeMode === "online" && i < selected.length - 1) await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        console.error(`Segment ${i + 1}:`, err);
        toast.warning(`Segment ${i + 1}: ${err.message || "błąd"}`, { id: "batch-transcribe" });
      }
    }

    if (transcriber) try { await transcriber.dispose?.(); } catch {}

    if (allLines.length > 0) {
      const fullText = allLines.map(l => l.text).join(" ");
      await supabase.from("meetings").update({ summary: fullText.slice(0, 500) }).eq("id", meetingId);
      toast.success(`Transkrypcja: ${allLines.length} fragmentów z ${selected.length} segmentów`, { id: "batch-transcribe", duration: 5000 });
      onTranscriptGenerated?.();
    } else {
      toast.warning("Nie udało się transkrybować żadnego segmentu", { id: "batch-transcribe" });
    }

    setPhase("idle");
    setBatchProgress({ current: 0, total: 0, percent: 0 });
  }

  // --- TOOL 4: Extract frames (slides) from selected video segments ---
  async function handleBatchFrames() {
    const selected = getSelectedVideoSegments().filter(s => s.signedUrl);
    if (selected.length === 0) { toast.info("Zaznacz segmenty wideo"); return; }

    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("batch-frames");
    setBatchProgress({ current: 0, total: selected.length, percent: 0 });

    try {
      const { extractFrames, uploadFrames } = await import("@/lib/frame-extractor");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      let totalFrames = 0;
      for (let i = 0; i < selected.length; i++) {
        if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");
        const seg = selected[i];
        setBatchProgress({ current: i + 1, total: selected.length, percent: Math.round(((i) / selected.length) * 100) });
        toast.loading(`Klatki z segmentu ${i + 1}/${selected.length}…`, { id: "batch-frames" });

        const res = await fetch(seg.signedUrl!);
        const videoBlob = await res.blob();
        const frames = await extractFrames(videoBlob, frameInterval, 50, undefined, ac.signal);

        if (frames.length > 0) {
          const segStem = seg.name.replace(/\.[^.]+$/, "");
          await uploadFrames(supabase, user.id, segStem, frames, undefined, ac.signal);
          totalFrames += frames.length;
        }
      }

      toast.success(`Wygenerowano ${totalFrames} klatek z ${selected.length} segmentów`, { id: "batch-frames" });
      onFramesGenerated?.();
    } catch (err: any) {
      if (err?.name === "AbortError") toast.info("Anulowano", { id: "batch-frames" });
      else toast.error("Błąd: " + (err.message || "nieznany"), { id: "batch-frames" });
    } finally {
      abortRef.current = null;
      setPhase("idle");
      setBatchProgress({ current: 0, total: 0, percent: 0 });
    }
  }

  async function handleDeleteAudioSegments() {
    const selected = getSelectedAudioSegments();
    if (selected.length === 0) return;
    if (!confirm(`Usunąć ${selected.length} segmentów audio?`)) return;
    try {
      await supabase.storage.from("recordings").remove(selected.map(s => s.path));
      toast.success(`Usunięto ${selected.length} segmentów audio`);
      await loadAudioSegments();
    } catch (err: any) {
      toast.error("Błąd: " + err.message);
    }
  }

  // Helpers
  function getSelectedVideoSegments() { return videoSegments.filter((_, i) => selectedVideo.has(i)); }
  function getSelectedAudioSegments() { return audioSegments.filter((_, i) => selectedAudio.has(i)); }

  function toggleVideoAll() {
    if (selectedVideo.size === videoSegments.length) setSelectedVideo(new Set());
    else setSelectedVideo(new Set(videoSegments.map((_, i) => i)));
  }

  function toggleAudioAll() {
    if (selectedAudio.size === audioSegments.length) setSelectedAudio(new Set());
    else setSelectedAudio(new Set(audioSegments.map((_, i) => i)));
  }

  function toggleVideo(idx: number) {
    setSelectedVideo(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function toggleAudio(idx: number) {
    setSelectedAudio(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  if (loadingVideo) {
    return <div className="text-xs text-muted-foreground animate-pulse py-2 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />Ładowanie…</div>;
  }

  if (videoSegments.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* SECTION: Video Segments with selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">Segmenty wideo ({videoSegments.length})</h3>
          <button onClick={toggleVideoAll} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            {selectedVideo.size === videoSegments.length ? "Odznacz" : "Zaznacz"} wszystkie
          </button>
        </div>

        <div className="space-y-0.5">
          {videoSegments.map((seg, idx) => (
            <div key={seg.path} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors">
              <Checkbox
                checked={selectedVideo.has(idx)}
                onCheckedChange={() => toggleVideo(idx)}
                className="h-3.5 w-3.5"
              />
              <span className="text-[10px] font-mono-data text-primary font-bold w-5">#{seg.partNumber || idx + 1}</span>
              <span className="text-[10px] font-mono-data text-muted-foreground truncate flex-1">{seg.name}</span>
              <span className="text-[10px] font-mono-data text-muted-foreground/60">{seg.sizeMB} MB</span>
            </div>
          ))}
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="border border-border rounded-md p-3 bg-muted/20 space-y-3">
        <h3 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">Narzędzia</h3>

        {/* Row 1: MP3 + Frames tools for video segments */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExtractMp3}
            disabled={busy || selectedVideo.size === 0}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted/50 text-foreground transition-colors disabled:opacity-50"
          >
            {phase === "extracting-mp3" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Music className="w-3.5 h-3.5" />}
            Wyodrębnij MP3 ({selectedVideo.size})
          </button>
          <button
            onClick={handleBatchFrames}
            disabled={busy || selectedVideo.size === 0}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted/50 text-foreground transition-colors disabled:opacity-50"
          >
            {phase === "batch-frames" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Images className="w-3.5 h-3.5" />}
            Wytnij slajdy ({selectedVideo.size})
          </button>
        </div>

        {/* Frame interval */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Slajdy co:</span>
          <input
            type="number" min={1} max={300} value={frameInterval}
            onChange={e => { const v = parseInt(e.target.value); if (v >= 1 && v <= 300) setFrameInterval(v); }}
            disabled={busy}
            className="w-12 text-xs bg-muted/50 border border-border rounded px-1.5 py-0.5 text-foreground text-center"
          />
          <span>sek</span>
        </div>

        {/* Progress for video tools */}
        {(phase === "extracting-mp3" || phase === "batch-frames") && batchProgress.total > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{phase === "extracting-mp3" ? "Wyodrębnianie MP3" : "Generowanie klatek"} {batchProgress.current}/{batchProgress.total}</span>
              <span className="font-mono-data">{batchProgress.percent}%</span>
            </div>
            <Progress value={batchProgress.percent} className="h-1.5" />
            {phase === "batch-frames" && (
              <button onClick={() => abortRef.current?.abort()} className="text-[10px] text-destructive hover:text-destructive/80 flex items-center gap-1">
                <X className="w-3 h-3" />Anuluj
              </button>
            )}
          </div>
        )}

        {/* Separator */}
        <div className="border-t border-border pt-3 space-y-2">
          {/* Language + mode for transcription */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Languages className="w-3 h-3 text-muted-foreground" />
              <select
                value={language} onChange={e => setLanguage(e.target.value as TranscriptionLanguage)}
                disabled={busy}
                className="text-[10px] bg-muted/50 border border-border rounded px-1.5 py-0.5 text-foreground"
              >
                {TRANSCRIPTION_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTranscribeMode("online")} disabled={busy}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${transcribeMode === "online" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                <Wifi className="w-3 h-3" />Gemini
              </button>
              <button
                onClick={() => setTranscribeMode("offline")} disabled={busy}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${transcribeMode === "offline" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                <WifiOff className="w-3 h-3" />Whisper
              </button>
            </div>
          </div>

          {transcribeMode === "online" && cachedFrames.length > 0 && (
            <p className="text-[10px] text-primary flex items-center gap-1"><Image className="w-3 h-3" />{cachedFrames.length} klatek jako kontekst wizualny</p>
          )}

          {/* Row 2: Audio segment tools */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleBatchTranscribe}
              disabled={busy || selectedAudio.size === 0}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {phase === "batch-transcribing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileAudio className="w-3.5 h-3.5" />}
              Transkrybuj ({selectedAudio.size})
            </button>
            <button
              onClick={handleSplitMp3}
              disabled={busy || selectedAudio.size === 0}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted/50 text-foreground transition-colors disabled:opacity-50"
            >
              {phase === "splitting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
              Podziel MP3 ({selectedAudio.size})
            </button>
          </div>

          {/* Chunk size for splitting */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Podziel po:</span>
            <div className="flex gap-1">
              {[5, 10, 20, 50].map(v => (
                <button key={v} onClick={() => setChunkMB(v)} disabled={busy}
                  className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${chunkMB === v ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >{v} MB</button>
              ))}
            </div>
          </div>

          {/* Progress for audio tools */}
          {(phase === "batch-transcribing" || phase === "splitting") && batchProgress.total > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{phase === "batch-transcribing" ? "Transkrypcja" : "Dzielenie"} {batchProgress.current}/{batchProgress.total}</span>
                <span className="font-mono-data">{batchProgress.percent}%</span>
              </div>
              <Progress value={batchProgress.percent} className="h-1.5" />
            </div>
          )}
        </div>
      </div>

      {/* SECTION: Segmenty podzielone (Audio segments) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setAudioExpanded(!audioExpanded)}
            className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider hover:text-foreground transition-colors"
          >
            {audioExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Segmenty podzielone ({audioSegments.length})
          </button>
          {audioExpanded && audioSegments.length > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={toggleAudioAll} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {selectedAudio.size === audioSegments.length ? "Odznacz" : "Zaznacz"}
              </button>
              <button onClick={handleDeleteAudioSegments} disabled={busy || selectedAudio.size === 0}
                className="flex items-center gap-1 text-[10px] text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50">
                <Trash2 className="w-3 h-3" />Usuń ({selectedAudio.size})
              </button>
            </div>
          )}
        </div>

        {audioExpanded && (
          loadingAudio ? (
            <div className="text-[10px] text-muted-foreground animate-pulse flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Szukanie…</div>
          ) : audioSegments.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">Brak segmentów audio. Użyj „Wyodrębnij MP3" powyżej.</p>
          ) : (
            <div className="space-y-0.5">
              {audioSegments.map((seg, idx) => (
                <div key={seg.path} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors">
                  <Checkbox
                    checked={selectedAudio.has(idx)}
                    onCheckedChange={() => toggleAudio(idx)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-[10px] font-mono-data text-muted-foreground w-5 text-right">{idx + 1}.</span>
                  <span className="text-[10px] font-mono-data text-foreground truncate flex-1">{seg.name}</span>
                  <span className="text-[10px] font-mono-data text-muted-foreground/60">{seg.sizeMB} MB</span>
                  {seg.signedUrl && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { const audio = new Audio(seg.signedUrl); audio.play(); }}
                        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      ><Play className="w-3 h-3" /></button>
                      <button
                        onClick={async () => {
                          try {
                            const r = await fetch(seg.signedUrl!);
                            const b = await r.blob();
                            const url = URL.createObjectURL(b);
                            const a = document.createElement("a");
                            a.href = url; a.download = seg.name;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } catch { window.open(seg.signedUrl!, "_blank"); }
                        }}
                        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      ><Download className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
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
