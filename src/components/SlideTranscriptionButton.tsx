import { useState, useEffect, useCallback } from "react";
import { Scissors, Eye, Merge, Loader2, Check, AlertCircle, ScanText, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Props {
  meetingId: string;
  hasFrames: boolean;
  recordingFilename: string;
  onComplete?: (result: any) => void;
}

type Step = "idle" | "crop-split" | "ocr-captions" | "describe-slides" | "aggregate";

const stepConfig: Record<Exclude<Step, "idle">, { label: string; description: string; icon: typeof Scissors; stepNum: number }> = {
  "crop-split": {
    label: "Deduplikuj klatki",
    description: "Hashuje klatki i usuwa duplikaty (lokalnie w przeglądarce)",
    icon: Scissors,
    stepNum: 3,
  },
  "ocr-captions": {
    label: "OCR napisów Teams",
    description: "Odczytuje tekst z pasków napisów → transkrypcja",
    icon: ScanText,
    stepNum: 4,
  },
  "describe-slides": {
    label: "Opisz slajdy",
    description: "Analizuje treść unikalnych slajdów prezentacji",
    icon: Eye,
    stepNum: 5,
  },
  aggregate: {
    label: "Agreguj transkrypcję",
    description: "Łączy audio + OCR + slajdy w jedną transkrypcję",
    icon: Merge,
    stepNum: 6,
  },
};

// Hash raw JPEG bytes for dedup (no image decoding needed)
function hashBytes(bytes: Uint8Array): string {
  let hash = 0;
  const start = Math.min(500, bytes.length);
  const end = Math.min(bytes.length, 8000);
  for (let i = start; i < end; i += 3) {
    hash = ((hash << 5) - hash + bytes[i]) | 0;
  }
  return hash.toString(36);
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function SlideTranscriptionButton({ meetingId, hasFrames, recordingFilename, onComplete }: Props) {
  const [runningStep, setRunningStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Record<string, any>>({});
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // Step 3: Client-side frame deduplication
  async function runLocalDedup() {
    setError(null);
    setRunningStep("crop-split");
    setBatchProgress("Ładowanie listy klatek...");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      const stem = recordingFilename.replace(/\.[^.]+$/, "");
      
      // Find all frame directories
      const { data: allDirs } = await supabase.storage
        .from("recordings")
        .list(`${user.id}/frames`);

      const dirPrefixes = [`${user.id}/frames/${stem}`];
      if (allDirs) {
        for (const d of allDirs) {
          if (d.name.startsWith(stem + "_part") || d.name.startsWith(stem + "_sub")) {
            dirPrefixes.push(`${user.id}/frames/${d.name}`);
          }
        }
      }

      // Collect all frame paths
      const allFrames: { path: string; timestamp: number }[] = [];
      for (const prefix of dirPrefixes) {
        const { data: files } = await supabase.storage
          .from("recordings")
          .list(prefix, { limit: 200, sortBy: { column: "name", order: "asc" } });
        if (files) {
          for (const f of files) {
            if (!f.name.match(/\.(jpg|jpeg|png)$/i)) continue;
            const m = f.name.match(/frame_(\d+)/);
            allFrames.push({ path: `${prefix}/${f.name}`, timestamp: m ? parseInt(m[1]) : 0 });
          }
        }
      }

      allFrames.sort((a, b) => a.timestamp - b.timestamp);
      if (allFrames.length === 0) throw new Error("Brak klatek — najpierw wygeneruj klatki");

      setBatchProgress(`Znaleziono ${allFrames.length} klatek, deduplikuję...`);

      // Download and hash each frame for dedup
      const seenHashes = new Map<string, number>();
      const uniqueFrames: { path: string; timestamp: number; ts_formatted: string }[] = [];

      for (let i = 0; i < allFrames.length; i++) {
        const frame = allFrames[i];
        
        if (i % 10 === 0) {
          setBatchProgress(`${i + 1}/${allFrames.length} klatek, ${uniqueFrames.length} unikalnych`);
        }

        const { data: blob } = await supabase.storage
          .from("recordings")
          .download(frame.path);
        if (!blob) continue;

        const bytes = new Uint8Array(await blob.arrayBuffer());
        const frameHash = hashBytes(bytes);
        const tsFormatted = formatTs(frame.timestamp);

        if (!seenHashes.has(frameHash)) {
          seenHashes.set(frameHash, frame.timestamp);
          uniqueFrames.push({ path: frame.path, timestamp: frame.timestamp, ts_formatted: tsFormatted });
        }
      }

      setBatchProgress(`Zapisuję wynik: ${uniqueFrames.length} unikalnych z ${allFrames.length}...`);

      // Save result to meeting_analyses
      // Delete previous crop-split data first
      await (supabase as any).from("meeting_analyses").delete()
        .eq("meeting_id", meetingId).eq("source", "crop-split");

      const cropData = {
        unique_slides: uniqueFrames,
        caption_crops: allFrames.map(f => ({ path: f.path, timestamp: f.timestamp, ts_formatted: formatTs(f.timestamp) })),
        total_frames: allFrames.length,
        total_unique_slides: uniqueFrames.length,
        total_captions: allFrames.length,
      };

      const { error: saveErr } = await (supabase as any).from("meeting_analyses").insert({
        meeting_id: meetingId,
        source: "crop-split",
        analysis_json: cropData,
      });
      if (saveErr) throw new Error("Błąd zapisu: " + saveErr.message);

      setCompletedSteps(prev => ({ ...prev, "crop-split": { cropSplit: cropData } }));
      onComplete?.({ cropSplit: cropData });
      toast.success(`Krok 3: ${uniqueFrames.length} unikalnych klatek z ${allFrames.length}`);
    } catch (err: any) {
      setError(err.message || "Nieznany błąd");
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setRunningStep("idle");
      setBatchProgress(null);
    }
  }

  async function runStep(mode: string) {
    if (mode === "crop-split") {
      return runLocalDedup();
    }

    setError(null);
    setRunningStep(mode as Step);
    setBatchProgress(null);

    try {
      const isBatchedMode = mode === "ocr-captions" || mode === "describe-slides";
      const requestedBatchSize = mode === "ocr-captions" ? 12 : mode === "describe-slides" ? 8 : null;
      let nextOffset = 0;
      let latestResults: any = null;

      while (true) {
        const body = isBatchedMode
          ? { meetingId, mode, batchOffset: nextOffset, batchSize: requestedBatchSize }
          : { meetingId, mode };

        const { data, error: fnError } = await supabase.functions.invoke("transcribe-slides", { body });
        if (fnError) throw new Error(fnError.message || "Błąd wywołania");
        if (data?.error) throw new Error(data.error);

        latestResults = data?.results ?? {};
        setCompletedSteps((prev) => ({ ...prev, [mode]: latestResults }));

        const partial = mode === "ocr-captions"
          ? latestResults.captions
          : mode === "describe-slides"
            ? latestResults.slideDescriptions
            : null;

        if (mode === "ocr-captions" && partial) {
          setBatchProgress(`OCR: ${partial.processed_frames}/${partial.frames_total} klatek`);
        }
        if (mode === "describe-slides" && partial) {
          setBatchProgress(`Slajdy: ${partial.processed_slides}/${partial.slides_total}`);
        }

        if (!isBatchedMode || !partial?.has_more || partial?.next_offset == null) {
          break;
        }

        nextOffset = partial.next_offset;
      }

      onComplete?.(latestResults ?? {});
      toast.success(`Krok ${stepConfig[mode as keyof typeof stepConfig]?.stepNum}: gotowe!`);
    } catch (err: any) {
      setError(err.message || "Nieznany błąd");
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setRunningStep("idle");
      setBatchProgress(null);
    }
  }

  const isRunning = runningStep !== "idle";

  function getStepStatus(step: string): string | null {
    const data = completedSteps[step];
    if (!data) return null;
    if (step === "crop-split" && data.cropSplit) {
      return `${data.cropSplit.total_unique_slides} unikalnych z ${data.cropSplit.total_frames} klatek`;
    }
    if (step === "ocr-captions" && data.captions) {
      return `${data.captions.total_entries} wypowiedzi`;
    }
    if (step === "describe-slides" && data.slideDescriptions) {
      return `${data.slideDescriptions.slides?.length ?? 0} opisów`;
    }
    if (step === "aggregate" && data.aggregated) {
      return `${(data.aggregated.integrated_transcript?.length / 1000).toFixed(1)}k znaków`;
    }
    return "gotowe";
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
        Pipeline OCR slajdów
      </p>

      {(Object.keys(stepConfig) as Exclude<Step, "idle">[]).map((step) => {
        const config = stepConfig[step];
        const Icon = config.icon;
        const status = getStepStatus(step);
        const isThisRunning = runningStep === step;
        const disabled = isRunning || !hasFrames;

        return (
          <div key={step} className="space-y-0.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runStep(step)}
              disabled={disabled}
              className="w-full justify-start gap-2 text-xs h-8"
            >
              {isThisRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              ) : status ? (
                <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              ) : (
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              )}
              <span>
                {config.stepNum}. {isThisRunning ? `${config.label}…` : config.label}
              </span>
            </Button>
            {isThisRunning && batchProgress && (
              <p className="text-[9px] text-muted-foreground pl-6 animate-pulse">⏳ {batchProgress}</p>
            )}
            {status && (
              <p className="text-[9px] text-muted-foreground pl-6">✓ {status}</p>
            )}
          </div>
        );
      })}

      {!hasFrames && (
        <p className="text-[10px] text-muted-foreground text-center">
          Najpierw wygeneruj klatki (kroki 1-2)
        </p>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </p>
      )}

      <div className="text-[9px] text-muted-foreground/70 text-center leading-relaxed">
        <p>
          <strong>1-2)</strong> Klatki (powyżej) →{" "}
          <strong>3)</strong> Deduplikuj (lokalnie) →{" "}
          <strong>4)</strong> OCR napisów →{" "}
          <strong>5)</strong> Opisz slajdy →{" "}
          <strong>6)</strong> Agreguj
        </p>
      </div>
    </div>
  );
}
