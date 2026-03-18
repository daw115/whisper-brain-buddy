import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Users, Tag, Loader2, Brain, FolderOpen, Pencil, Trash2, Check, X, BookOpen } from "lucide-react";
import { useMeeting, useCategories, useUpdateMeeting, useDeleteMeeting } from "@/hooks/use-meetings";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TranscriptView from "@/components/TranscriptView";
import ActionItemsList from "@/components/ActionItemsList";
import AIChatPanel from "@/components/AIChatPanel";
import AnalysisPromptGenerator from "@/components/AnalysisPromptGenerator";
import AnalysisJsonImporter from "@/components/AnalysisJsonImporter";
import GeminiAnalysisButton from "@/components/GeminiAnalysisButton";
import AnalysisComparison from "@/components/AnalysisComparison";
import FrameGallery from "@/components/FrameGallery";
import RecordingPanel from "@/components/RecordingPanel";
import SegmentToolbox from "@/components/SegmentToolbox";
import AIInputPreview from "@/components/AIInputPreview";
import SlideInsightsPanel from "@/components/SlideInsightsPanel";
import SlideTranscriptionButton from "@/components/SlideTranscriptionButton";
import { toast } from "sonner";
import { useBuildKnowledge } from "@/hooks/use-knowledge";

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: meeting, isLoading } = useMeeting(id);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [framesVersion, setFramesVersion] = useState(0);
  
  const { data: categories = [] } = useCategories();
  const queryClient = useQueryClient();
  const updateMeeting = useUpdateMeeting();
  const deleteMeeting = useDeleteMeeting();
  const buildKnowledge = useBuildKnowledge();

  // Editable title state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Editable date state
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState("");

  const handleSaveTitle = () => {
    if (!titleDraft.trim() || !id) return;
    updateMeeting.mutate({ id, title: titleDraft.trim() });
    setEditingTitle(false);
  };

  const handleSaveDate = () => {
    if (!dateDraft || !id) return;
    updateMeeting.mutate({ id, date: dateDraft });
    setEditingDate(false);
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm("Usunąć to spotkanie? Tej operacji nie można cofnąć.")) return;
    deleteMeeting.mutate(id, {
      onSuccess: () => {
        toast.success("Spotkanie usunięte");
        navigate("/");
      },
      onError: () => toast.error("Nie udało się usunąć spotkania"),
    });
  };

  const updateCategory = async (categoryId: string | null) => {
    if (!id) return;
    updateMeeting.mutate({ id, category_id: categoryId });
    toast.success("Kategoria zmieniona");
  };

  // Load analyses from meeting_analyses table
  const { data: analyses = [], refetch: refetchAnalyses } = useQuery({
    queryKey: ["meeting-analyses", id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("meeting_analyses")
        .select("*")
        .eq("meeting_id", id!)
        .order("created_at", { ascending: true });
      return (data || []) as { id: string; meeting_id: string; source: string; analysis_json: any; created_at: string }[];
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!meeting?.recording_filename) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const path = `${user.id}/${meeting.recording_filename}`;
      const { data } = await supabase.storage
        .from("recordings")
        .createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) {
        setRecordingUrl(data.signedUrl);
      } else {
        const stem = meeting.recording_filename.replace(/\.[^.]+$/, "").replace(/_part\d+$/, "");
        const ext = meeting.recording_filename.match(/\.[^.]+$/)?.[0] || ".webm";
        const fallbackPath = `${user.id}/${stem}_part1${ext}`;
        const { data: fb } = await supabase.storage
          .from("recordings")
          .createSignedUrl(fallbackPath, 60 * 60);
        if (fb?.signedUrl) setRecordingUrl(fb.signedUrl);
      }
    })();
  }, [meeting?.recording_filename]);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Meeting not found.</p>
      </div>
    );
  }

  const participants = meeting.meeting_participants || [];
  const tags = meeting.tags || [];

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors press-effect"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors press-effect"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Usuń
        </button>
      </div>

      <div className="flex items-center justify-between mb-4">
        {editingTitle ? (
          <div className="flex items-center gap-2 flex-1 mr-4">
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
              className="text-2xl font-semibold text-foreground bg-transparent border-b-2 border-primary focus:outline-none flex-1"
              autoFocus
            />
            <button onClick={handleSaveTitle} className="p-1 text-primary hover:text-primary/80"><Check className="w-4 h-4" /></button>
            <button onClick={() => setEditingTitle(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <h1 className="text-2xl font-semibold text-foreground">{meeting.title}</h1>
            <button
              onClick={() => { setTitleDraft(meeting.title); setEditingTitle(true); }}
              className="p-1 text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <button
          onClick={() => setShowChat(!showChat)}
          className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md border transition-colors press-effect shrink-0 ${
            showChat
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
          }`}
        >
          <Brain className="w-4 h-4" />
          Ask AI
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground font-mono-data mb-8">
        {/* Editable date */}
        {editingDate ? (
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            <input
              type="datetime-local"
              value={dateDraft}
              onChange={(e) => setDateDraft(e.target.value)}
              className="bg-transparent border border-border rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
            <button onClick={handleSaveDate} className="p-0.5 text-primary hover:text-primary/80"><Check className="w-3 h-3" /></button>
            <button onClick={() => setEditingDate(false)} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
          </span>
        ) : (
          <span
            className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors"
            onClick={() => {
              setDateDraft(meeting.date + "T12:00");
              setEditingDate(true);
            }}
          >
            <Calendar className="w-3.5 h-3.5" />{meeting.date}
            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100" />
          </span>
        )}
        {meeting.duration && (
          <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{meeting.duration}</span>
        )}
        {participants.length > 0 && (
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{participants.map(p => p.name).join(", ")}</span>
        )}
        {tags.length > 0 && (
          <span className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" />{tags.join(", ")}</span>
        )}
        <span className="flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5" />
          <select
            value={meeting.category_id || ""}
            onChange={(e) => updateCategory(e.target.value || null)}
            className="bg-transparent border border-border rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:border-primary/50 cursor-pointer"
          >
            <option value="">Bez kategorii</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          {meeting.categories && (
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meeting.categories.color }} />
          )}
        </span>
      </div>

      <div className="grid grid-cols-12 gap-px bg-border rounded-lg overflow-hidden">
        {/* Left: Summary + Recording + Analysis tools */}
        <div className="col-span-3 bg-card p-5">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">Summary</h2>
          {meeting.summary ? (
            <p className="text-sm text-foreground/80 leading-relaxed">{meeting.summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No summary available.</p>
          )}

          {meeting.decisions && meeting.decisions.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">Decisions</h2>
              <div className="space-y-3">
                {meeting.decisions.map((d) => (
                  <div key={d.id} className="border border-border rounded-md p-3">
                    <p className="text-sm font-semibold text-foreground">{d.decision}</p>
                    {d.rationale && <p className="text-xs text-muted-foreground mt-1">{d.rationale}</p>}
                    {d.timestamp && (
                      <span className="text-[10px] font-mono-data text-muted-foreground/60 mt-2 block">@ {d.timestamp}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {meeting.recording_filename && (
            <>
              <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">Recording</h2>
              <RecordingPanel
                recordingFilename={meeting.recording_filename}
                recordingSizeBytes={meeting.recording_size_bytes}
              />

              {/* Segment Toolbox: MP3 extraction, splitting, transcription, frames */}
              <div className="mt-3 pt-3 border-t border-border">
                <SegmentToolbox
                  recordingFilename={meeting.recording_filename}
                  recordingSizeBytes={meeting.recording_size_bytes}
                  meetingId={meeting.id}
                  framesVersion={framesVersion}
                  onFramesGenerated={() => setFramesVersion((v) => v + 1)}
                  onTranscriptGenerated={() => queryClient.invalidateQueries({ queryKey: ["meeting", id] })}
                />
              </div>

              {/* Frame gallery */}
              <div className="mt-3 pt-3 border-t border-border">
                <FrameGallery
                  recordingFilename={meeting.recording_filename}
                  version={framesVersion}
                />
              </div>
            </>
          )}

          {/* Slide Transcription (OCR) */}
          <div className="mt-6 pt-4 border-t border-border">
            <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-3">Transkrypcja slajdów</h2>
            <SlideTranscriptionButton
              meetingId={meeting.id}
              hasFrames={!!meeting.recording_filename}
              onComplete={() => refetchAnalyses()}
            />
            {/* Show existing slide transcript */}
            {analyses.filter(a => a.source === "slide-transcript").length > 0 && (
              <div className="mt-2 p-2 bg-muted/30 rounded border border-border max-h-40 overflow-y-auto">
                <p className="text-[10px] text-muted-foreground mb-1">📄 Transkrypcja wizualna ({analyses.filter(a => a.source === "slide-transcript")[0].analysis_json?.total_slides || "?"} slajdów)</p>
                <pre className="text-[9px] text-foreground/80 whitespace-pre-wrap font-mono-data leading-relaxed">
                  {analyses.filter(a => a.source === "slide-transcript")[0].analysis_json?.slide_transcript?.slice(0, 2000) || "Brak danych"}
                </pre>
              </div>
            )}
          </div>

          {/* Gemini Analysis */}
          <div className="mt-6 pt-4 border-t border-border">
            <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-3">Analiza Gemini</h2>
            <GeminiAnalysisButton
              meetingId={meeting.id}
              hasFrames={!!meeting.recording_filename}
              recordingFilename={meeting.recording_filename || undefined}
              framesVersion={framesVersion}
              onComplete={() => refetchAnalyses()}
            />
            {analyses.filter(a => a.source === "slide-transcript").length > 0 && (
              <p className="text-[9px] text-primary/70 mt-1">✓ Transkrypcja slajdów dostępna — Gemini połączy oba źródła</p>
            )}
          </div>

          {/* ChatGPT Analysis Kit */}
          <div className="mt-6 pt-4 border-t border-border">
            <AnalysisPromptGenerator meeting={meeting} recordingUrl={recordingUrl} framesVersion={framesVersion} />
          </div>

          {/* ChatGPT JSON Importer */}
          <div className="mt-6 pt-4 border-t border-border">
            <AnalysisJsonImporter
              meetingId={meeting.id}
              onSuccess={() => refetchAnalyses()}
            />
          </div>

          {/* Build Knowledge */}
          <div className="mt-6 pt-4 border-t border-border">
            <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-3">Baza wiedzy</h2>
            <button
              onClick={() => {
                buildKnowledge.mutate(meeting.id, {
                  onSuccess: (data) => {
                    toast.success("Dodano do bazy wiedzy");
                  },
                  onError: (err) => {
                    toast.error("Błąd: " + (err instanceof Error ? err.message : "nieznany"));
                  },
                });
              }}
              disabled={buildKnowledge.isPending}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
            >
              {buildKnowledge.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
              {buildKnowledge.isPending ? "Analizuję..." : "Dodaj do bazy wiedzy"}
            </button>
            <p className="text-[10px] text-muted-foreground/60 mt-1.5">
              AI wyciągnie tematy, wzorce zadań i kontekst projektowy.
            </p>
          </div>
        </div>

        {/* Center: Transcript */}
        <div className="col-span-5 bg-card p-5 border-l border-r border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider">Transcript</h2>
            {meeting.transcript_lines && meeting.transcript_lines.length > 0 && (
              <button
                onClick={async () => {
                  if (!confirm(`Usunąć ${meeting.transcript_lines!.length} linii transkryptu?`)) return;
                  const { error } = await supabase.from("transcript_lines").delete().eq("meeting_id", meeting.id);
                  if (error) {
                    toast.error("Błąd usuwania: " + error.message);
                  } else {
                    toast.success("Transkrypt wyczyszczony");
                    queryClient.invalidateQueries({ queryKey: ["meeting", id] });
                  }
                }}
                className="text-[10px] text-destructive hover:text-destructive/80 transition-colors"
              >
                Wyczyść
              </button>
            )}
          </div>
          {meeting.transcript_lines && meeting.transcript_lines.length > 0 ? (
            <TranscriptView lines={meeting.transcript_lines} meetingTitle={meeting.title} />
          ) : (
            <p className="text-sm text-muted-foreground italic">No transcript available.</p>
          )}

          {/* Slide Insights from AI analysis */}
          {analyses.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <SlideInsightsPanel analyses={analyses} />
            </div>
          )}

          {/* AI Input Preview */}
          <div className="mt-6 pt-4 border-t border-border">
            <AIInputPreview
              meetingId={meeting.id}
              meetingTitle={meeting.title}
              transcriptLines={meeting.transcript_lines || []}
              recordingFilename={meeting.recording_filename}
              framesVersion={framesVersion}
            />
          </div>
        </div>

        {/* Right: Action Items + Participants + Analysis Comparison */}
        <div className="col-span-4 bg-card p-5">
          <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mb-4">Action Items</h2>
          {meeting.action_items && meeting.action_items.length > 0 ? (
            <ActionItemsList items={meeting.action_items} />
          ) : (
            <p className="text-sm text-muted-foreground italic">No action items.</p>
          )}

          {participants.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider mt-6 mb-3">Participants</h2>
              <div className="flex flex-wrap gap-2">
                {participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 border border-border rounded-md px-3 py-1.5">
                    <span className="w-6 h-6 rounded border border-border bg-muted flex items-center justify-center text-[10px] font-mono-data font-bold text-muted-foreground">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-sm text-foreground">{p.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Analysis Comparison */}
          {analyses.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <AnalysisComparison meetingId={meeting.id} analyses={analyses} />
            </div>
          )}
        </div>
      </div>

      {showChat && (
        <div className="mt-6 border border-border rounded-lg overflow-hidden bg-card" style={{ height: 420 }}>
          <AIChatPanel meetingId={id} meetingTitle={meeting.title} />
        </div>
      )}
    </div>
  );
}
