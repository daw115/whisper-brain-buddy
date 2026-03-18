import { useState } from "react";
import { Brain, Loader2, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  meetingId: string;
  hasTranscript: boolean;
  hasFrames: boolean;
}

export default function AIAnalysisButton({ meetingId, hasTranscript, hasFrames }: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("analyze-meeting", {
        body: { meetingId },
      });

      if (fnError) {
        throw new Error(fnError.message || "Błąd wywołania funkcji");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Invalidate caches
      qc.invalidateQueries({ queryKey: ["meeting", meetingId] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["all-action-items"] });

      setDone(true);
      toast.success("Analiza AI zakończona — wyniki zapisane");
    } catch (err: any) {
      const msg = err.message || "Nieznany błąd";
      setError(msg);
      toast.error("Błąd analizy: " + msg);
    } finally {
      setAnalyzing(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-primary py-2">
        <Check className="w-4 h-4" />
        Analiza AI zakończona
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleAnalyze}
        disabled={analyzing}
        className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 press-effect w-full justify-center"
      >
        {analyzing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Analizuję z AI…
          </>
        ) : (
          <>
            <Brain className="w-4 h-4" />
            Analizuj z AI
          </>
        )}
      </button>

      {!analyzing && (
        <p className="text-[10px] text-muted-foreground text-center">
          {hasTranscript && hasFrames
            ? "Transkrypt + slajdy → pełna analiza"
            : hasFrames
            ? "Tylko slajdy — analiza wizualna"
            : hasTranscript
            ? "Tylko transkrypt — analiza tekstowa"
            : "Brak danych — uruchom nagranie najpierw"}
        </p>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
