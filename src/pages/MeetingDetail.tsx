import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Users, Tag } from "lucide-react";
import { mockMeetings } from "@/lib/mock-data";
import TranscriptView from "@/components/TranscriptView";
import ActionItemsList from "@/components/ActionItemsList";

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meeting = mockMeetings.find((m) => m.id === id);

  if (!meeting) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Meeting not found.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl">
      {/* Back */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors press-effect"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>

      {/* Title */}
      <h1 className="text-2xl font-semibold text-foreground mb-4">{meeting.title}</h1>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground font-mono-data mb-8">
        <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{meeting.date}</span>
        <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{meeting.duration}</span>
        <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{meeting.participants.join(", ")}</span>
        <span className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" />{meeting.tags.join(", ")}</span>
      </div>

      {/* Three-pane layout */}
      <div className="grid grid-cols-12 gap-px bg-border rounded-lg overflow-hidden">
        {/* Left: Metadata + Summary */}
        <div className="col-span-3 bg-card p-5">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">
            Summary
          </h2>
          {meeting.summary ? (
            <p className="text-sm text-foreground/80 leading-relaxed">{meeting.summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No summary available.</p>
          )}

          {meeting.decisions && meeting.decisions.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">
                Decisions
              </h2>
              <div className="space-y-3">
                {meeting.decisions.map((d) => (
                  <div key={d.id} className="border border-border rounded-md p-3">
                    <p className="text-sm font-semibold text-foreground">{d.decision}</p>
                    <p className="text-xs text-muted-foreground mt-1">{d.rationale}</p>
                    <span className="text-[10px] font-mono-data text-muted-foreground/60 mt-2 block">
                      @ {d.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Center: Transcript */}
        <div className="col-span-5 bg-card p-5 border-l border-r border-border">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">
            Transcript
          </h2>
          {meeting.transcript ? (
            <TranscriptView lines={meeting.transcript} />
          ) : (
            <p className="text-sm text-muted-foreground italic">No transcript available.</p>
          )}
        </div>

        {/* Right: AI Intelligence */}
        <div className="col-span-4 bg-card p-5">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">
            Action Items
          </h2>
          {meeting.actionItems && meeting.actionItems.length > 0 ? (
            <ActionItemsList items={meeting.actionItems} />
          ) : (
            <p className="text-sm text-muted-foreground italic">No action items.</p>
          )}

          {/* Participants */}
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">
            Participants
          </h2>
          <div className="flex flex-wrap gap-2">
            {meeting.participants.map((p) => (
              <div
                key={p}
                className="flex items-center gap-2 border border-border rounded-md px-3 py-1.5"
              >
                <span className="w-6 h-6 rounded border border-border bg-muted flex items-center justify-center text-[10px] font-mono-data font-bold text-muted-foreground">
                  {p.slice(0, 2).toUpperCase()}
                </span>
                <span className="text-sm text-foreground">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
