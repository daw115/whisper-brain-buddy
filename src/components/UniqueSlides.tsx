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

export default function UniqueSlides({ meetingId, analyses }: Props) {
  const [thumbnails, setThumbnails] = useState<{ url: string; timestamp: string }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const uniqueFramesData = useMemo(() => {
    const entry = analyses.find(a => a.source === "unique-frames");
    return entry?.analysis_json as { frames?: { path: string; timestamp_formatted: string }[]; total_unique?: number } | null;
  }, [analyses]);

  useEffect(() => {
    if (!uniqueFramesData?.frames?.length) {
      setThumbnails([]);
      return;
    }

    setLoading(true);
    (async () => {
      const loaded: { url: string; timestamp: string }[] = [];
      for (const frame of uniqueFramesData.frames!) {
        const { data } = await supabase.storage
          .from("recordings")
          .createSignedUrl(frame.path, 60 * 60);
        if (data?.signedUrl) {
          loaded.push({ url: data.signedUrl, timestamp: frame.timestamp_formatted });
        }
      }
      setThumbnails(loaded);
      setLoading(false);
    })();
  }, [uniqueFramesData]);

  if (!uniqueFramesData?.total_unique) {
    return (
      <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
        <Images className="w-3 h-3" />
        Brak slajdów — uruchom OCR klatek
      </p>
    );
  }

  const visibleCount = expanded ? thumbnails.length : Math.min(thumbnails.length, 6);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <Images className="w-3 h-3 text-primary" />
        <span className="font-medium text-foreground">{uniqueFramesData.total_unique} unikalnych slajdów</span>
        {expanded ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>

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
