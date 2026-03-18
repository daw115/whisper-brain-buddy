import { Square, Pause, Play, Mic } from "lucide-react";

interface RecordingHUDProps {
  isRecording: boolean;
  isPaused: boolean;
  time: number;
  liveTranscript?: string;
  segmentCount?: number;
  currentSizeMB?: number;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export default function RecordingHUD({
  isRecording,
  isPaused,
  time,
  liveTranscript,
  segmentCount = 0,
  onStop,
  onPause,
  onResume,
}: RecordingHUDProps) {
  if (!isRecording) return null;

  return (
    <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end gap-2">
      {/* Live transcript preview */}
      {liveTranscript && (
        <div className="max-w-xs bg-card/95 backdrop-blur border border-border rounded-lg px-3 py-2 shadow-lg">
          <p className="text-[11px] text-muted-foreground truncate">{liveTranscript}</p>
        </div>
      )}

      {/* Main HUD bar */}
      <div className="flex items-center gap-3 bg-card border border-primary/40 rounded-lg px-4 py-2.5 shadow-lg">
        <div className={`w-2.5 h-2.5 rounded-full ${isPaused ? "bg-amber-400" : "bg-recording recording-pulse"}`} />
        <span className="font-mono-data text-sm text-foreground">{formatTime(time)}</span>
        {isPaused ? (
          <span className="text-[10px] uppercase text-amber-400 font-mono-data tracking-wider">Paused</span>
        ) : null}

        {/* Transcript indicator */}
        {segmentCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono-data">
            <Mic className="w-3 h-3" />
            {segmentCount}
          </span>
        )}

        <div className="flex items-center gap-1.5 ml-1">
          {isPaused ? (
            <button
              onClick={onResume}
              className="flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary rounded-md px-3 py-1.5 text-xs font-medium transition-colors press-effect"
            >
              <Play className="w-3 h-3" />
              Resume
            </button>
          ) : (
            <button
              onClick={onPause}
              className="flex items-center gap-1.5 bg-muted hover:bg-muted/80 border border-border text-muted-foreground rounded-md px-3 py-1.5 text-xs font-medium transition-colors press-effect"
            >
              <Pause className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 bg-recording/10 hover:bg-recording/20 border border-recording/30 text-recording rounded-md px-3 py-1.5 text-xs font-medium transition-colors press-effect"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
