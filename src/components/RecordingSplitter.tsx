import { useState, useRef } from "react";
import { Scissors, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

interface Props {
  recordingUrl: string;
  recordingFilename: string;
  recordingSizeBytes?: number | null;
  onComplete?: () => void;
}

export default function RecordingSplitter({ recordingUrl, recordingFilename, recordingSizeBytes, onComplete }: Props) {
  const [chunkMB, setChunkMB] = useState(100);
  const [splitting, setSplitting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const totalMB = recordingSizeBytes ? Math.round(recordingSizeBytes / (1024 * 1024)) : null;
  const estimatedParts = totalMB ? Math.ceil(totalMB / chunkMB) : null;

  function handleCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function handleSplit() {
    const ac = new AbortController();
    abortRef.current = ac;
    setSplitting(true);
    setProgress({ current: 0, total: 0, percent: 0 });

    try {
      toast.loading("Pobieranie nagrania…", { id: "split" });
      const res = await fetch(recordingUrl);
      const blob = await res.blob();

      if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");

      const chunkBytes = chunkMB * 1024 * 1024;
      const totalParts = Math.ceil(blob.size / chunkBytes);

      if (totalParts <= 1) {
        toast.info("Plik jest mniejszy niż zadany rozmiar — nie wymaga podziału", { id: "split" });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      const stem = recordingFilename.replace(/\.[^.]+$/, "");
      const ext = recordingFilename.match(/\.[^.]+$/)?.[0] || ".webm";
      let uploaded = 0;

      setProgress({ current: 0, total: totalParts, percent: 0 });
      toast.loading(`Dzielenie na ${totalParts} części…`, { id: "split" });

      for (let i = 0; i < totalParts; i++) {
        if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");

        const start = i * chunkBytes;
        const end = Math.min(start + chunkBytes, blob.size);
        const chunk = blob.slice(start, end, blob.type);

        const partFilename = `${stem}_part${i + 1}${ext}`;
        const path = `${user.id}/${partFilename}`;

        const { error } = await supabase.storage
          .from("recordings")
          .upload(path, chunk, {
            contentType: blob.type || "video/webm",
            upsert: true,
          });

        if (error) {
          console.error(`Upload part ${i + 1} error:`, error);
        } else {
          uploaded++;
        }

        setProgress({
          current: i + 1,
          total: totalParts,
          percent: Math.round(((i + 1) / totalParts) * 100),
        });
      }

      toast.success(`Podzielono na ${uploaded}/${totalParts} części (po ${chunkMB} MB)`, {
        id: "split",
        duration: 5000,
      });
      onComplete?.();
    } catch (err: any) {
      if (err?.name === "AbortError") {
        toast.info("Podział anulowany", { id: "split" });
      } else {
        console.error("Split error:", err);
        toast.error("Błąd: " + (err.message || "nieznany"), { id: "split" });
      }
    } finally {
      abortRef.current = null;
      setSplitting(false);
      setProgress({ current: 0, total: 0, percent: 0 });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Scissors className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground">Podziel plik na części po:</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={5}
            max={500}
            value={chunkMB}
            onChange={(e) => {
              const num = parseInt(e.target.value);
              if (num >= 5 && num <= 500) setChunkMB(num);
            }}
            disabled={splitting}
            className="w-16 text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground text-center"
          />
          <span className="text-[10px] text-muted-foreground">MB</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {[25, 50, 100, 200].map((v) => (
          <button
            key={v}
            onClick={() => setChunkMB(v)}
            disabled={splitting}
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

      {estimatedParts && estimatedParts > 1 && !splitting && (
        <p className="text-[10px] text-muted-foreground">
          ~{totalMB} MB → {estimatedParts} części
        </p>
      )}

      {splitting && progress.total > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Przesyłanie części ({progress.current}/{progress.total})</span>
            <span className="font-mono">{progress.percent}%</span>
          </div>
          <Progress value={progress.percent} className="h-1.5" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSplit}
          disabled={splitting}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {splitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Dzielenie…
            </>
          ) : (
            <>
              <Scissors className="w-3.5 h-3.5" />
              Podziel nagranie
            </>
          )}
        </button>

        {splitting && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1 text-[10px] font-medium text-destructive hover:text-destructive/80 transition-colors"
          >
            <X className="w-3 h-3" />
            Anuluj
          </button>
        )}
      </div>
    </div>
  );
}
