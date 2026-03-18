import { useState, useEffect, useMemo } from "react";
import { Images, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AnalysisEntry {
  source: string;
  analysis_json: any;
}

interface Props {
  meetingId: string;
  analyses: AnalysisEntry[];
  onDeleted?: () => void;
}

export default function UniqueSlides({ meetingId, analyses, onDeleted }: Props) {
  const [thumbnails, setThumbnails] = useState<{ url: string; timestamp: string }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  // Support pdf-slides, crop-split, and legacy unique-frames
  const slideData = useMemo(() => {
    const pdfSlides = analyses.find(a => a.source === "pdf-slides");
    if (pdfSlides?.analysis_json?.unique_slides?.length) {
      return {
        frames: pdfSlides.analysis_json.unique_slides as { path: string; ts_formatted: string }[],
        total_unique: pdfSlides.analysis_json.total_unique_slides as number,
        total_frames: pdfSlides.analysis_json.total_pages as number,
        source: "pdf-slides" as const,
      };
    }
    const cropSplit = analyses.find(a => a.source === "crop-split");
    if (cropSplit?.analysis_json?.unique_slides?.length) {
      return {
        frames: cropSplit.analysis_json.unique_slides as { path: string; ts_formatted: string }[],
        total_unique: cropSplit.analysis_json.total_unique_slides as number,
        total_frames: cropSplit.analysis_json.total_frames as number,
        source: "crop-split" as const,
      };
    }
    const legacy = analyses.find(a => a.source === "unique-frames");
    if (legacy?.analysis_json?.frames?.length) {
      return {
        frames: legacy.analysis_json.frames.map((f: any) => ({ path: f.path, ts_formatted: f.timestamp_formatted })),
        total_unique: legacy.analysis_json.total_unique as number,
        total_frames: legacy.analysis_json.total_before_classification as number | undefined,
        source: "unique-frames" as const,
      };
    }
    return null;
  }, [analyses]);

  useEffect(() => {
    if (!slideData?.frames?.length) {
      setThumbnails([]);
      return;
    }

    setLoading(true);
    (async () => {
      const loaded: { url: string; timestamp: string }[] = [];
      for (const frame of slideData.frames) {
        const { data } = await supabase.storage
          .from("recordings")
          .createSignedUrl(frame.path, 60 * 60);
        if (data?.signedUrl) {
          loaded.push({ url: data.signedUrl, timestamp: frame.ts_formatted });
        }
      }
      setThumbnails(loaded);
      setLoading(false);
    })();
  }, [slideData]);

  if (!slideData?.total_unique) {
    return (
      <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
        <Images className="w-3 h-3" />
        Brak slajdów — uruchom pipeline OCR
      </p>
    );
  }

  const visibleCount = expanded ? thumbnails.length : Math.min(thumbnails.length, 6);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Images className="w-3 h-3 text-primary" />
          <span className="font-medium text-foreground">
            {slideData.total_unique} unikalnych slajdów
            {slideData.total_frames && (
              <span className="text-muted-foreground font-normal"> (z {slideData.total_frames} klatek)</span>
            )}
          </span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <button
          onClick={async () => {
            if (!confirm("Usunąć dane slajdów?")) return;
            const sources = ["unique-frames", "crop-split", "captions-ocr", "slide-descriptions", "merged"];
            const { error } = await (supabase as any)
              .from("meeting_analyses")
              .delete()
              .eq("meeting_id", meetingId)
              .in("source", sources);
            if (error) {
              toast.error("Błąd: " + error.message);
            } else {
              toast.success("Dane slajdów wyczyszczone");
              setThumbnails([]);
              onDeleted?.();
            }
          }}
          className="flex items-center gap-1 text-[10px] text-destructive/70 hover:text-destructive transition-colors"
          title="Usuń dane slajdów"
        >
          <Trash2 className="w-3 h-3" />
          Wyczyść
        </button>
      </div>

      {loading ? (
        <p className="text-[9px] text-muted-foreground">Ładowanie miniatur…</p>
      ) : thumbnails.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {thumbnails.slice(0, visibleCount).map((t, i) => (
            <div key={i} className="relative group">
              <img
                src={t.url}
                alt={`Slajd @ ${t.timestamp}`}
                className="w-full aspect-video object-cover rounded border border-border"
                loading="lazy"
              />
              <span className="absolute bottom-0.5 right-0.5 text-[7px] font-mono-data bg-background/80 px-0.5 rounded">
                {t.timestamp}
              </span>
            </div>
          ))}
        </div>
      )}

      {!expanded && thumbnails.length > 6 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
        >
          +{thumbnails.length - 6} więcej
        </button>
      )}
    </div>
  );
}
