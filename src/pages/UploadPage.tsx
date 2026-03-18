import { useState, useRef } from "react";
import { Upload, FileJson, CheckCircle2, AlertCircle, Loader2, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const EXAMPLE_JSON = `{
  "title": "Sprint Planning Q1",
  "date": "2025-03-18",
  "duration": "45:00",
  "tags": ["planning", "sprint"],
  "summary": "Omówiono priorytety na Q1...",
  "sentiment": "pozytywny",
  "key_quotes": [
    "Musimy skupić się na wydajności - Jan"
  ],
  "participants": ["Jan Kowalski", "Anna Nowak"],
  "transcript": [
    { "timestamp": "00:00", "speaker": "Jan Kowalski", "text": "Zaczynamy spotkanie." },
    { "timestamp": "00:15", "speaker": "Anna Nowak", "text": "Mam listę priorytetów." }
  ],
  "action_items": [
    { "task": "Przygotować roadmapę", "owner": "Jan Kowalski", "deadline": "2025-03-25" },
    { "task": "Review kodu modułu auth", "owner": "Anna Nowak" }
  ],
  "decisions": [
    { "decision": "Używamy React Query zamiast Redux", "rationale": "Prostsze zarządzanie stanem" }
  ]
}`;

export default function UploadPage() {
  const [jsonInput, setJsonInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExample, setShowExample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const handleUpload = async (data: string) => {
    setUploading(true);
    setError(null);
    setResults(null);

    try {
      const parsed = JSON.parse(data);
      const { data: result, error: fnError } = await supabase.functions.invoke("batch-upload", {
        body: parsed,
      });

      if (fnError) throw fnError;
      setResults(result.results);
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["all-action-items"] });
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        setError("Nieprawidłowy JSON. Sprawdź format danych.");
      } else {
        setError(e.message || "Błąd podczas uploadu.");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setJsonInput(text);
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Batch Upload</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Wrzuć przetworzone dane ze spotkań jako JSON — jedno spotkanie lub tablica wielu.
      </p>

      {/* Example toggle */}
      <button
        onClick={() => setShowExample(!showExample)}
        className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 mb-4 transition-colors"
      >
        {showExample ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {showExample ? "Ukryj przykład" : "Pokaż przykład formatu JSON"}
      </button>

      {showExample && (
        <div className="relative mb-6">
          <pre className="bg-secondary border border-border rounded-lg p-4 text-xs text-muted-foreground overflow-x-auto max-h-80 overflow-y-auto font-mono-data">
            {EXAMPLE_JSON}
          </pre>
          <button
            onClick={() => { navigator.clipboard.writeText(EXAMPLE_JSON); }}
            className="absolute top-3 right-3 p-1.5 rounded bg-card border border-border hover:bg-accent transition-colors"
            title="Kopiuj"
          >
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* File input */}
      <div className="flex gap-3 mb-4">
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleFile}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 border border-border rounded-md px-4 py-2.5 text-sm text-foreground bg-card hover:bg-accent transition-colors"
        >
          <FileJson className="w-4 h-4" />
          Wybierz plik .json
        </button>
      </div>

      {/* Textarea */}
      <textarea
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
        placeholder='Wklej JSON tutaj... (jedno spotkanie lub tablica [{ ... }, { ... }])'
        className="w-full h-64 bg-secondary border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground font-mono-data focus:outline-none focus:border-primary/50 transition-colors resize-y"
      />

      {/* Upload button */}
      <button
        onClick={() => handleUpload(jsonInput)}
        disabled={!jsonInput.trim() || uploading}
        className="mt-4 flex items-center gap-2 bg-primary text-primary-foreground rounded-md px-6 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors press-effect"
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading ? "Wysyłanie..." : "Wyślij dane"}
      </button>

      {/* Results */}
      {results && (
        <div className="mt-6 space-y-2">
          {results.map((r: any, i: number) => (
            <div
              key={i}
              className={`flex items-center gap-3 border rounded-md px-4 py-3 text-sm ${
                r.error
                  ? "border-recording/30 bg-recording/5 text-recording"
                  : "border-primary/30 bg-primary/5 text-primary"
              }`}
            >
              {r.error ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span className="font-medium">{r.title}</span>
              {r.error ? (
                <span className="text-xs ml-auto">{r.error}</span>
              ) : (
                <span className="text-xs text-muted-foreground ml-auto font-mono-data">{r.id}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-center gap-2 text-sm text-recording border border-recording/30 bg-recording/5 rounded-md px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
