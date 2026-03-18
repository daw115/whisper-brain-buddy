import { useState, useEffect, useMemo } from "react";
import { Eye, Copy, Check, Hash, Image, FileText, Clock, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { DbTranscriptLine } from "@/hooks/use-meetings";
import { toast } from "sonner";

interface FrameInfo {
  url: string;
  timestampSec: number;
  label: string;
}

interface Props {
  meetingId: string;
  meetingTitle: string;
  transcriptLines: DbTranscriptLine[];
  recordingFilename?: string | null;
  framesVersion?: number;
}

/** Parse "MM:SS" or "HH:MM:SS" to seconds */
function parseTs(ts: string): number {
  const parts = ts.replace(/[\[\]]/g, "").split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function secToLabel(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export default function AIInputPreview({ meetingId, meetingTitle, transcriptLines, recordingFilename, framesVersion = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [copied, setCopied] = useState(false);

  // Load frames
  useEffect(() => {
    if (!open || !recordingFilename) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const stem = recordingFilename.replace(/\.[^.]+$/, "").replace(/_part\d+$/, "");
      const prefixes = [`${user.id}/frames/${stem}`];
      const { data: dirs } = await supabase.storage.from("recordings").list(`${user.id}/frames`, { limit: 200 });
      if (dirs) {
        for (const d of dirs) {
          if (d.name.startsWith(stem + "_part") && d.id) prefixes.push(`${user.id}/frames/${d.name}`);
        }
      }

      const allFrames: FrameInfo[] = [];
      for (const prefix of prefixes) {
        const { data: files } = await supabase.storage.from("recordings").list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } });
        if (!files) continue;
        const paths = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f.name)).map(f => `${prefix}/${f.name}`);
        if (paths.length === 0) continue;
        const { data: signed } = await supabase.storage.from("recordings").createSignedUrls(paths, 3600);
        if (!signed) continue;
        for (let i = 0; i < signed.length; i++) {
          if (!signed[i].signedUrl) continue;
          const match = files[i].name.match(/frame_(\d+)s?\./);
          const sec = match ? parseInt(match[1]) : 0;
          const segMatch = prefix.match(/_part(\d+)$/);
          const label = segMatch ? `S${segMatch[1]}/${secToLabel(sec)}` : secToLabel(sec);
          allFrames.push({ url: signed[i].signedUrl, timestampSec: sec, label });
        }
      }
      allFrames.sort((a, b) => a.timestampSec - b.timestampSec);
      setFrames(allFrames);
    })();
  }, [open, recordingFilename, framesVersion]);

  // Build merged transcript with slide markers
  const mergedText = useMemo(() => {
    if (transcriptLines.length === 0) return "";

    const sorted = [...transcriptLines].sort((a, b) => a.line_order - b.line_order);
    const lines: string[] = [];

    // Convert frames to a set of timestamps we can insert
    const slideMarkers = new Map<number, string>();
    for (const f of frames) {
      slideMarkers.set(f.timestampSec, f.label);
    }

    // Find nearest frame for each transcript line
    let nextSlideIdx = 0;
    const sortedFramesSec = frames.map(f => f.timestampSec).sort((a, b) => a - b);

    for (const line of sorted) {
      const lineSec = parseTs(line.timestamp);

      // Insert any slide markers that should appear before this line
      while (nextSlideIdx < sortedFramesSec.length && sortedFramesSec[nextSlideIdx] <= lineSec) {
        lines.push(`\n📊 [SLAJD @ ${secToLabel(sortedFramesSec[nextSlideIdx])}]\n`);
        nextSlideIdx++;
      }

      lines.push(`[${line.timestamp}] ${line.speaker}: ${line.text}`);
    }

    // Remaining slides after last transcript line
    while (nextSlideIdx < sortedFramesSec.length) {
      lines.push(`\n📊 [SLAJD @ ${secToLabel(sortedFramesSec[nextSlideIdx])}]\n`);
      nextSlideIdx++;
    }

    return lines.join("\n");
  }, [transcriptLines, frames]);

  const stats = {
    lines: transcriptLines.length,
    frames: frames.length,
    chars: mergedText.length,
    segments: new Set(transcriptLines.map(l => l.speaker).filter(s => s.startsWith("Seg"))).size,
  };

  function handleCopy() {
    navigator.clipboard.writeText(mergedText);
    setCopied(true);
    toast.success("Skopiowano scalone dane AI");
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-border bg-card hover:bg-muted transition-colors"
      >
        <Eye className="w-4 h-4" />
        Podgląd danych dla AI
      </button>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-foreground">Podgląd pakietu AI</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Skopiowano" : "Kopiuj"}
          </button>
          <button onClick={() => setOpen(false)} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-[10px] font-mono-data text-muted-foreground">
        <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{stats.lines} linii</span>
        <span className="flex items-center gap-1"><Image className="w-3 h-3" />{stats.frames} klatek</span>
        <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{stats.chars} znaków</span>
        {stats.segments > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{stats.segments} segmentów</span>}
      </div>

      {/* Frame thumbnails */}
      {frames.length > 0 && (
        <div className="px-4 py-2 border-b border-border">
          <p className="text-[10px] text-muted-foreground mb-1.5">Klatki w kontekście (znaczniki 📊 w transkrypcie):</p>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {frames.slice(0, 12).map((f, i) => (
              <div key={i} className="shrink-0 relative">
                <img src={f.url} alt={`Slajd @ ${f.label}`} className="h-12 aspect-video object-cover rounded border border-border" loading="lazy" />
                <span className="absolute bottom-0 right-0 text-[7px] font-mono-data bg-background/80 px-0.5 rounded-tl">{f.label}</span>
              </div>
            ))}
            {frames.length > 12 && <span className="text-[10px] text-muted-foreground self-center ml-1">+{frames.length - 12}</span>}
          </div>
        </div>
      )}

      {/* Merged transcript preview */}
      <div className="max-h-64 overflow-auto">
        {mergedText ? (
          <pre className="p-4 text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap font-mono-data">
            {mergedText}
          </pre>
        ) : (
          <p className="p-4 text-sm text-muted-foreground italic">Brak danych — wygeneruj transkrypcję i/lub klatki.</p>
        )}
      </div>
    </div>
  );
}
