import { useState } from "react";
import { ImageIcon, Loader2, Check, AlertCircle, MessageSquare, Images, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  meetingId: string;
  hasFrames: boolean;
  onComplete?: (result: any) => void;
}

type Phase = "idle" | "frames" | "captions" | "aggregating" | "done";

export default function SlideTranscriptionButton({ meetingId, hasFrames, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  async function runStep(mode: string) {
    const { data, error: fnError } = await supabase.functions.invoke("transcribe-slides", {
      body: { meetingId, mode },
    });
    if (fnError) throw new Error(fnError.message || "Błąd wywołania");
    if (data?.error) throw new Error(data.error);
    onComplete?.(data?.results ?? null);
    return data?.results ?? {};
  }

  async function handleTranscribe() {
    setError(null);
    setResults(null);

    try {
      toast.info("Krok 1/3: Identyfikacja unikalnych klatek…");
      setPhase("frames");
      const framesResult = await runStep("unique-frames");

      toast.info("Krok 2/3: OCR dialogów (napisy z dołu ekranu)…");
      setPhase("captions");
      const captionsResult = await runStep("captions");

      toast.info("Krok 3/3: Agregacja dialogów + audio…");
      setPhase("aggregating");
      const aggResult = await runStep("aggregate");

      const merged = { ...framesResult, ...captionsResult, ...aggResult };
      setResults(merged);
      setPhase("done");

      const uniqueCount = merged?.uniqueFrames?.total_unique || 0;
      const captionCount = merged?.captions?.total_entries || 0;
      toast.success(`Gotowe! ${uniqueCount} unikalnych klatek, ${captionCount} dialogów → zagregowano`);
    } catch (err: any) {
      onComplete?.(null);
      setError(err.message || "Nieznany błąd");
      toast.error("Błąd: " + (err.message || "nieznany"));
      setPhase("idle");
    }
  }

  if (phase === "done" && results) {
    return (
      <div className="space-y-2 border border-border rounded-md p-3">
        <div className="flex items-center gap-2 text-sm text-primary">
          <Check className="w-4 h-4" />
          Przetwarzanie gotowe
        </div>
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          {results.uniqueFrames && (
            <p className="flex items-center gap-1">
              <Images className="w-3 h-3" />
              Unikalne klatki: {results.uniqueFrames.total_unique}
            </p>
          )}
          {results.captions && (
            <p className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              Dialogi: {results.captions.total_entries} wypowiedzi
            </p>
          )}
          {results.aggregated && (
            <p className="flex items-center gap-1">
              <Merge className="w-3 h-3" />
              Zagregowana transkrypcja: {(results.aggregated.integrated_transcript?.length / 1000).toFixed(1)}k znaków
            </p>
          )}
        </div>
        <button
          onClick={() => { setPhase("idle"); setResults(null); }}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Uruchom ponownie
        </button>
      </div>
    );
  }

  const phaseLabels: Record<string, string> = {
    frames: "1/3: Unikalne klatki…",
    captions: "2/3: OCR dialogów…",
    aggregating: "3/3: Agregacja…",
  };

  const isRunning = phase !== "idle" && phase !== "done";

  return (
    <div className="space-y-2">
      <button
        onClick={handleTranscribe}
        disabled={isRunning || !hasFrames}
        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 press-effect w-full justify-center"
      >
        {isRunning ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {phaseLabels[phase] || "Przetwarzam…"}
          </>
        ) : (
          <>
            <ImageIcon className="w-3.5 h-3.5" />
            OCR: klatki + dialogi + agregacja
          </>
        )}
      </button>

      {!hasFrames && (
        <p className="text-[10px] text-muted-foreground text-center">Najpierw wygeneruj klatki</p>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </p>
      )}

      <div className="text-[9px] text-muted-foreground/70 text-center leading-relaxed">
        <p>3 kroki: <strong>1)</strong> dedup klatek → <strong>2)</strong> OCR dialogów → <strong>3)</strong> agregacja z audio</p>
        <p>Unikalne slajdy trafią do paczki ChatGPT</p>
      </div>
    </div>
  );
}
