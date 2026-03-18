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

type SplitPhase = "idle" | "downloading" | "splitting" | "uploading";

const phaseLabels: Record<SplitPhase, string> = {
  idle: "",
  downloading: "Pobieranie nagrania…",
  splitting: "Dzielenie przez FFmpeg…",
  uploading: "Przesyłanie części",
};

export default function RecordingSplitter({ recordingUrl, recordingFilename, recordingSizeBytes, onComplete }: Props) {
  const [chunkMB, setChunkMB] = useState(100);
  const [splitting, setSplitting] = useState(false);
  const [phase, setPhase] = useState<SplitPhase>("idle");
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
    setPhase("downloading");
    setProgress({ current: 0, total: 0, percent: 0 });

    try {
      toast.loading("Pobieranie nagrania…", { id: "split" });

      // 1. Download the file
      const res = await fetch(recordingUrl);
      const blob = await res.blob();
      const inputBytes = new Uint8Array(await blob.arrayBuffer());

      if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");

      // 2. Load FFmpeg
      setPhase("splitting");
      toast.loading("Ładowanie FFmpeg…", { id: "split" });

      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      const ffmpeg = new FFmpeg();

      // Use CDN for the core
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });

      if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");

      // 3. Write input file
      const ext = recordingFilename.match(/\.[^.]+$/)?.[0] || ".webm";
      const inputName = `input${ext}`;
      await ffmpeg.writeFile(inputName, inputBytes);

      // 4. Get duration
      let durationSec = 0;
      ffmpeg.on("log", ({ message }) => {
        const match = message.match(/Duration:\s+(\d+):(\d+):(\d+)\.(\d+)/);
        if (match) {
          durationSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
        }
      });

      // Probe duration with a quick ffmpeg call
      await ffmpeg.exec(["-i", inputName, "-f", "null", "-t", "0", "/dev/null"]).catch(() => {});

      if (durationSec <= 0) {
        // Fallback: estimate from file size and typical bitrate
        // ~2 MB/s is typical for screen recording webm
        durationSec = blob.size / (2 * 1024 * 1024);
        if (durationSec < 10) durationSec = 60; // minimum fallback
      }

      // Calculate segment duration based on desired MB size
      const bytesPerSec = blob.size / durationSec;
      const chunkBytes = chunkMB * 1024 * 1024;
      const segmentDurationSec = Math.max(10, Math.floor(chunkBytes / bytesPerSec));
      const totalParts = Math.ceil(durationSec / segmentDurationSec);

      if (totalParts <= 1) {
        toast.info("Plik jest mniejszy niż zadany rozmiar — nie wymaga podziału", { id: "split" });
        return;
      }

      toast.loading(`Dzielenie na ~${totalParts} części przez FFmpeg…`, { id: "split" });

      // 5. Use FFmpeg segment muxer to split into proper files
      const outputPattern = `part_%03d${ext}`;
      await ffmpeg.exec([
        "-i", inputName,
        "-c", "copy",
        "-f", "segment",
        "-segment_time", String(segmentDurationSec),
        "-reset_timestamps", "1",
        outputPattern,
      ]);

      if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");

      // 6. Read output files
      const parts: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < 999; i++) {
        const partName = `part_${String(i).padStart(3, "0")}${ext}`;
        try {
          const data = await ffmpeg.readFile(partName) as Uint8Array;
          if (data.length > 0) {
            parts.push({ name: partName, data });
          }
        } catch {
          break; // No more parts
        }
      }

      if (parts.length === 0) {
        toast.error("FFmpeg nie wygenerował żadnych segmentów", { id: "split" });
        return;
      }

      // 7. Upload parts
      setPhase("uploading");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      const stem = recordingFilename.replace(/\.[^.]+$/, "");
      let uploaded = 0;
      setProgress({ current: 0, total: parts.length, percent: 0 });

      for (let i = 0; i < parts.length; i++) {
        if (ac.signal.aborted) throw new DOMException("Anulowano", "AbortError");

        const partFilename = `${stem}_part${i + 1}${ext}`;
        const path = `${user.id}/${partFilename}`;
        const partBlob = new Blob([parts[i].data.buffer], { type: blob.type || "video/webm" });

        toast.loading(`Przesyłanie części ${i + 1}/${parts.length}…`, { id: "split" });

        const { error } = await supabase.storage
          .from("recordings")
          .upload(path, partBlob, {
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
          total: parts.length,
          percent: Math.round(((i + 1) / parts.length) * 100),
        });
      }

      // Cleanup FFmpeg
      try {
        await ffmpeg.deleteFile(inputName);
        for (const p of parts) {
          await ffmpeg.deleteFile(p.name).catch(() => {});
        }
        ffmpeg.terminate();
      } catch {}

      toast.success(`Podzielono na ${uploaded}/${parts.length} części (FFmpeg, ~${chunkMB} MB)`, {
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
      setPhase("idle");
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

      {splitting && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {phaseLabels[phase]}
              {phase === "uploading" && progress.total > 0 && ` (${progress.current}/${progress.total})`}
            </span>
            {progress.total > 0 && <span className="font-mono">{progress.percent}%</span>}
          </div>
          <Progress value={phase === "uploading" ? progress.percent : undefined} className="h-1.5" />
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
