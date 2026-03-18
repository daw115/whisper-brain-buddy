import { useState } from "react";
import { Scissors, Eye, Merge, Loader2, Check, AlertCircle, ScanText, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Props {
  meetingId: string;
  hasFrames: boolean;
  onComplete?: (result: any) => void;
}

type Step = "idle" | "crop-split" | "ocr-captions" | "describe-slides" | "aggregate";

const stepConfig: Record<Exclude<Step, "idle">, { label: string; description: string; icon: typeof Scissors; stepNum: number }> = {
  "crop-split": {
    label: "Przytnij i deduplikuj",
    description: "Dzieli klatki na slajdy + napisy, deduplikuje slajdy",
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

export default function SlideTranscriptionButton({ meetingId, hasFrames, onComplete }: Props) {
  const [runningStep, setRunningStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Record<string, any>>({});

  async function runStep(mode: string) {
    setError(null);
    setRunningStep(mode as Step);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("transcribe-slides", {
        body: { meetingId, mode },
      });
      if (fnError) throw new Error(fnError.message || "Błąd wywołania");
      if (data?.error) throw new Error(data.error);

      const stepResults = data?.results ?? {};
      setCompletedSteps(prev => ({ ...prev, [mode]: stepResults }));
      onComplete?.(stepResults);

      toast.success(`Krok ${stepConfig[mode as keyof typeof stepConfig]?.stepNum}: gotowe!`);
    } catch (err: any) {
      setError(err.message || "Nieznany błąd");
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setRunningStep("idle");
    }
  }

  const isRunning = runningStep !== "idle";

  function getStepStatus(step: string): string | null {
    const data = completedSteps[step];
    if (!data) return null;
    if (step === "crop-split" && data.cropSplit) {
      return `${data.cropSplit.total_unique_slides} slajdów, ${data.cropSplit.total_captions} napisów`;
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
          <strong>3)</strong> Przytnij →{" "}
          <strong>4)</strong> OCR napisów →{" "}
          <strong>5)</strong> Opisz slajdy →{" "}
          <strong>6)</strong> Agreguj
        </p>
      </div>
    </div>
  );
}
