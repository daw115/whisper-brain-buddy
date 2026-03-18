import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Users, Tag, Loader2, Play, Download, Brain } from "lucide-react";
import { useMeeting } from "@/hooks/use-meetings";
import { supabase } from "@/integrations/supabase/client";
import TranscriptView from "@/components/TranscriptView";
import ActionItemsList from "@/components/ActionItemsList";
import AIChatPanel from "@/components/AIChatPanel";
import AnalysisPromptGenerator from "@/components/AnalysisPromptGenerator";
import AnalysisJsonImporter from "@/components/AnalysisJsonImporter";
import AudioConverter from "@/components/AudioConverter";

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: meeting, isLoading } = useMeeting(id);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    if (!meeting?.recording_filename) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const path = `${user.id}/${meeting.recording_filename}`;
      const { data } = await supabase.storage
        .from("recordings")
        .createSignedUrl(path, 60 * 60); // 1 hour
      if (data?.signedUrl) setRecordingUrl(data.signedUrl);
    })();
  }, [meeting?.recording_filename]);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Meeting not found.</p>
      </div>
    );
  }

  const participants = meeting.meeting_participants || [];
  const tags = meeting.tags || [];

  return (
    <div className="p-8 max-w-7xl">
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors press-effect"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-foreground">{meeting.title}</h1>
        <button
          onClick={() => setShowChat(!showChat)}
          className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md border transition-colors press-effect ${
            showChat
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
          }`}
        >
          <Brain className="w-4 h-4" />
          Ask AI
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground font-mono-data mb-8">
        <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{meeting.date}</span>
        {meeting.duration && (
          <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{meeting.duration}</span>
        )}
        {participants.length > 0 && (
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{participants.map(p => p.name).join(", ")}</span>
        )}
        {tags.length > 0 && (
          <span className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" />{tags.join(", ")}</span>
        )}
      </div>

      <div className="grid grid-cols-12 gap-px bg-border rounded-lg overflow-hidden">
        {/* Left: Summary + Decisions */}
        <div className="col-span-3 bg-card p-5">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">Summary</h2>
          {meeting.summary ? (
            <p className="text-sm text-foreground/80 leading-relaxed">{meeting.summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No summary available.</p>
          )}

          {meeting.decisions && meeting.decisions.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">Decisions</h2>
              <div className="space-y-3">
                {meeting.decisions.map((d) => (
                  <div key={d.id} className="border border-border rounded-md p-3">
                    <p className="text-sm font-semibold text-foreground">{d.decision}</p>
                    {d.rationale && <p className="text-xs text-muted-foreground mt-1">{d.rationale}</p>}
                    {d.timestamp && (
                      <span className="text-[10px] font-mono-data text-muted-foreground/60 mt-2 block">@ {d.timestamp}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {meeting.recording_filename && (
            <>
              <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">Recording</h2>
              {showPlayer && recordingUrl ? (
                <video
                  src={recordingUrl}
                  controls
                  autoPlay
                  className="w-full rounded-md border border-border bg-black"
                />
              ) : (
                <div className="flex items-center gap-2">
                  {recordingUrl && (
                    <>
                      <button
                        onClick={() => setShowPlayer(true)}
                        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" /> Play
                      </button>
                      <a
                        href={recordingUrl}
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            const res = await fetch(recordingUrl);
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = meeting.recording_filename || "recording.webm";
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } catch {
                            window.open(recordingUrl, "_blank");
                          }
                        }}
                        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" /> Download
                      </a>
                      <AudioConverter recordingUrl={recordingUrl} filename={meeting.recording_filename!} />
                    </>
                  )}
                </div>
              )}
              <p className="text-xs font-mono-data text-muted-foreground mt-2">{meeting.recording_filename}</p>
              {meeting.recording_size_bytes && (
                <p className="text-xs font-mono-data text-muted-foreground/60">
                  {(meeting.recording_size_bytes / (1024 * 1024)).toFixed(1)} MB
                </p>
              )}
            </>
          )}


          {/* Analysis Prompt Generator */}
          <div className="mt-6 pt-4 border-t border-border">
            <AnalysisPromptGenerator meeting={meeting} recordingUrl={recordingUrl} />
          </div>

          {/* Analysis JSON Importer */}
          <div className="mt-6 pt-4 border-t border-border">
            <AnalysisJsonImporter meetingId={meeting.id} />
          </div>
        </div>

        {/* Center: Transcript */}
        <div className="col-span-5 bg-card p-5 border-l border-r border-border">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">Transcript</h2>
          {meeting.transcript_lines && meeting.transcript_lines.length > 0 ? (
            <TranscriptView lines={meeting.transcript_lines} />
          ) : (
            <p className="text-sm text-muted-foreground italic">No transcript available.</p>
          )}
        </div>

        {/* Right: Action Items + Participants */}
        <div className="col-span-4 bg-card p-5">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">Action Items</h2>
          {meeting.action_items && meeting.action_items.length > 0 ? (
            <ActionItemsList items={meeting.action_items} />
          ) : (
            <p className="text-sm text-muted-foreground italic">No action items.</p>
          )}

          {participants.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">Participants</h2>
              <div className="flex flex-wrap gap-2">
                {participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 border border-border rounded-md px-3 py-1.5">
                    <span className="w-6 h-6 rounded border border-border bg-muted flex items-center justify-center text-[10px] font-mono-data font-bold text-muted-foreground">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-sm text-foreground">{p.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {showChat && (
        <div className="mt-6 border border-border rounded-lg overflow-hidden bg-card" style={{ height: 420 }}>
          <AIChatPanel meetingId={id} meetingTitle={meeting.title} />
        </div>
      )}
    </div>
  );
}
