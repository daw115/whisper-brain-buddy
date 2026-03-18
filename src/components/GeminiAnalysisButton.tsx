import { useState } from "react";
import { Brain, Loader2, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  meetingId: string;
  hasFrames: boolean;
  onComplete?: (analysis: any) => void;
}

export default function GeminiAnalysisButton({ meetingId, hasFrames, onComplete }: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("analyze-meeting", {
        body: { meetingId },
      });

      if (fnError) throw new Error(fnError.message || "Błąd wywołania");
      if (data?.error) throw new Error(data.error);

      setDone(true);
      toast.success("Analiza Gemini zakończona");
      onComplete?.(data.analysis);
    } catch (err: any) {
      setError(err.message || "Nieznany błąd");
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setAnalyzing(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-primary py-1">
        <Check className="w-4 h-4" />
        Analiza Gemini gotowa
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleAnalyze}
        disabled={analyzing}
        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 press-effect w-full justify-center"
      >
        {analyzing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Gemini analizuje…
          </>
        ) : (
          <>
            <Brain className="w-3.5 h-3.5" />
            Analizuj z Gemini
          </>
        )}
      </button>
      <p className="text-[10px] text-muted-foreground text-center">
        {hasFrames ? "Slajdy + transkrypt → analiza multimodalna" : "Tylko transkrypt"}
      </p>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
