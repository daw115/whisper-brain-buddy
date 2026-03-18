import { useState, useEffect } from "react";
import { Play, Download, Pause, FileVideo, HardDrive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SegmentInfo {
  name: string;
  path: string;
  signedUrl?: string;
  sizeMB: string;
  partNumber: number;
}

interface Props {
  recordingFilename: string;
  recordingSizeBytes?: number | null;
}

export default function RecordingPanel({ recordingFilename, recordingSizeBytes }: Props) {
  const [segments, setSegments] = useState<SegmentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);

  const stem = recordingFilename.replace(/\.[^.]+$/, "").replace(/_part\d+$/, "");
  const ext = recordingFilename.match(/\.[^.]+$/)?.[0] || ".webm";

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
        .list(user.id, { limit: 200, sortBy: { column: "name", order: "asc" } });

      if (!files) return;

      // Find part files
      const partFiles = files
        .filter((f) => {
          const n = f.name;
          return n.startsWith(stem + "_part") && /\.(webm|mp4|mkv)$/.test(n);
        })
        .sort((a, b) => {
          const numA = parseInt(a.name.match(/_part(\d+)/)?.[1] || "0");
          const numB = parseInt(b.name.match(/_part(\d+)/)?.[1] || "0");
          return numA - numB;
        });

      // Check if base file (no _partN) exists
      const baseFile = files.find((f) => f.name === `${stem}${ext}`);

      const segs: SegmentInfo[] = [];

      if (partFiles.length > 0) {
        // Has segments
        for (const f of partFiles) {
          const path = `${user.id}/${f.name}`;
          const partNum = parseInt(f.name.match(/_part(\d+)/)?.[1] || "0");
          const sizeMB = f.metadata?.size
            ? (f.metadata.size / (1024 * 1024)).toFixed(1)
            : "?";
          const { data: urlData } = await supabase.storage
            .from("recordings")
            .createSignedUrl(path, 60 * 60);
          segs.push({
            name: f.name,
            path,
            signedUrl: urlData?.signedUrl || undefined,
            sizeMB,
            partNumber: partNum,
          });
        }
      } else if (baseFile) {
        // Single file
        const path = `${user.id}/${baseFile.name}`;
        const sizeMB = baseFile.metadata?.size
          ? (baseFile.metadata.size / (1024 * 1024)).toFixed(1)
          : recordingSizeBytes
            ? (recordingSizeBytes / (1024 * 1024)).toFixed(1)
            : "?";
        const { data: urlData } = await supabase.storage
          .from("recordings")
          .createSignedUrl(path, 60 * 60);
        segs.push({
          name: baseFile.name,
          path,
          signedUrl: urlData?.signedUrl || undefined,
          sizeMB,
          partNumber: 0,
        });
      }

      setSegments(segs);
    } catch (err) {
      console.error("RecordingPanel load error:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleDownload(seg: SegmentInfo) {
    if (!seg.signedUrl) return;
    fetch(seg.signedUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = seg.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(() => window.open(seg.signedUrl!, "_blank"));
  }

  const totalSizeMB = segments.reduce((sum, s) => sum + parseFloat(s.sizeMB || "0"), 0);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground animate-pulse py-2">
        Ładowanie nagrań…
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-2">
        Brak plików nagrania w storage.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with total info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono-data">
          <HardDrive className="w-3 h-3" />
          <span>
            {segments.length === 1
              ? `1 plik · ${totalSizeMB.toFixed(0)} MB`
              : `${segments.length} segmentów · ${totalSizeMB.toFixed(0)} MB łącznie`}
          </span>
        </div>
      </div>

      {/* Segment list */}
      <div className="space-y-1">
        {segments.map((seg, idx) => (
          <div key={seg.path} className="group">
            {/* Segment row */}
            <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
              <FileVideo className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-mono-data text-foreground truncate flex-1">
                {segments.length > 1 ? `Part ${seg.partNumber}` : stem}
              </span>
              <span className="text-[10px] font-mono-data text-muted-foreground/60 shrink-0">
                {seg.sizeMB} MB
              </span>
              {seg.signedUrl && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setPlayingIdx(playingIdx === idx ? null : idx)}
                    className="p-1 rounded hover:bg-primary/10 text-primary transition-colors"
                    title={playingIdx === idx ? "Zamknij" : "Odtwórz"}
                  >
                    {playingIdx === idx ? (
                      <Pause className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDownload(seg)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Pobierz"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            {/* Inline player */}
            {playingIdx === idx && seg.signedUrl && (
              <video
                src={seg.signedUrl}
                controls
                autoPlay
                className="w-full rounded-md border border-border bg-black mt-1 mb-1"
                style={{ maxHeight: 200 }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
