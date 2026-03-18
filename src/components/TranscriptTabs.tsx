import { useState, useMemo, useEffect } from "react";
import { Mic, ScanText, Merge, User, Presentation } from "lucide-react";
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

type Tab = "audio" | "slides-ocr" | "aggregated";

export default function TranscriptTabs({ meeting, analyses, onDeleteTranscript }: Props) {
  const [tab, setTab] = useState<Tab>("audio");
  const [frameThumbnails, setFrameThumbnails] = useState<Map<string, string>>(new Map());

  // Captions OCR data (dialogues + slide descriptions extracted by Gemini)
  const captionsData = useMemo(() => {
    const entry = analyses.find(a => a.source === "captions-ocr");
    return entry?.analysis_json as {
      transcript?: string;
      entries?: { timestamp: string; speaker: string; text: string }[];
      total_entries?: number;
      slide_descriptions?: { timestamp: string; slide_title: string; slide_content: string; is_new_slide: boolean }[];
      speakers_identified?: string[];
    } | null;
  }, [analyses]);

  // Unique frames data (support both crop-split and legacy unique-frames)
  const uniqueFramesData = useMemo(() => {
    const cropSplit = analyses.find(a => a.source === "crop-split");
    if (cropSplit?.analysis_json?.unique_slides?.length) {
      return {
        frames: cropSplit.analysis_json.unique_slides.map((s: any) => ({
          path: s.path, timestamp: s.timestamp, timestamp_formatted: s.ts_formatted,
        })),
        total_unique: cropSplit.analysis_json.total_unique_slides,
      };
    }
    const entry = analyses.find(a => a.source === "unique-frames");
    return entry?.analysis_json as { frames?: { path: string; timestamp: number; timestamp_formatted: string }[]; total_unique?: number } | null;
  }, [analyses]);

  // Aggregated data
  const aggregated = useMemo(() => {
    const entry = analyses.find(a => a.source === "merged");
    return entry?.analysis_json as {
      integrated_transcript?: string;
      conversation_transcript?: string;
      slides_section?: string;
      summary?: string;
      speakers?: string[];
      slide_markers?: { timestamp: string; slide_title: string; slide_summary: string }[];
    } | null;
  }, [analyses]);

  // Load signed URLs for frame thumbnails (keyed by timestamp)
  useEffect(() => {
    if (!uniqueFramesData?.frames?.length) return;

    (async () => {
      const map = new Map<string, string>();
      for (const frame of uniqueFramesData.frames!) {
        const { data } = await supabase.storage
          .from("recordings")
          .createSignedUrl(frame.path, 60 * 60);
        if (data?.signedUrl) {
          map.set(frame.timestamp_formatted, data.signedUrl);
        }
      }
      setFrameThumbnails(map);
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
      key: "slides-ocr",
      label: "Slajdy OCR",
      icon: <ScanText className="w-3 h-3" />,
      count: captionsData?.total_entries ? `${captionsData.total_entries}` : undefined,
    },
    {
      key: "aggregated",
      label: "Agregacja",
      icon: <Merge className="w-3 h-3" />,
      count: aggregated ? "✓" : undefined,
    },
  ];

  // Find closest frame thumbnail for a given timestamp string like "1:30"
  function findFrameUrl(timestamp: string): string | undefined {
    // Direct match
    if (frameThumbnails.has(timestamp)) return frameThumbnails.get(timestamp);
    // Try parsing and finding closest
    const parseSec = (ts: string) => {
      const parts = ts.split(":").map(Number);
      return parts.length === 2 ? parts[0] * 60 + parts[1] : 0;
    };
    const targetSec = parseSec(timestamp);
    let closest: string | undefined;
    let minDiff = Infinity;
    for (const [key, url] of frameThumbnails) {
      const diff = Math.abs(parseSec(key) - targetSec);
      if (diff < minDiff && diff <= 30) {
        minDiff = diff;
        closest = url;
      }
    }
    return closest;
  }

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

      {/* Slides OCR tab — captions dialogues + slide descriptions from Gemini */}
      {tab === "slides-ocr" && (
        <div>
          <span className="text-[10px] text-muted-foreground block mb-3">
            Gemini OCR: dialogi z live captions + treść slajdów prezentacji
          </span>

          {captionsData ? (
            <div className="space-y-4">
              {/* Identified speakers */}
              {captionsData.speakers_identified && captionsData.speakers_identified.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-[9px] text-muted-foreground mr-1">Mówcy:</span>
                  {captionsData.speakers_identified.map((s, i) => (
                    <span key={i} className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
                      <User className="w-2.5 h-2.5" />{s}
                    </span>
                  ))}
                </div>
              )}

              {/* Dialogues */}
              {captionsData.entries && captionsData.entries.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider mb-2">
                    Dialogi ({captionsData.entries.length})
                  </h4>
                  <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                    {captionsData.entries.map((e, i) => (
                      <div key={i} className="text-[11px] leading-relaxed">
                        <span className="text-muted-foreground font-mono-data">[{e.timestamp}]</span>{" "}
                        <span className="font-medium text-primary">{e.speaker}:</span>{" "}
                        <span className="text-foreground/80">{e.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Slide descriptions */}
              {captionsData.slide_descriptions && captionsData.slide_descriptions.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider mb-2">
                    Slajdy prezentacji ({captionsData.slide_descriptions.filter(s => s.is_new_slide !== false).length})
                  </h4>
                  <div className="space-y-2">
                    {captionsData.slide_descriptions
                      .filter(s => s.is_new_slide !== false)
                      .map((s, i) => {
                        const frameUrl = findFrameUrl(s.timestamp);
                        return (
                          <div key={i} className="flex gap-2 border border-border rounded-md p-2 bg-muted/20">
                            {frameUrl && (
                              <img
                                src={frameUrl}
                                alt={s.slide_title}
                                className="w-24 aspect-video object-cover rounded border border-border flex-shrink-0"
                                loading="lazy"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <Presentation className="w-3 h-3 text-primary" />
                                <span className="text-[10px] font-mono-data text-muted-foreground">{s.timestamp}</span>
                                <span className="text-[11px] font-medium text-foreground truncate">{s.slide_title}</span>
                              </div>
                              <p className="text-[10px] text-foreground/70 leading-relaxed">{s.slide_content}</p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Brak danych OCR. Uruchom "OCR: klatki + dialogi + agregacja".
            </p>
          )}
        </div>
      )}

      {/* Aggregated tab — clean dialogue + speakers + slides with images */}
      {tab === "aggregated" && (
        <div>
          <span className="text-[10px] text-muted-foreground block mb-3">
            Wyczyszczony dialog + mówcy + opisy slajdów z obrazkami
          </span>

          {aggregated ? (
            <div className="space-y-4">
              {/* Summary */}
              {aggregated.summary && (
                <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
                  <p className="text-xs text-foreground leading-relaxed">{aggregated.summary}</p>
                </div>
              )}

              {/* Speakers */}
              {aggregated.speakers && aggregated.speakers.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider mb-1.5">
                    Zidentyfikowani rozmówcy
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {aggregated.speakers.map((s, i) => (
                      <span key={i} className="text-[10px] bg-primary/10 text-primary px-2.5 py-1 rounded-full flex items-center gap-1">
                        <User className="w-3 h-3" />{s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Slide markers with images */}
              {aggregated.slide_markers && aggregated.slide_markers.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider mb-2">
                    Slajdy w chronologii ({aggregated.slide_markers.length})
                  </h4>
                  <div className="space-y-2">
                    {aggregated.slide_markers.map((sm, i) => {
                      const frameUrl = findFrameUrl(sm.timestamp);
                      return (
                        <div key={i} className="flex gap-2 border border-border rounded-md p-2 bg-muted/20">
                          {frameUrl && (
                            <img
                              src={frameUrl}
                              alt={sm.slide_title}
                              className="w-28 aspect-video object-cover rounded border border-border flex-shrink-0"
                              loading="lazy"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <Presentation className="w-3 h-3 text-primary" />
                              <span className="text-[10px] font-mono-data text-muted-foreground">{sm.timestamp}</span>
                              <span className="text-[11px] font-medium text-foreground">{sm.slide_title}</span>
                            </div>
                            <p className="text-[10px] text-foreground/70 leading-relaxed">{sm.slide_summary}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Conversation transcript */}
              {(aggregated.conversation_transcript || aggregated.integrated_transcript) && (
                <div>
                  <h4 className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider mb-2">
                    Transkrypcja rozmowy
                  </h4>
                  <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap font-mono-data leading-relaxed max-h-[50vh] overflow-y-auto bg-muted/20 border border-border rounded-md p-3">
                    {aggregated.conversation_transcript || aggregated.integrated_transcript}
                  </pre>
                </div>
              )}

              {/* Slides section */}
              {aggregated.slides_section && (
                <div>
                  <h4 className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider mb-2">
                    📊 Slajdy i podsumowania
                  </h4>
                  <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap font-mono-data leading-relaxed max-h-[40vh] overflow-y-auto bg-muted/20 border border-border rounded-md p-3">
                    {aggregated.slides_section}
                  </pre>
                </div>
              )}
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
