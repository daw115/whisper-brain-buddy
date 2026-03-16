import { CheckSquare, Square } from "lucide-react";
import { useToggleActionItem, type DbActionItem } from "@/hooks/use-meetings";

interface ActionItemsListProps {
  items: DbActionItem[];
}

export default function ActionItemsList({ items }: ActionItemsListProps) {
  const toggleMutation = useToggleActionItem();

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No items.</p>
      )}
      {items.map((item) => (
        <div key={item.id} className="action-item flex items-start gap-3">
          <button
            onClick={() => toggleMutation.mutate({ id: item.id, completed: !item.completed })}
            className="mt-0.5 shrink-0"
          >
            {item.completed ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
            )}
          </button>
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
              {item.deadline && (
                <span className="text-[11px] font-mono-data text-muted-foreground">
                  Due {item.deadline}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
