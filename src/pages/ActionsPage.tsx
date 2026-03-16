import { useMeetings } from "@/hooks/use-meetings";
import ActionItemsList from "@/components/ActionItemsList";
import { Loader2 } from "lucide-react";

export default function ActionsPage() {
  const { data: meetings = [], isLoading } = useMeetings();

  const allItems = meetings.flatMap((m) => m.action_items || []);
  const open = allItems.filter((a) => !a.completed);
  const done = allItems.filter((a) => a.completed);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Action Items</h1>
      <p className="text-sm text-muted-foreground mb-8">
        {open.length} open · {done.length} completed
      </p>

      <div className="border border-border rounded-lg bg-card p-6 mb-6">
        <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">Open</h2>
        <ActionItemsList items={open} />
      </div>

      <div className="border border-border rounded-lg bg-card p-6">
        <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">Completed</h2>
        <ActionItemsList items={done} />
      </div>
    </div>
  );
}
