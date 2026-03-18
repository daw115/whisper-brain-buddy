import { useState } from "react";
import { RefreshCw, Loader2, Check, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  recordingUrl: string;
  recordingFilename: string;
  onComplete?: (count: number) => void;
}

export default function FrameRegenerator({ recordingUrl, recordingFilename, onComplete }: Props) {
  const [interval, setInterval] = useState(30);
  const [customInterval, setCustomInterval] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");

  async function handleRegenerate() {
    setGenerating(true);
    setProgress("Pobieranie nagrania…");

    try {
      // Fetch video blob
      const res = await fetch(recordingUrl);
      const videoBlob = await res.blob();

      setProgress("Wyodrębnianie klatek…");

      // Dynamic import frame extractor
      const { extractFrames, uploadFrames } = await import("@/lib/frame-extractor");

      const frames = await extractFrames(videoBlob, interval, 50);
      if (frames.length === 0) {
        toast.warning("Nie udało się wyodrębnić żadnych klatek");
        return;
      }

      setProgress(`Przesyłanie ${frames.length} klatek…`);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      const stem = recordingFilename.replace(/\.[^.]+$/, "");
      const paths = await uploadFrames(supabase, user.id, stem, frames);

      toast.success(`Wygenerowano ${paths.length} klatek (co ${interval}s)`);
      onComplete?.(paths.length);
    } catch (err: any) {
      console.error("Frame regen error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setGenerating(false);
      setProgress("");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Settings2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground">Interwał:</span>
        <select
          value={interval}
          onChange={(e) => setInterval(Number(e.target.value))}
          disabled={generating}
          className="text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground"
        >
          <option value={10}>co 10s</option>
          <option value={15}>co 15s</option>
          <option value={20}>co 20s</option>
          <option value={30}>co 30s</option>
          <option value={45}>co 45s</option>
          <option value={60}>co 60s</option>
        </select>
      </div>

      <button
        onClick={handleRegenerate}
        disabled={generating}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {generating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {progress}
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
