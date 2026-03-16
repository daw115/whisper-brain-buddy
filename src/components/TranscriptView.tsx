import type { DbTranscriptLine } from "@/hooks/use-meetings";

interface TranscriptViewProps {
  lines: DbTranscriptLine[];
}

const speakerColors: Record<string, string> = {
  Dawid: "text-primary",
  Elena: "text-amber-400",
  Marcus: "text-sky-400",
  Priya: "text-rose-400",
};

function getColor(speaker: string) {
  if (speakerColors[speaker]) return speakerColors[speaker];
  // Generate a deterministic color class based on speaker name
  const colors = ["text-primary", "text-amber-400", "text-sky-400", "text-rose-400", "text-violet-400", "text-teal-400"];
  const hash = speaker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export default function TranscriptView({ lines }: TranscriptViewProps) {
  return (
    <div className="space-y-0">
      {lines.map((line) => (
        <div key={line.id} className="transcript-line flex gap-3 group hover:bg-muted/30 px-2 -mx-2 rounded">
          <span className="text-muted-foreground shrink-0 w-16 select-none">
            {line.timestamp}
          </span>
          <span className={`shrink-0 w-6 text-center font-bold text-[11px] ${getColor(line.speaker)}`}>
            {line.speaker.slice(0, 2).toUpperCase()}
          </span>
          <span className="text-foreground/90">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
