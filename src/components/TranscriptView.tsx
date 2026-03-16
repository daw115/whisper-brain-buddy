import type { TranscriptLine } from "@/lib/mock-data";

interface TranscriptViewProps {
  lines: TranscriptLine[];
}

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

const speakerColors: Record<string, string> = {
  Dawid: "text-primary",
  Elena: "text-amber-400",
  Marcus: "text-sky-400",
  Priya: "text-rose-400",
};

export default function TranscriptView({ lines }: TranscriptViewProps) {
  return (
    <div className="space-y-0">
      {lines.map((line, i) => (
        <div key={i} className="transcript-line flex gap-3 group hover:bg-muted/30 px-2 -mx-2 rounded">
          <span className="text-muted-foreground shrink-0 w-16 select-none">
            {line.timestamp}
          </span>
          <span
            className={`shrink-0 w-6 text-center font-bold text-[11px] ${
              speakerColors[line.speaker] || "text-muted-foreground"
            }`}
          >
            {getInitials(line.speaker)}
          </span>
          <span className="text-foreground/90">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
