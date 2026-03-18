import { useState, useMemo, useEffect } from "react";
import { Mic, Images, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  const [frameThumbnails, setFrameThumbnails] = useState<{ url: string; timestamp: string }[]>([]);

  // Get unique frames data from analyses
  const uniqueFramesData = useMemo(() => {
    const entry = analyses.find(a => a.source === "unique-frames");
    return entry?.analysis_json as { frames?: { path: string; timestamp: number; timestamp_formatted: string }[]; total_unique?: number } | null;
  }, [analyses]);

  const aggregated = useMemo(() => {
    const entry = analyses.find(a => a.source === "merged");
    return entry?.analysis_json as { integrated_transcript?: string; summary?: string; speakers?: string[] } | null;
  }, [analyses]);

  // Load signed URLs for unique frame thumbnails
  useEffect(() => {
    if (!uniqueFramesData?.frames?.length) {
      setFrameThumbnails([]);
      return;
    }

    (async () => {
      const thumbnails: { url: string; timestamp: string }[] = [];
      for (const frame of uniqueFramesData.frames!) {
        const { data } = await supabase.storage
          .from("recordings")
          .createSignedUrl(frame.path, 60 * 60);
        if (data?.signedUrl) {
          thumbnails.push({ url: data.signedUrl, timestamp: frame.timestamp_formatted });
        }
      }
      setFrameThumbnails(thumbnails);
    })();
  }, [uniqueFramesData]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: string }[] = [
    {
      key: "audio",
      label: "Audio",
      icon: <Mic className="w-3 h-3" />,
      count: meeting.transcript_lines?.length ? `${meeting.transcript_lines.length}` : undefined,
    },
    {
      key: "slides",
      label: "Slajdy",
      icon: <Images className="w-3 h-3" />,
      count: uniqueFramesData?.total_unique ? `${uniqueFramesData.total_unique}` : undefined,
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

      {/* Slides tab — unique frame thumbnails */}
      {tab === "slides" && (
        <div>
          <span className="text-[10px] text-muted-foreground block mb-3">
            Unikalne klatki prezentacji (screeny do paczki ChatGPT)
          </span>
          {frameThumbnails.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {frameThumbnails.map((frame, i) => (
                <div key={i} className="relative group">
                  <img
                    src={frame.url}
                    alt={`Slajd @ ${frame.timestamp}`}
                    className="w-full aspect-video object-cover rounded border border-border"
                    loading="lazy"
                  />
                  <span className="absolute bottom-1 right-1 text-[8px] font-mono-data bg-background/80 px-1 py-0.5 rounded">
                    {frame.timestamp}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Brak unikalnych klatek. Uruchom "OCR: klatki + dialogi + agregacja".
            </p>
          )}
        </div>
      )}

      {/* Aggregated tab */}
      {tab === "aggregated" && (
        <div>
          <span className="text-[10px] text-muted-foreground block mb-3">
            Zagregowana transkrypcja: dialogi (OCR) + audio w jednym chronologicznym zapisie
          </span>
          {aggregated?.integrated_transcript ? (
            <div>
              {aggregated.summary && (
                <div className="bg-primary/5 border border-primary/20 rounded-md p-3 mb-3">
                  <p className="text-xs text-foreground leading-relaxed">{aggregated.summary}</p>
                </div>
              )}
              {aggregated.speakers && aggregated.speakers.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {aggregated.speakers.map((s, i) => (
                    <span key={i} className="text-[9px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap font-mono-data leading-relaxed max-h-[60vh] overflow-y-auto">
                {aggregated.integrated_transcript}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Brak zagregowanej transkrypcji. Uruchom "OCR: klatki + dialogi + agregacja".
            </p>
          )}
        </div>
      )}
    </div>
  );
}
