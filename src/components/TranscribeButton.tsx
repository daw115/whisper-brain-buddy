import { useState, useRef } from "react";
import { FileAudio, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

interface Props {
  meetingId: string;
  recordingUrl: string;
  recordingFilename: string;
  onComplete?: () => void;
}

type Phase = "idle" | "converting" | "transcribing" | "saving";

const phaseLabels: Record<Phase, string> = {
  idle: "",
  converting: "Konwersja do MP3…",
  transcribing: "Transkrypcja AI…",
  saving: "Zapisywanie…",
};

export default function TranscribeButton({ meetingId, recordingUrl, recordingFilename, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [convertProgress, setConvertProgress] = useState(0);
  const ffmpegRef = useRef<any>(null);

  async function handleTranscribe() {
    setPhase("converting");
    setConvertProgress(0);

    try {
      // 1. Convert to MP3 using FFmpeg WASM
      toast.loading("Konwersja do MP3…", { id: "transcribe" });

      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      if (!ffmpegRef.current) {
        const ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress: p }) => {
          setConvertProgress(Math.round(p * 100));
        });
        const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
        await ffmpeg.load({
          coreURL: `${baseURL}/ffmpeg-core.js`,
          wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });
        ffmpegRef.current = ffmpeg;
      }

      const ffmpeg = ffmpegRef.current;
      const videoData = await fetchFile(recordingUrl);
      await ffmpeg.writeFile("input.webm", videoData);

      await ffmpeg.exec([
        "-i", "input.webm",
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "64k",
        "-f", "mp3",
        "output.mp3",
      ]);

      const mp3Data = await ffmpeg.readFile("output.mp3") as Uint8Array;
      await ffmpeg.deleteFile("input.webm");
      await ffmpeg.deleteFile("output.mp3");

      const mp3SizeMB = mp3Data.length / (1024 * 1024);
      toast.loading(`MP3 gotowe (${mp3SizeMB.toFixed(1)} MB). Transkrypcja…`, { id: "transcribe" });

      if (mp3SizeMB > 20) {
        toast.error("Plik MP3 za duży (>20 MB). Podziel nagranie na mniejsze segmenty i transkrybuj każdy osobno.", { id: "transcribe" });
        return;
      }

      // 2. Convert to base64
      setPhase("transcribing");
      const base64 = uint8ToBase64(mp3Data);

      // 3. Send to edge function
      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: { audioBase64: base64, mimeType: "audio/mpeg", language: "pl" },
      });

      if (error) throw new Error(error.message || "Błąd transkrypcji");
      if (data?.error) throw new Error(data.error);

      const lines = data?.lines || [];
      if (lines.length === 0) {
        toast.warning("Nie rozpoznano mowy w nagraniu", { id: "transcribe" });
        return;
      }

      // 4. Save to transcript_lines
      setPhase("saving");
      toast.loading("Zapisywanie transkryptu…", { id: "transcribe" });

      // Delete existing transcript lines for this meeting first
      await supabase
        .from("transcript_lines")
        .delete()
        .eq("meeting_id", meetingId);

      const rows = lines.map((line: any, idx: number) => ({
        meeting_id: meetingId,
        timestamp: line.timestamp || "00:00",
        speaker: line.speaker || "Mówca",
        text: line.text,
        line_order: idx,
      }));

      const { error: insertError } = await supabase
        .from("transcript_lines")
        .insert(rows);

      if (insertError) throw insertError;

      // Update meeting summary if available
      if (data?.full_text) {
        await supabase
          .from("meetings")
          .update({ summary: data.full_text.slice(0, 500) })
          .eq("id", meetingId);
      }

      toast.success(`Transkrypcja zakończona — ${lines.length} linii`, { id: "transcribe", duration: 5000 });
      onComplete?.();
    } catch (err: any) {
      console.error("Transcribe error:", err);
      toast.error("Błąd: " + (err.message || "nieznany"), { id: "transcribe" });
    } finally {
      setPhase("idle");
      setConvertProgress(0);
    }
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-2">
      {busy && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground">
            {phaseLabels[phase]}
            {phase === "converting" && convertProgress > 0 && ` ${convertProgress}%`}
          </p>
          <Progress
            value={phase === "converting" ? convertProgress : undefined}
            className="h-1.5"
          />
        </div>
      )}
      <button
        onClick={handleTranscribe}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {phaseLabels[phase]}
          </>
        ) : (
          <>
            <FileAudio className="w-3.5 h-3.5" />
            Transkrybuj (AI)
          </>
        )}
      </button>
    </div>
  );
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
