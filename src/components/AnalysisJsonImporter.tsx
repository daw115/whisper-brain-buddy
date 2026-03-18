import { useState } from "react";
import { ClipboardPaste, Loader2, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  meetingId: string;
  onSuccess?: (analysis: any) => void;
}

interface AnalysisJson {
  summary?: string;
  sentiment?: string;
  participants?: string[];
  tags?: string[];
  action_items?: { task: string; owner: string; deadline?: string | null }[];
  decisions?: { decision: string; rationale?: string | null; timestamp?: string | null }[];
  key_quotes?: string[];
  slide_insights?: { slide_description: string; context: string; key_data: string }[];
}

export default function AnalysisJsonImporter({ meetingId, onSuccess }: Props) {
  const [json, setJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const qc = useQueryClient();

  async function handleImport() {
    setError(null);
    let parsed: AnalysisJson;

    try {
      parsed = JSON.parse(json.trim());
    } catch {
      setError("Nieprawidłowy JSON — sprawdź format");
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      setError("JSON musi być obiektem {}");
      return;
    }

    setImporting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      // Save to meeting_analyses as chatgpt source
      await supabase.from("meeting_analyses").insert({
        meeting_id: meetingId,
        source: "chatgpt",
        analysis_json: parsed,
      } as any);

      // Invalidate caches
      qc.invalidateQueries({ queryKey: ["meeting", meetingId] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meeting-analyses", meetingId] });

      setDone(true);
      setJson("");
      toast.success("Analiza ChatGPT zapisana");
      onSuccess?.(parsed);
    } catch (err: any) {
      setError(err.message || "Błąd importu");
    } finally {
      setImporting(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-primary py-2">
        <Check className="w-4 h-4" />
        Analiza ChatGPT zapisana
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">
        Importuj wynik z ChatGPT
      </h2>

      <textarea
        value={json}
        onChange={(e) => { setJson(e.target.value); setError(null); }}
        placeholder='Wklej JSON z ChatGPT tutaj...\n{\n  "summary": "...",\n  "action_items": [...]\n}'
        className="w-full h-32 bg-muted/30 border border-border rounded-md p-3 text-[11px] font-mono-data text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
      />

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}

      <button
        onClick={handleImport}
        disabled={importing || !json.trim()}
        className="flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 press-effect"
      >
        {importing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <ClipboardPaste className="w-3.5 h-3.5" />
        )}
        {importing ? "Zapisuję…" : "Zapisz analizę ChatGPT"}
      </button>
    </div>
  );
}
