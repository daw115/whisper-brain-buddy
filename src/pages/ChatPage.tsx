import AIChatPanel from "@/components/AIChatPanel";

export default function ChatPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-8 pt-8 pb-4 border-b border-border">
        <h1 className="text-2xl font-semibold text-foreground">Ask Your Meetings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Semantic search powered by RAG across your entire meeting knowledge base.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <AIChatPanel />
      </div>
    </div>
  );
}
