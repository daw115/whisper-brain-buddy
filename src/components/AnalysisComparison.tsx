import { useState } from "react";
import { GitCompare, Loader2, Check, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface AnalysisData {
  source: string;
  analysis_json: any;
}

interface ComparisonResult {
  comparison: {
    differences: { field: string; gemini_value: string; chatgpt_value: string; verdict: string }[];
    similarities: string[];
    better_source: string;
    better_source_reasoning: string;
  };
  merged_analysis: any;
}

interface Props {
  meetingId: string;
  analyses: AnalysisData[];
}

export default function AnalysisComparison({ meetingId, analyses }: Props) {
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("comparison");
  const qc = useQueryClient();

  const gemini = analyses.find((a) => a.source === "gemini");
  const chatgpt = analyses.find((a) => a.source === "chatgpt");
  const merged = analyses.find((a) => a.source === "merged");

  const canCompare = !!gemini && !!chatgpt && !merged;

  async function handleCompare() {
    if (!gemini || !chatgpt) return;
    setComparing(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("compare-analyses", {
        body: {
          meetingId,
          geminiAnalysis: gemini.analysis_json,
          chatgptAnalysis: chatgpt.analysis_json,
        },
      });

      if (fnError) throw new Error(fnError.message || "Błąd");
      if (data?.error) throw new Error(data.error);

      setResult(data);
      qc.invalidateQueries({ queryKey: ["meeting", meetingId] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meeting-analyses", meetingId] });
      qc.invalidateQueries({ queryKey: ["all-action-items"] });
      toast.success("Porównanie zakończone — zagregowana analiza zapisana");
    } catch (err: any) {
      setError(err.message || "Nieznany błąd");
      toast.error("Błąd: " + (err.message || ""));
    } finally {
      setComparing(false);
    }
  }

  function toggle(section: string) {
    setExpandedSection(expandedSection === section ? null : section);
  }

  // Show existing merged analysis if available
  const comparisonData = result?.comparison || merged?.analysis_json?.comparison;
  const showAnalyses = analyses.length > 0;

  if (!showAnalyses) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">
        Analizy spotkania
      </h2>

      {/* Status badges */}
      <div className="flex flex-wrap gap-1.5">
        {gemini && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
            Gemini ✓
          </span>
        )}
        {chatgpt && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
            ChatGPT ✓
          </span>
        )}
        {(merged || result) && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            Zagregowana ✓
          </span>
        )}
      </div>

      {/* Compare button */}
      {canCompare && (
        <button
          onClick={handleCompare}
          disabled={comparing}
          className="flex items-center gap-2 text-xs font-medium px-4 py-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 press-effect w-full justify-center"
        >
          {comparing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Porównuję analizy…
            </>
          ) : (
            <>
              <GitCompare className="w-4 h-4" />
              Porównaj i zagreguj analizy
            </>
          )}
        </button>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}

      {/* Comparison results */}
      {comparisonData && (
        <div className="space-y-2">
          {/* Winner */}
          <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
            <p className="text-xs font-medium text-primary mb-1">
              🏆 Lepsza analiza: {comparisonData.better_source === "equal" ? "Remis" : comparisonData.better_source.toUpperCase()}
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {comparisonData.better_source_reasoning}
            </p>
          </div>

          {/* Differences */}
          <CollapsibleSection
            title={`Różnice (${comparisonData.differences?.length || 0})`}
            isOpen={expandedSection === "differences"}
            onToggle={() => toggle("differences")}
          >
            {comparisonData.differences?.map((d: any, i: number) => (
              <div key={i} className="border border-border rounded p-2 space-y-1">
                <p className="text-[10px] font-medium text-foreground">{d.field}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <span className="text-[9px] text-blue-500 font-medium">Gemini:</span>
                    <p className="text-[10px] text-muted-foreground">{d.gemini_value}</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-green-500 font-medium">ChatGPT:</span>
                    <p className="text-[10px] text-muted-foreground">{d.chatgpt_value}</p>
                  </div>
                </div>
                <p className="text-[10px] text-primary italic">{d.verdict}</p>
              </div>
            ))}
          </CollapsibleSection>

          {/* Similarities */}
          <CollapsibleSection
            title={`Podobieństwa (${comparisonData.similarities?.length || 0})`}
            isOpen={expandedSection === "similarities"}
            onToggle={() => toggle("similarities")}
          >
            <ul className="space-y-1">
              {comparisonData.similarities?.map((s: string, i: number) => (
                <li key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                  <Check className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                  {s}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      )}

      {/* Individual analyses viewer */}
      {gemini && (
        <CollapsibleSection
          title="Analiza Gemini"
          isOpen={expandedSection === "gemini"}
          onToggle={() => toggle("gemini")}
          badgeColor="blue"
        >
          <AnalysisView data={gemini.analysis_json} />
        </CollapsibleSection>
      )}

      {chatgpt && (
        <CollapsibleSection
          title="Analiza ChatGPT"
          isOpen={expandedSection === "chatgpt"}
          onToggle={() => toggle("chatgpt")}
          badgeColor="green"
        >
          <AnalysisView data={chatgpt.analysis_json} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  badgeColor,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  badgeColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="text-[11px] font-medium text-foreground">{title}</span>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {isOpen && <div className="p-3 space-y-2">{children}</div>}
    </div>
  );
}

function AnalysisView({ data }: { data: any }) {
  if (!data) return <p className="text-[10px] text-muted-foreground italic">Brak danych</p>;

  return (
    <div className="space-y-3 text-[10px]">
      {data.summary && (
        <div>
          <span className="font-medium text-foreground">Podsumowanie:</span>
          <p className="text-muted-foreground mt-0.5 leading-relaxed">{data.summary}</p>
        </div>
      )}
      {data.sentiment && (
        <p><span className="font-medium text-foreground">Sentyment:</span> <span className="text-muted-foreground">{data.sentiment}</span></p>
      )}
      {data.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.tags.map((t: string, i: number) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[9px]">{t}</span>
          ))}
        </div>
      )}

      {/* Integrated transcript — backward compatible */}
      {(data.conversation_transcript || data.integrated_transcript) && (
        <div>
          <span className="font-medium text-foreground">📋 Transkrypcja rozmowy:</span>
          <div className="mt-1 bg-muted/30 border border-border rounded-md p-2 max-h-64 overflow-y-auto">
            <pre className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono-data">
              {data.conversation_transcript || data.integrated_transcript}
            </pre>
          </div>
        </div>
      )}

      {data.key_quotes?.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Kluczowe cytaty:</span>
          <ul className="mt-0.5 space-y-0.5">
            {data.key_quotes.map((q: string, i: number) => (
              <li key={i} className="text-muted-foreground italic">"{q}"</li>
            ))}
          </ul>
        </div>
      )}

      {data.action_items?.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Zadania ({data.action_items.length}):</span>
          <ul className="mt-0.5 space-y-0.5">
            {data.action_items.map((ai: any, i: number) => (
              <li key={i} className="text-muted-foreground">• <strong>{ai.owner}</strong>: {ai.task}{ai.deadline ? ` (do ${ai.deadline})` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {data.decisions?.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Decyzje ({data.decisions.length}):</span>
          <ul className="mt-0.5 space-y-1">
            {data.decisions.map((d: any, i: number) => (
              <li key={i} className="text-muted-foreground">
                • {d.decision}
                {d.rationale && <span className="block ml-3 text-muted-foreground/70 italic">↳ {d.rationale}</span>}
                {d.timestamp && <span className="text-[9px] text-muted-foreground/50 ml-1">@ {d.timestamp}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Enhanced slide insights */}
      {data.slide_insights?.length > 0 && (
        <div>
          <span className="font-medium text-foreground">📊 Analiza slajdów ({data.slide_insights.length}):</span>
          <div className="mt-1 space-y-2">
            {data.slide_insights.map((s: any, i: number) => (
              <div key={i} className="border border-border rounded-md p-2 space-y-1 bg-muted/10">
                <div className="flex items-center gap-1.5">
                  {s.slide_timestamp && (
                    <span className="text-[9px] font-mono-data text-primary bg-primary/10 px-1 py-0.5 rounded">@ {s.slide_timestamp}</span>
                  )}
                  {s.slide_title && <span className="font-medium text-foreground">{s.slide_title}</span>}
                </div>
                <p className="text-muted-foreground">{s.slide_content || s.slide_description}</p>
                {s.discussion_context && (
                  <p className="text-muted-foreground/80 italic border-l-2 border-primary/30 pl-2">
                    💬 {s.discussion_context}
                  </p>
                )}
                {s.extra_context && (
                  <p className="text-muted-foreground/70 border-l-2 border-accent/30 pl-2">
                    ➕ {s.extra_context}
                  </p>
                )}
                {s.discrepancies && (
                  <p className="text-destructive/80 border-l-2 border-destructive/30 pl-2">
                    ⚠️ {s.discrepancies}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
