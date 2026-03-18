import { useState } from "react";
import { Presentation, ChevronDown, ChevronUp, MessageSquare, Plus, AlertTriangle, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface SlideInsight {
  slide_timestamp?: string;
  slide_title?: string;
  slide_content: string;
  slide_description?: string;
  discussion_context?: string;
  extra_context?: string;
  discrepancies?: string;
}

interface AnalysisEntry {
  source: string;
  analysis_json: any;
}

interface Props {
  analyses: AnalysisEntry[];
}

export default function SlideInsightsPanel({ analyses }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Find the best analysis with slide_insights (prefer merged > gemini > chatgpt)
  const analysisWithSlides = analyses.find(a => a.source === "merged" && a.analysis_json?.slide_insights?.length)
    || analyses.find(a => a.source === "gemini" && a.analysis_json?.slide_insights?.length)
    || analyses.find(a => a.analysis_json?.slide_insights?.length);

  const insights: SlideInsight[] = analysisWithSlides?.analysis_json?.slide_insights || [];
  const integratedTranscript: string | null = analysisWithSlides?.analysis_json?.integrated_transcript || null;

  if (insights.length === 0 && !integratedTranscript) return null;

  function handleCopyAll() {
    const text = insights.map((s, i) => {
      let block = `--- Slajd ${i + 1}${s.slide_timestamp ? ` @ ${s.slide_timestamp}` : ""} ---\n`;
      if (s.slide_title) block += `Tytuł: ${s.slide_title}\n`;
      block += `Treść: ${s.slide_content || s.slide_description || ""}\n`;
      if (s.discussion_context) block += `Dialog: ${s.discussion_context}\n`;
      if (s.extra_context) block += `Dodatkowy kontekst: ${s.extra_context}\n`;
      if (s.discrepancies) block += `Rozbieżności: ${s.discrepancies}\n`;
      return block;
    }).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Skopiowano analizę slajdów");
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full group"
      >
        <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider flex items-center gap-1.5">
          <Presentation className="w-3.5 h-3.5" />
          Slajdy + Kontekst ({insights.length})
        </h2>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <>
          {/* Integrated transcript */}
          {integratedTranscript && (
            <div className="bg-muted/20 border border-border rounded-md overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-muted/30">
                <span className="text-[10px] font-medium text-foreground">📋 Zintegrowany zapis (dialog + slajdy)</span>
              </div>
              <pre className="p-3 text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono-data max-h-64 overflow-y-auto">
                {integratedTranscript}
              </pre>
            </div>
          )}

          {/* Copy all button */}
          {insights.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="w-3 h-3" />
                Kopiuj wszystko
              </button>
            </div>
          )}

          {/* Individual slide insights */}
          <div className="space-y-2">
            {insights.map((slide, i) => (
              <div
                key={i}
                className="border border-border rounded-md overflow-hidden bg-card"
              >
                {/* Slide header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                  {slide.slide_timestamp && (
                    <span className="text-[9px] font-mono-data text-primary bg-primary/10 px-1.5 py-0.5 rounded font-medium">
                      @ {slide.slide_timestamp}
                    </span>
                  )}
                  <span className="text-[11px] font-medium text-foreground truncate">
                    {slide.slide_title || `Slajd ${i + 1}`}
                  </span>
                </div>

                <div className="p-3 space-y-2">
                  {/* Slide content */}
                  <p className="text-[10px] text-foreground/80 leading-relaxed">
                    {slide.slide_content || slide.slide_description}
                  </p>

                  {/* Discussion context */}
                  {slide.discussion_context && (
                    <div className="flex gap-2 border-l-2 border-primary/40 pl-2">
                      <MessageSquare className="w-3 h-3 text-primary/60 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                        {slide.discussion_context}
                      </p>
                    </div>
                  )}

                  {/* Extra context from dialogue */}
                  {slide.extra_context && (
                    <div className="flex gap-2 border-l-2 border-accent/40 pl-2">
                      <Plus className="w-3 h-3 text-accent flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
                        {slide.extra_context}
                      </p>
                    </div>
                  )}

                  {/* Discrepancies */}
                  {slide.discrepancies && (
                    <div className="flex gap-2 border-l-2 border-destructive/40 pl-2">
                      <AlertTriangle className="w-3 h-3 text-destructive/60 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-destructive/80 leading-relaxed">
                        {slide.discrepancies}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
