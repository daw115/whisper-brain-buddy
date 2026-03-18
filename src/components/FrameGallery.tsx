import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronDown, ChevronUp, X, ChevronLeft, ChevronRight, Download, Trash2, Image } from "lucide-react";
import { toast } from "sonner";

interface FrameFile {
  name: string;
  path: string;
  signedUrl: string;
  timestamp: number; // seconds parsed from filename
}

interface Props {
  recordingFilename: string;
  /** Bump to trigger reload */
  version?: number;
}

export default function FrameGallery({ recordingFilename, version = 0 }: Props) {
  const [frames, setFrames] = useState<FrameFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const stem = recordingFilename.replace(/\.[^.]+$/, "");

  useEffect(() => {
    loadFrames();
  }, [recordingFilename, version]);

  async function loadFrames() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // List all frame folders matching this recording stem and its parts
      const prefixes = [stem];
      // Discover part directories directly from frames/ folder
      const { data: frameDirs, error: dirError } = await supabase.storage
        .from("recordings")
        .list(`${user.id}/frames`, { limit: 200, sortBy: { column: "name", order: "asc" } });

      console.log("[FrameGallery] stem:", stem, "frameDirs:", frameDirs?.map(d => d.name), "dirError:", dirError);

      if (frameDirs) {
        for (const d of frameDirs) {
          if (d.name.startsWith(stem + "_part") || d.name.startsWith(stem + "_sub")) {
            prefixes.push(d.name);
          }
        }
      }

      console.log("[FrameGallery] prefixes to scan:", prefixes);

      const allFrames: FrameFile[] = [];

      for (const prefix of prefixes) {
        const folderPath = `${user.id}/frames/${prefix}`;
        const { data: files, error: listError } = await supabase.storage
          .from("recordings")
          .list(`${user.id}/frames/${prefix}`, { limit: 200, sortBy: { column: "name", order: "asc" } });

        console.log(`[FrameGallery] ${prefix}: ${files?.length ?? 0} files, error:`, listError);

        if (!files || files.length === 0) continue;

        const jpgFiles = files.filter((f) => f.name.endsWith(".jpg") || f.name.endsWith(".jpeg") || f.name.endsWith(".png"));

        if (jpgFiles.length === 0) continue;

        // Batch signed URLs
        const paths = jpgFiles.map((f) => `${folderPath}/${f.name}`);
        const { data: urlData } = await supabase.storage
          .from("recordings")
          .createSignedUrls(paths, 60 * 60);

        if (urlData) {
          for (let i = 0; i < urlData.length; i++) {
            if (urlData[i].error || !urlData[i].signedUrl) continue;
            const name = jpgFiles[i].name;
            const tsMatch = name.match(/frame_(\d+)s/);
            const timestamp = tsMatch ? parseInt(tsMatch[1]) : 0;
            allFrames.push({
              name: `${prefix}/${name}`,
              path: paths[i],
              signedUrl: urlData[i].signedUrl,
              timestamp,
            });
          }
        }
      }

      console.log("[FrameGallery] total frames found:", allFrames.length);
      // Sort by path (groups by segment) then timestamp
      allFrames.sort((a, b) => a.path.localeCompare(b.path));
      setFrames(allFrames);
    } catch (err) {
      console.error("Error loading frames:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(frame: FrameFile) {
    if (!confirm(`Usunąć klatkę?`)) return;
    try {
      const { error } = await supabase.storage.from("recordings").remove([frame.path]);
      if (error) throw error;
      setFrames((prev) => prev.filter((f) => f.path !== frame.path));
      if (lightboxIdx !== null) setLightboxIdx(null);
      toast.success("Usunięto klatkę");
    } catch (err: any) {
      toast.error("Błąd: " + (err.message || "nieznany"));
    }
  }

  function formatTimestamp(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Ładowanie klatek…
      </div>
    );
  }

  if (frames.length === 0) return null;

  return (
    <>
      <div className="space-y-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider hover:text-foreground transition-colors w-full"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <Image className="w-3 h-3" />
          Klatki ({frames.length})
        </button>

        {expanded && (
          <div className="grid grid-cols-3 gap-1.5">
            {frames.map((frame, idx) => (
              <button
                key={frame.path}
                onClick={() => setLightboxIdx(idx)}
                className="relative group aspect-video rounded border border-border overflow-hidden bg-muted/30 hover:border-primary/50 transition-colors"
              >
                <img
                  src={frame.signedUrl}
                  alt={`Frame @ ${formatTimestamp(frame.timestamp)}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white font-mono px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {formatTimestamp(frame.timestamp)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && frames[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          {/* Close */}
          <button
            onClick={() => setLightboxIdx(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Counter */}
          <div className="absolute top-4 left-4 text-white/60 text-sm font-mono z-10">
            {lightboxIdx + 1} / {frames.length}
          </div>

          {/* Prev */}
          {lightboxIdx > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors z-10"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
          )}

          {/* Next */}
          {lightboxIdx < frames.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors z-10"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          )}

          {/* Image */}
          <img
            src={frames[lightboxIdx].signedUrl}
            alt={`Frame @ ${formatTimestamp(frames[lightboxIdx].timestamp)}`}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Bottom bar */}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/60 rounded-full px-4 py-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-white/80 text-xs font-mono">
              {formatTimestamp(frames[lightboxIdx].timestamp)}
            </span>
            <span className="text-white/40 text-[10px] truncate max-w-[200px]">
              {frames[lightboxIdx].name}
            </span>
            <a
              href={frames[lightboxIdx].signedUrl}
              download
              className="text-white/60 hover:text-white transition-colors"
              title="Pobierz"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              onClick={() => handleDelete(frames[lightboxIdx!])}
              className="text-white/60 hover:text-red-400 transition-colors"
              title="Usuń"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
