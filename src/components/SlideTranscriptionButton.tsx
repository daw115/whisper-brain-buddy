import { useState } from "react";
import { ImageIcon, Loader2, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  meetingId: string;
  hasFrames: boolean;
  onComplete?: (result: any) => void;
}

export default function SlideTranscriptionButton({ meetingId, hasFrames, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTranscribe() {
    setRunning(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("transcribe-slides", {
        body: { meetingId },
      });

      if (fnError) throw new Error(fnError.message || "Błąd wywołania");
      if (data?.error) throw new Error(data.error);

      setDone(true);
      toast.success(`Transkrypcja slajdów gotowa — ${data.result?.total_slides || "?"} slajdów`);
      onComplete?.(data.result);
    } catch (err: any) {
      setError(err.message || "Nieznany błąd");
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setRunning(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-primary py-1">
        <Check className="w-4 h-4" />
        Transkrypcja slajdów gotowa
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleTranscribe}
        disabled={running || !hasFrames}
        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 press-effect w-full justify-center"
      >
        {running ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Gemini odczytuje slajdy…
          </>
        ) : (
          <>
            <ImageIcon className="w-3.5 h-3.5" />
            Transkrybuj slajdy (OCR)
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

      <p className="text-[9px] text-muted-foreground/70 text-center leading-relaxed">
        Gemini odczyta treść z każdego slajdu → transkrypcja wizualna → input do analizy
      </p>
    </div>
  );
}
