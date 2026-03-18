import { useState, useEffect } from "react";
import { Brain, Loader2, Check, AlertCircle, Image } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  meetingId: string;
  hasFrames: boolean;
  recordingFilename?: string;
  framesVersion?: number;
  onComplete?: (analysis: any) => void;
}

export default function GeminiAnalysisButton({ meetingId, hasFrames, recordingFilename, framesVersion = 0, onComplete }: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameCounts, setFrameCounts] = useState<{ total: number; unique: number } | null>(null);
  const [loadingFrames, setLoadingFrames] = useState(false);

  useEffect(() => {
    if (hasFrames && recordingFilename) {
      countUniqueFrames();
    }
  }, [hasFrames, recordingFilename, framesVersion]);

  async function countUniqueFrames() {
    if (!recordingFilename) return;
    setLoadingFrames(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const stem = recordingFilename.replace(/\.[^.]+$/, "");
      const dirPrefixes = [`${user.id}/frames/${stem}`];

      const { data: allDirs } = await supabase.storage.from("recordings").list(`${user.id}/frames`);
      if (allDirs) {
        for (const d of allDirs) {
          if (d.name.startsWith(stem + "_part") && d.id) {
            dirPrefixes.push(`${user.id}/frames/${d.name}`);
          }
        }
      }

      const allFiles: { path: string; timestamp: number }[] = [];
      for (const prefix of dirPrefixes) {
        const { data: files } = await supabase.storage.from("recordings").list(prefix, { limit: 50, sortBy: { column: "name", order: "asc" } });
        if (files) {
          for (const f of files) {
            if (!f.name.match(/\.(jpg|jpeg|png)$/i)) continue;
            const match = f.name.match(/frame_(\d+)s?\./);
            allFiles.push({ path: `${prefix}/${f.name}`, timestamp: match ? parseInt(match[1]) : 0 });
          }
        }
      }

      if (allFiles.length === 0) {
        setFrameCounts({ total: 0, unique: 0 });
        return;
      }

      allFiles.sort((a, b) => a.timestamp - b.timestamp);
      const selected = allFiles.slice(0, 30);

      // Download and deduplicate
      const seenHashes = new Set<string>();
      let uniqueCount = 0;

      const { data: signed } = await supabase.storage.from("recordings").createSignedUrls(selected.map(f => f.path), 600);
      if (!signed) { setFrameCounts({ total: allFiles.length, unique: allFiles.length }); return; }

      for (const s of signed) {
        if (!s.signedUrl) continue;
        try {
          const res = await fetch(s.signedUrl);
          const blob = await res.blob();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const hashSlice = bytes.slice(0, 2048);
          let hash = 0;
          for (let j = 0; j < hashSlice.length; j += 4) {
            hash = ((hash << 5) - hash + hashSlice[j]) | 0;
          }
          const hashStr = hash.toString(36);
          if (!seenHashes.has(hashStr)) {
            seenHashes.add(hashStr);
            uniqueCount++;
          }
        } catch { /* skip */ }
      }

      setFrameCounts({ total: allFiles.length, unique: uniqueCount });
    } catch (err) {
      console.error("Count frames error:", err);
    } finally {
      setLoadingFrames(false);
    }
  }

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

      {/* Frame count indicator */}
      {hasFrames && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground justify-center">
          <Image className="w-3 h-3" />
          {loadingFrames ? (
            <span>Sprawdzanie klatek…</span>
          ) : frameCounts ? (
            frameCounts.unique > 0 ? (
              <span>
                {frameCounts.unique} unikalnych klatek
                {frameCounts.total > frameCounts.unique && (
                  <span className="text-muted-foreground/60"> (z {frameCounts.total}, {frameCounts.total - frameCounts.unique} duplikatów)</span>
                )}
              </span>
            ) : (
              <span>Brak klatek</span>
            )
          ) : (
            <span>Slajdy + transkrypt → analiza multimodalna</span>
          )}
        </div>
      )}

      {!hasFrames && (
        <p className="text-[10px] text-muted-foreground text-center">Tylko transkrypt</p>
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
