import { useState, useEffect, useRef } from "react";
import { Play, Download, Image, Loader2, ChevronDown, ChevronUp, Trash2, Images, X } from "lucide-react";
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
  onFramesGenerated?: () => void;
}

export default function RecordingSegments({ recordingFilename, onFramesGenerated }: Props) {
  const [segments, setSegments] = useState<SegmentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [expandedFrames, setExpandedFrames] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ segIdx: number; total: number; phase: string; percent: number } | null>(null);
  const [batchInterval, setBatchInterval] = useState(30);
  const batchAbortRef = useRef<AbortController | null>(null);

  const stem = recordingFilename.replace(/\.[^.]+$/, "");

  useEffect(() => {
    loadSegments();
  }, [recordingFilename]);

  async function loadSegments() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // List all files in user's folder that match the stem pattern
      const { data: files } = await supabase.storage
        .from("recordings")
        .list(user.id, { limit: 100, sortBy: { column: "name", order: "asc" } });

      if (!files) return;

      // Find parts: stem_part1.webm, stem_part2.webm, etc.
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

      // Get signed URLs for all parts
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
      const { error } = await supabase.storage
        .from("recordings")
        .remove([seg.path]);
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

    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Szukanie segmentów…
      </div>
    );
  }

  if (segments.length === 0) return null;

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
        {expanded && (
          <button
            onClick={handleDeleteAll}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            title="Usuń wszystkie segmenty"
          >
            <Trash2 className="w-3 h-3" />
            Usuń wszystkie
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2">
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
