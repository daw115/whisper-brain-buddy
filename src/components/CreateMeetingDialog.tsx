import { useState } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { useCreateMeeting, useCategories } from "@/hooks/use-meetings";
import { toast } from "sonner";

interface CreateMeetingDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function CreateMeetingDialog({ open, onClose }: CreateMeetingDialogProps) {
  const [title, setTitle] = useState("");
  const [participantInput, setParticipantInput] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const createMeeting = useCreateMeeting();
  const { data: categories = [] } = useCategories();

  if (!open) return null;

  const addParticipant = () => {
    const name = participantInput.trim();
    if (name && !participants.includes(name)) {
      setParticipants([...participants, name]);
      setParticipantInput("");
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    try {
      await createMeeting.mutateAsync({
        title: title.trim(),
        participants,
        tags,
        summary: summary.trim() || undefined,
        category_id: categoryId || undefined,
      });
      toast.success("Meeting created");
      resetAndClose();
    } catch {
      toast.error("Failed to create meeting");
    }
  };

  const resetAndClose = () => {
    setTitle("");
    setParticipantInput("");
    setParticipants([]);
    setTagInput("");
    setTags([]);
    setSummary("");
    setCategoryId("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={resetAndClose} />
      <div className="relative bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">New Meeting</h2>
          <button onClick={resetAndClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider block mb-1.5">
              Title *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekly standup, Q4 planning..."
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
              maxLength={200}
            />
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <div>
              <label className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider block mb-1.5">
                Kategoria
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              >
                <option value="">— Bez kategorii —</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Participants */}
          <div>
            <label className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider block mb-1.5">
              Participants
            </label>
            <div className="flex gap-2">
              <input
                value={participantInput}
                onChange={(e) => setParticipantInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addParticipant())}
                placeholder="Add name..."
                className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                maxLength={100}
              />
              <button
                onClick={addParticipant}
                disabled={!participantInput.trim()}
                className="bg-secondary border border-border rounded-md px-3 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {participants.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {participants.map((p) => (
                  <span
                    key={p}
                    className="flex items-center gap-1 text-xs bg-muted border border-border rounded-md px-2 py-1 text-foreground"
                  >
                    {p}
                    <button onClick={() => setParticipants(participants.filter((x) => x !== p))} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <label className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider block mb-1.5">
              Tags
            </label>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder="Add tag..."
                className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                maxLength={50}
              />
              <button
                onClick={addTag}
                disabled={!tagInput.trim()}
                className="bg-secondary border border-border rounded-md px-3 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 text-[10px] font-mono-data bg-muted border border-border rounded-md px-2 py-1 text-muted-foreground"
                  >
                    {t}
                    <button onClick={() => setTags(tags.filter((x) => x !== t))} className="hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div>
            <label className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider block mb-1.5">
              Summary (optional)
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief notes about this meeting..."
              rows={3}
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors resize-none"
              maxLength={2000}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={resetAndClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || createMeeting.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors press-effect"
          >
            {createMeeting.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create Meeting
          </button>
        </div>
      </div>
    </div>
  );
}
