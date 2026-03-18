import { useState } from "react";
import { Loader2, BookOpen, TrendingUp, FolderKanban, Hash, Pencil, Check, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  useKnowledgeSummaries,
  useTaskPatterns,
  useProjectContexts,
  useUpdateTaskPattern,
  useUpdateProjectContext,
  type TaskPattern,
  type ProjectContext,
} from "@/hooks/use-knowledge";
import { useMeetings } from "@/hooks/use-meetings";

function SummariesTab() {
  const { data: summaries = [], isLoading } = useKnowledgeSummaries();
  const { data: meetings = [] } = useMeetings();
  const [filterProject, setFilterProject] = useState<string>("all");

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const projects = [...new Set(summaries.map(s => s.project_context).filter(Boolean))] as string[];
  const filtered = filterProject === "all" ? summaries : summaries.filter(s => s.project_context === filterProject);

  const getMeetingTitle = (meetingId: string) => meetings.find(m => m.id === meetingId)?.title || "—";

  return (
    <div>
      {projects.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setFilterProject("all")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filterProject === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            Wszystkie
          </button>
          {projects.map(p => (
            <button
              key={p}
              onClick={() => setFilterProject(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filterProject === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-8 text-center">
          Brak podsumowań. Użyj "Dodaj do bazy wiedzy" na stronie spotkania.
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map(s => (
            <div key={s.id} className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-xs text-muted-foreground font-mono-data">{getMeetingTitle(s.meeting_id)}</p>
                  <p className="text-xs text-muted-foreground/60 font-mono-data mt-0.5">
                    {new Date(s.created_at).toLocaleDateString("pl-PL")}
                    {s.project_context && <span className="ml-2 text-primary">· {s.project_context}</span>}
                    {s.sentiment && <span className="ml-2">· {s.sentiment}</span>}
                  </p>
                </div>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed mb-3">{s.summary_text}</p>
              {s.key_topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {s.key_topics.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-[11px] font-mono-data text-muted-foreground">
                      <Hash className="w-2.5 h-2.5" />{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PatternsTab() {
  const { data: patterns = [], isLoading } = useTaskPatterns();
  const updatePattern = useUpdateTaskPattern();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<TaskPattern>>({});

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  if (patterns.length === 0) return <p className="text-sm text-muted-foreground italic py-8 text-center">Brak wzorców. AI wykryje je po analizie spotkań.</p>;

  return (
    <div className="space-y-3">
      {patterns.map(p => (
        <div key={p.id} className="border border-border rounded-lg p-4 bg-card">
          {editingId === p.id ? (
            <div className="space-y-2">
              <input
                value={draft.pattern_name || ""}
                onChange={e => setDraft(d => ({ ...d, pattern_name: e.target.value }))}
                className="w-full bg-transparent border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary/50"
              />
              <input
                value={(draft.keywords || []).join(", ")}
                onChange={e => setDraft(d => ({ ...d, keywords: e.target.value.split(",").map(k => k.trim()).filter(Boolean) }))}
                placeholder="słowa kluczowe (rozdzielone przecinkami)"
                className="w-full bg-transparent border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50"
              />
              <input
                value={draft.suggested_category || ""}
                onChange={e => setDraft(d => ({ ...d, suggested_category: e.target.value }))}
                placeholder="sugerowana kategoria"
                className="w-full bg-transparent border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    updatePattern.mutate({ id: p.id, ...draft });
                    setEditingId(null);
                  }}
                  className="p-1 text-primary hover:text-primary/80"
                ><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setEditingId(null)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-primary" />
                  <span className="text-sm font-medium text-foreground">{p.pattern_name}</span>
                  <span className="text-[10px] font-mono-data text-muted-foreground bg-muted px-1.5 py-0.5 rounded">×{p.frequency}</span>
                </div>
                {p.suggested_category && <p className="text-[11px] text-muted-foreground mb-1">Kategoria: {p.suggested_category}</p>}
                {p.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.keywords.map((k, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono-data text-muted-foreground">{k}</span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/50 font-mono-data mt-1">Ostatnio: {new Date(p.last_seen).toLocaleDateString("pl-PL")}</p>
              </div>
              <button
                onClick={() => { setEditingId(p.id); setDraft({ pattern_name: p.pattern_name, keywords: p.keywords, suggested_category: p.suggested_category }); }}
                className="p-1 text-muted-foreground/40 hover:text-muted-foreground"
              ><Pencil className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProjectsTab() {
  const { data: contexts = [], isLoading } = useProjectContexts();
  const updateContext = useUpdateProjectContext();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ProjectContext>>({});

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  if (contexts.length === 0) return <p className="text-sm text-muted-foreground italic py-8 text-center">Brak kontekstów projektowych.</p>;

  return (
    <div className="space-y-3">
      {contexts.map(c => (
        <div key={c.id} className="border border-border rounded-lg p-4 bg-card">
          {editingId === c.id ? (
            <div className="space-y-2">
              <input value={draft.name || ""} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className="w-full bg-transparent border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              <input value={draft.description || ""} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="opis" className="w-full bg-transparent border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50" />
              <div className="flex items-center gap-2">
                <input type="color" value={draft.color || "#6366f1"} onChange={e => setDraft(d => ({ ...d, color: e.target.value }))} className="w-6 h-6 rounded cursor-pointer" />
                <input value={(draft.keywords || []).join(", ")} onChange={e => setDraft(d => ({ ...d, keywords: e.target.value.split(",").map(k => k.trim()).filter(Boolean) }))} placeholder="keywords" className="flex-1 bg-transparent border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { updateContext.mutate({ id: c.id, ...draft }); setEditingId(null); }} className="p-1 text-primary hover:text-primary/80"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setEditingId(null)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  <span className="text-[10px] font-mono-data text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{c.meeting_count} spotkań</span>
                </div>
                {c.description && <p className="text-xs text-muted-foreground mb-1">{c.description}</p>}
                {c.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.keywords.map((k, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono-data text-muted-foreground">{k}</span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/50 font-mono-data mt-1">Aktywność: {new Date(c.last_activity).toLocaleDateString("pl-PL")}</p>
              </div>
              <button
                onClick={() => { setEditingId(c.id); setDraft({ name: c.name, description: c.description || "", color: c.color, keywords: c.keywords }); }}
                className="p-1 text-muted-foreground/40 hover:text-muted-foreground"
              ><Pencil className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Knowledge Base</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Baza wiedzy budowana z Twoich spotkań — tematy, wzorce zadań i konteksty projektowe.
      </p>

      <Tabs defaultValue="summaries">
        <TabsList className="mb-6">
          <TabsTrigger value="summaries" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />Podsumowania
          </TabsTrigger>
          <TabsTrigger value="patterns" className="gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />Wzorce zadań
          </TabsTrigger>
          <TabsTrigger value="projects" className="gap-1.5">
            <FolderKanban className="w-3.5 h-3.5" />Projekty
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summaries"><SummariesTab /></TabsContent>
        <TabsContent value="patterns"><PatternsTab /></TabsContent>
        <TabsContent value="projects"><ProjectsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
