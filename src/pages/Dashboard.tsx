import { useState } from "react";
import { Search, Mic, FileText, CheckSquare, Lightbulb, Loader2, Plus } from "lucide-react";
import MeetingCard from "@/components/MeetingCard";
import CreateMeetingDialog from "@/components/CreateMeetingDialog";
import { useMeetings } from "@/hooks/use-meetings";

interface DashboardProps {
  onStartRecording: () => void;
}

export default function Dashboard({ onStartRecording }: DashboardProps) {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const { data: meetings = [], isLoading } = useMeetings();

  const filtered = meetings.filter(
    (m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      (m.tags || []).some((t) => t.includes(search.toLowerCase()))
  );

  const totalTasks = meetings.reduce((sum, m) => sum + (m.action_items?.length || 0), 0);
  const openTasks = meetings.reduce(
    (sum, m) => sum + (m.action_items?.filter((a) => !a.completed).length || 0),
    0
  );
  const totalDecisions = meetings.reduce((sum, m) => sum + (m.decisions?.length || 0), 0);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The memory of your organization, indexed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 border border-border text-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-secondary transition-colors press-effect"
          >
            <Plus className="w-4 h-4" />
            Add Meeting
          </button>
          <button
            onClick={onStartRecording}
            className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors press-effect"
          >
            <Mic className="w-4 h-4" />
            New Recording
          </button>
        </div>
      </div>

      <CreateMeetingDialog open={showCreate} onClose={() => setShowCreate(false)} />

      <div className="grid grid-cols-4 gap-px bg-border rounded-lg overflow-hidden mb-8">
        {[
          { label: "Meetings", value: meetings.length, icon: FileText },
          { label: "Open Tasks", value: openTasks, icon: CheckSquare },
          { label: "Total Tasks", value: totalTasks, icon: CheckSquare },
          { label: "Decisions", value: totalDecisions, icon: Lightbulb },
        ].map((stat) => (
          <div key={stat.label} className="bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">
                {stat.label}
              </span>
            </div>
            <span className="text-2xl font-semibold text-foreground font-mono-data">
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search meetings, tags, participants..."
          className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/50 font-mono-data">
          ⌘K
        </span>
      </div>

      <div className="space-y-2">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          </div>
        )}
        {!isLoading && filtered.map((meeting, i) => (
          <MeetingCard key={meeting.id} meeting={meeting} index={i} />
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">
              {meetings.length === 0
                ? "No meetings yet. Click 'New Recording' to capture your first meeting."
                : "No meetings match your search."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
