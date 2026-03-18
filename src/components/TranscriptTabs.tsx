import { useState, useMemo } from "react";
import { Mic, Layers, Merge } from "lucide-react";
import TranscriptView from "@/components/TranscriptView";
import type { MeetingWithRelations } from "@/hooks/use-meetings";

interface AnalysisEntry {
  source: string;
  analysis_json: any;
}

interface Props {
  meeting: MeetingWithRelations;
  analyses: AnalysisEntry[];
  framesVersion?: number;
  onDeleteTranscript: () => void;
}

type Tab = "audio" | "slides" | "aggregated";

export default function TranscriptTabs({ meeting, analyses, onDeleteTranscript }: Props) {
  const [tab, setTab] = useState<Tab>("audio");

  const slideTranscript = useMemo(() => {
    const entry = analyses.find(a => a.source === "slide-transcript");
    return entry?.analysis_json as { slide_transcript?: string; slides?: any[]; total_slides?: number } | null;
  }, [analyses]);

  const aggregated = useMemo(() => {
    const entry = analyses.find(a => a.source === "merged");
    return entry?.analysis_json as { integrated_transcript?: string; summary?: string; slide_dialogue_correlations?: any[] } | null;
  }, [analyses]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: string }[] = [
    {
      key: "audio",
      label: "Audio",
      icon: <Mic className="w-3 h-3" />,
      count: meeting.transcript_lines?.length ? `${meeting.transcript_lines.length}` : undefined,
    },
    {
      key: "slides",
      label: "Slajdy OCR",
      icon: <Layers className="w-3 h-3" />,
      count: slideTranscript?.total_slides ? `${slideTranscript.total_slides}` : undefined,
    },
    {
      key: "aggregated",
      label: "Agregacja",
      icon: <Merge className="w-3 h-3" />,
      count: aggregated ? "✓" : undefined,
    },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
            {t.count && (
              <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full font-mono-data">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Audio tab */}
      {tab === "audio" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-muted-foreground">Transkrypcja z audio (Web Speech / Whisper)</span>
            {meeting.transcript_lines && meeting.transcript_lines.length > 0 && (
              <button onClick={onDeleteTranscript} className="text-[10px] text-destructive hover:text-destructive/80 transition-colors">
                Wyczyść
              </button>
            )}
          </div>
          {meeting.transcript_lines && meeting.transcript_lines.length > 0 ? (
            <TranscriptView lines={meeting.transcript_lines} meetingTitle={meeting.title} />
          ) : (
            <p className="text-sm text-muted-foreground italic">Brak transkrypcji audio.</p>
          )}
        </div>
      )}

      {/* Slides OCR tab */}
      {tab === "slides" && (
        <div>
          <span className="text-[10px] text-muted-foreground block mb-3">
            Treść slajdów prezentacji (OCR z głównej części ekranu)
          </span>
          {slideTranscript?.slides && slideTranscript.slides.length > 0 ? (
            <div className="space-y-3">
              {slideTranscript.slides.map((slide: any, i: number) => (
                <div key={i} className="border border-border rounded-md p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono-data text-muted-foreground">
                      📊 {slide.timestamp}
                    </span>
                    {slide.slide_type && (
                      <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {slide.slide_type}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-foreground mb-1">{slide.title}</p>
                  <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed">{slide.full_text}</p>
                  {slide.data_values && (
                    <p className="text-[10px] text-primary/80 mt-1">📈 {slide.data_values}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Brak danych OCR slajdów. Uruchom "OCR: dialogi + slajdy + agregacja".
            </p>
          )}
        </div>
      )}

      {/* Aggregated tab */}
      {tab === "aggregated" && (
        <div>
          <span className="text-[10px] text-muted-foreground block mb-3">
            Zagregowana transkrypcja: dialogi + slajdy + audio w jednym chronologicznym zapisie
          </span>
          {aggregated?.integrated_transcript ? (
            <div>
              {aggregated.summary && (
                <div className="bg-primary/5 border border-primary/20 rounded-md p-3 mb-3">
                  <p className="text-xs text-foreground leading-relaxed">{aggregated.summary}</p>
                </div>
              )}
              <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap font-mono-data leading-relaxed max-h-[60vh] overflow-y-auto">
                {aggregated.integrated_transcript}
              </pre>
              {aggregated.slide_dialogue_correlations && aggregated.slide_dialogue_correlations.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border">
                  <p className="text-[10px] font-medium text-foreground mb-2">🔗 Korelacje slajd↔dialog:</p>
                  <div className="space-y-2">
                    {aggregated.slide_dialogue_correlations.map((c: any, i: number) => (
                      <div key={i} className="text-[10px] bg-muted/30 rounded p-2">
                        <span className="font-mono-data text-muted-foreground">{c.slide_timestamp}</span>{" "}
                        <span className="font-medium text-foreground">{c.slide_title}</span>
                        {c.extra_verbal_info && (
                          <p className="text-muted-foreground mt-0.5">💬 {c.extra_verbal_info}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Brak zagregowanej transkrypcji. Uruchom "OCR: dialogi + slajdy + agregacja".
            </p>
          )}
        </div>
      )}
    </div>
  );
}
