import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Users, Tag, Loader2, Play, Download } from "lucide-react";
import { useMeeting } from "@/hooks/use-meetings";
import { supabase } from "@/integrations/supabase/client";
import TranscriptView from "@/components/TranscriptView";
import ActionItemsList from "@/components/ActionItemsList";

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: meeting, isLoading } = useMeeting(id);

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

      <h1 className="text-2xl font-semibold text-foreground mb-4">{meeting.title}</h1>

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
              <p className="text-xs font-mono-data text-muted-foreground">{meeting.recording_filename}</p>
              {meeting.recording_size_bytes && (
                <p className="text-xs font-mono-data text-muted-foreground/60">
                  {(meeting.recording_size_bytes / (1024 * 1024)).toFixed(1)} MB
                </p>
              )}
            </>
          )}
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
    </div>
  );
}
