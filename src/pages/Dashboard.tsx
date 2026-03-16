import { useState } from "react";
import { Search, Mic, FileText, CheckSquare, Lightbulb } from "lucide-react";
import MeetingCard from "@/components/MeetingCard";
import { mockMeetings } from "@/lib/mock-data";

interface DashboardProps {
  onStartRecording: () => void;
}

export default function Dashboard({ onStartRecording }: DashboardProps) {
  const [search, setSearch] = useState("");

  const filtered = mockMeetings.filter(
    (m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.tags.some((t) => t.includes(search.toLowerCase()))
  );

  const totalTasks = mockMeetings.reduce((sum, m) => sum + (m.actionItems?.length || 0), 0);
  const openTasks = mockMeetings.reduce(
    (sum, m) => sum + (m.actionItems?.filter((a) => !a.completed).length || 0),
    0
  );

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The memory of your organization, indexed.
          </p>
        </div>
        <button
          onClick={onStartRecording}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors press-effect"
        >
          <Mic className="w-4 h-4" />
          New Recording
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-px bg-border rounded-lg overflow-hidden mb-8">
        {[
          { label: "Meetings", value: mockMeetings.length, icon: FileText },
          { label: "Open Tasks", value: openTasks, icon: CheckSquare },
          { label: "Total Tasks", value: totalTasks, icon: CheckSquare },
          { label: "Decisions", value: mockMeetings.reduce((s, m) => s + (m.decisions?.length || 0), 0), icon: Lightbulb },
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

      {/* Search */}
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

      {/* Meeting List */}
      <div className="space-y-2">
        {filtered.map((meeting, i) => (
          <MeetingCard key={meeting.id} meeting={meeting} index={i} />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            No meetings found.
          </p>
        )}
      </div>
    </div>
  );
}
