export default function SettingsPage() {
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-8">Configuration for Cerebro.</p>

      <div className="space-y-6">
        {[
          { label: "OpenAI API Key", value: "sk-••••••••••••••••", desc: "Used for transcript analysis and RAG chat." },
          { label: "Google Drive Folder", value: "/Meetings", desc: "Root folder for meeting recordings and metadata." },
          { label: "Whisper Model", value: "large-v3", desc: "Speech-to-text model used for transcription." },
          { label: "Vector Database", value: "pgvector (PostgreSQL)", desc: "Embedding storage for semantic search." },
        ].map((item) => (
          <div key={item.label} className="border border-border rounded-lg bg-card p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-foreground">{item.label}</span>
              <span className="font-mono-data text-xs text-muted-foreground">{item.value}</span>
            </div>
            <p className="text-xs text-muted-foreground">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
