import { Square, Mic } from "lucide-react";

interface RecordingHUDProps {
  isRecording: boolean;
  time: number;
  onStart: () => void;
  onStop: () => void;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function RecordingHUD({ isRecording, time, onStart, onStop }: RecordingHUDProps) {
  if (!isRecording) return null;

  return (
    <div className="fixed bottom-8 right-8 z-50 flex items-center gap-3 bg-card border border-primary/40 rounded-lg px-4 py-2.5 shadow-lg">
      <div className="w-2.5 h-2.5 rounded-full bg-recording recording-pulse" />
      <span className="font-mono-data text-sm text-foreground">{formatTime(time)}</span>
      <button
        onClick={onStop}
        className="ml-2 flex items-center gap-1.5 bg-recording/10 hover:bg-recording/20 border border-recording/30 text-recording rounded-md px-3 py-1.5 text-xs font-medium transition-colors press-effect"
      >
        <Square className="w-3 h-3" />
        Stop
      </button>
    </div>
  );
}
