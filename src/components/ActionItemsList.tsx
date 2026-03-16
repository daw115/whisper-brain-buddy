import { CheckSquare, Square } from "lucide-react";
import type { ActionItem } from "@/lib/mock-data";

interface ActionItemsListProps {
  items: ActionItem[];
}

export default function ActionItemsList({ items }: ActionItemsListProps) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="action-item flex items-start gap-3">
          {item.completed ? (
            <CheckSquare className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          ) : (
            <Square className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm ${
                item.completed ? "line-through text-muted-foreground" : "text-foreground"
              }`}
            >
              {item.task}
            </p>
            <div className="flex gap-3 mt-1">
              <span className="text-[11px] font-mono-data text-muted-foreground uppercase">
                {item.owner}
              </span>
              <span className="text-[11px] font-mono-data text-muted-foreground">
                Due {item.deadline}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
