import { Download } from "lucide-react";
import type { DbTranscriptLine } from "@/hooks/use-meetings";

interface TranscriptViewProps {
  lines: DbTranscriptLine[];
  meetingTitle?: string;
}

const speakerColors: Record<string, string> = {
  Dawid: "text-primary",
  Elena: "text-amber-400",
  Marcus: "text-sky-400",
  Priya: "text-rose-400",
};

function getColor(speaker: string) {
  if (speakerColors[speaker]) return speakerColors[speaker];
  const colors = ["text-primary", "text-amber-400", "text-sky-400", "text-rose-400", "text-violet-400", "text-teal-400"];
  const hash = speaker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

/** Parse MM:SS or HH:MM:SS to total seconds */
function parseTimestamp(ts: string): number {
  const parts = ts.replace(/[\[\]]/g, "").split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function formatSrtTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},000`;
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob(["\uFEFF" + content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTxt(lines: DbTranscriptLine[], title: string) {
  const header = `Transkrypt: ${title}\n${"=".repeat(40)}\n\n`;
  const body = lines.map((l) => {
    const slideMarker = l.text.match(/\[slajd\s*@\s*[\d:]+\]/gi);
    const prefix = `[${l.timestamp}] ${l.speaker}:`;
    return `${prefix} ${l.text}`;
  }).join("\n");
  downloadFile(header + body, `${title.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]/g, "_")}_transkrypt.txt`, "text/plain");
}

function exportSrt(lines: DbTranscriptLine[], title: string) {
  const srtLines = lines.map((l, i) => {
    const startSec = parseTimestamp(l.timestamp);
    const nextSec = i < lines.length - 1 ? parseTimestamp(lines[i + 1].timestamp) : startSec + 5;
    const endSec = Math.max(nextSec, startSec + 1);

    const speakerPrefix = l.speaker && l.speaker !== "Mówca" ? `<b>${l.speaker}:</b> ` : "";
    const text = `${speakerPrefix}${l.text}`;

    return `${i + 1}\n${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n${text}\n`;
  });
  downloadFile(srtLines.join("\n"), `${title.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]/g, "_")}_transkrypt.srt`, "text/srt");
}

export default function TranscriptView({ lines, meetingTitle = "spotkanie" }: TranscriptViewProps) {
  return (
    <div className="space-y-2">
      {/* Export buttons */}
      {lines.length > 0 && (
        <div className="flex items-center gap-2 justify-end mb-1">
          <button
            onClick={() => exportTxt(lines, meetingTitle)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:bg-muted/50"
          >
            <Download className="w-3 h-3" />
            TXT
          </button>
          <button
            onClick={() => exportSrt(lines, meetingTitle)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:bg-muted/50"
          >
            <Download className="w-3 h-3" />
            SRT
          </button>
        </div>
      )}

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
    </div>
  );
}
