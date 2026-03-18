import { useState } from "react";
import { ImageIcon, Loader2, Check, AlertCircle, MessageSquare, Layers, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  meetingId: string;
  hasFrames: boolean;
  onComplete?: (result: any) => void;
}

type Phase = "idle" | "captions" | "slides" | "aggregating" | "done";

export default function SlideTranscriptionButton({ meetingId, hasFrames, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  async function handleTranscribe() {
    setPhase("captions");
    setError(null);

    try {
      // Run both OCR + aggregation in one call (mode: "both")
      toast.info("Krok 1/3: OCR dialogów (napisy z dołu ekranu)…");
      setPhase("captions");

      const { data, error: fnError } = await supabase.functions.invoke("transcribe-slides", {
        body: { meetingId, mode: "both" },
      });

      if (fnError) throw new Error(fnError.message || "Błąd wywołania");
      if (data?.error) throw new Error(data.error);

      setResults(data.results);
      setPhase("done");

      const captionCount = data.results?.captions?.total_entries || 0;
      const slideCount = data.results?.slides?.total_slides || 0;
      toast.success(`Gotowe! ${captionCount} dialogów + ${slideCount} slajdów → zagregowano`);
      onComplete?.(data.results);
    } catch (err: any) {
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
          OCR + agregacja gotowa
        </div>
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          {results.captions && (
            <p className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              Dialogi: {results.captions.total_entries} wypowiedzi
            </p>
          )}
          {results.slides && (
            <p className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              Slajdy: {results.slides.total_slides} unikalnych
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
    captions: "1/3: OCR dialogów…",
    slides: "2/3: OCR slajdów…",
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
            OCR: dialogi + slajdy + agregacja
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

      <div className="text-[9px] text-muted-foreground/70 text-center leading-relaxed space-y-0.5">
        <p>3 etapy: <strong>1)</strong> OCR dialogów (napisy z dołu) → <strong>2)</strong> OCR slajdów → <strong>3)</strong> agregacja obu źródeł</p>
      </div>
    </div>
  );
}
