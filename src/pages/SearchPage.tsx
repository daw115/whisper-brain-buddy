import { useState } from "react";
import { Search } from "lucide-react";
import MeetingCard from "@/components/MeetingCard";
import { mockMeetings } from "@/lib/mock-data";

export default function SearchPage() {
  const [query, setQuery] = useState("");

  const results = query.trim()
    ? mockMeetings.filter(
        (m) =>
          m.title.toLowerCase().includes(query.toLowerCase()) ||
          m.tags.some((t) => t.includes(query.toLowerCase())) ||
          m.summary?.toLowerCase().includes(query.toLowerCase()) ||
          m.participants.some((p) => p.toLowerCase().includes(query.toLowerCase()))
      )
    : [];

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Search</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Semantic search across all meeting transcripts, summaries, and decisions.
      </p>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Why did we delay the transformer?"
          className="w-full bg-secondary border border-border rounded-lg pl-12 pr-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
        />
      </div>

      {query.trim() && (
        <p className="text-xs text-muted-foreground font-mono-data mb-4">
          {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
        </p>
      )}

      <div className="space-y-2">
        {results.map((m, i) => (
          <MeetingCard key={m.id} meeting={m} index={i} />
        ))}
      </div>

      {!query.trim() && (
        <div className="text-center py-20">
          <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Start typing to search your meeting knowledge base.
          </p>
        </div>
      )}
    </div>
  );
}
