import { useState } from "react";
import { RefreshCw, Loader2, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import type { ProgressInfo } from "@/lib/frame-extractor";

interface Props {
  recordingUrl: string;
  recordingFilename: string;
  onComplete?: (count: number) => void;
}

const phaseLabels: Record<string, string> = {
  loading: "Ładowanie wideo…",
  extracting: "Wyodrębnianie klatek",
  uploading: "Przesyłanie klatek",
};

export default function FrameRegenerator({ recordingUrl, recordingFilename, onComplete }: Props) {
  const [interval, setInterval] = useState(30);
  const [customInterval, setCustomInterval] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);

  const overallPercent = (() => {
    if (!progressInfo) return 0;
    const weights = { loading: 5, extracting: 70, uploading: 25 };
    const offsets = { loading: 0, extracting: 5, uploading: 75 };
    const w = weights[progressInfo.phase] || 0;
    const o = offsets[progressInfo.phase] || 0;
    return Math.round(o + (progressInfo.percent / 100) * w);
  })();

  async function handleRegenerate() {
    setGenerating(true);
    setProgressInfo({ phase: "loading", current: 0, total: 1, percent: 0 });

    try {
      const res = await fetch(recordingUrl);
      const videoBlob = await res.blob();

      const { extractFrames, uploadFrames } = await import("@/lib/frame-extractor");

      const frames = await extractFrames(videoBlob, interval, 50, setProgressInfo);
      if (frames.length === 0) {
        toast.warning("Nie udało się wyodrębnić żadnych klatek");
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      const stem = recordingFilename.replace(/\.[^.]+$/, "");
      const paths = await uploadFrames(supabase, user.id, stem, frames, setProgressInfo);

      toast.success(`Wygenerowano ${paths.length} klatek (co ${interval}s)`);
      onComplete?.(paths.length);
    } catch (err: any) {
      console.error("Frame regen error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setGenerating(false);
      setProgressInfo(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Settings2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground">Interwał:</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={300}
            value={customInterval || interval}
            onChange={(e) => {
              const val = e.target.value;
              setCustomInterval(val);
              const num = parseInt(val);
              if (num >= 1 && num <= 300) setInterval(num);
            }}
            disabled={generating}
            className="w-16 text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground text-center"
            placeholder="30"
          />
          <span className="text-[10px] text-muted-foreground">sek</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {[5, 10, 15, 30, 60].map((v) => (
          <button
            key={v}
            onClick={() => { setInterval(v); setCustomInterval(String(v)); }}
            disabled={generating}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              interval === v
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {v}s
          </button>
        ))}
      </div>

      {generating && progressInfo && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {phaseLabels[progressInfo.phase] || progressInfo.phase}
              {progressInfo.phase !== "loading" && ` (${progressInfo.current}/${progressInfo.total})`}
            </span>
            <span className="font-mono">{overallPercent}%</span>
          </div>
          <Progress value={overallPercent} className="h-1.5" />
        </div>
      )}

      <button
        onClick={handleRegenerate}
        disabled={generating}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {generating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Przetwarzanie…
          </>
        ) : (
          <>
            <RefreshCw className="w-3.5 h-3.5" />
            Regeneruj klatki
          </>
        )}
      </button>
    </div>
  );
}
