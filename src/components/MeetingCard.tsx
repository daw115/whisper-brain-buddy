import { useNavigate } from "react-router-dom";
import { Clock, Users, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { Meeting } from "@/lib/mock-data";

interface MeetingCardProps {
  meeting: Meeting;
  index: number;
}

const statusColors: Record<string, string> = {
  processed: "bg-primary/15 text-primary border-primary/30",
  processing: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  recorded: "bg-muted text-muted-foreground border-border",
};

export default function MeetingCard({ meeting, index }: MeetingCardProps) {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => meeting.status === "processed" && navigate(`/meeting/${meeting.id}`)}
      className={`meeting-card rounded-lg cursor-pointer ${
        meeting.status !== "processed" ? "opacity-70 cursor-default" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground leading-tight">
          {meeting.title}
        </h3>
        <span
          className={`text-[10px] uppercase font-mono-data px-2 py-0.5 rounded border ${statusColors[meeting.status]}`}
        >
          {meeting.status === "processing" && (
            <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
          )}
          {meeting.status}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono-data">
        <span>{meeting.date}</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {meeting.duration}
        </span>
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {meeting.participants.length}
        </span>
      </div>

      {meeting.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {meeting.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-mono-data text-muted-foreground bg-muted px-2 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
