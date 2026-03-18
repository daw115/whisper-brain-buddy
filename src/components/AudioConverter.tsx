import { useState, useRef } from "react";
import { Music, Loader2, Download } from "lucide-react";
import { toast } from "sonner";

interface Props {
  recordingUrl: string;
  filename: string;
}

export default function AudioConverter({ recordingUrl, filename }: Props) {
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mp3Url, setMp3Url] = useState<string | null>(null);
  const ffmpegRef = useRef<any>(null);

  const mp3Filename = filename.replace(/\.[^.]+$/, ".mp3");

  async function handleConvert() {
    setConverting(true);
    setProgress(0);

    try {
      // Dynamic import to avoid loading FFmpeg until needed
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      if (!ffmpegRef.current) {
        const ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress: p }) => {
          setProgress(Math.round(p * 100));
        });
        
        // Load FFmpeg WASM from CDN
        await ffmpeg.load({
          coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
          wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
        });
        ffmpegRef.current = ffmpeg;
      }

      const ffmpeg = ffmpegRef.current;

      toast.info("Pobieranie nagrania…");
      const videoData = await fetchFile(recordingUrl);
      await ffmpeg.writeFile("input.webm", videoData);

      toast.info("Konwersja do MP3… To może potrwać kilka minut.");
      await ffmpeg.exec([
        "-i", "input.webm",
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "64k",
        "-f", "mp3",
        "output.mp3",
      ]);

      const data = await ffmpeg.readFile("output.mp3");
      const blob = new Blob([data], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      setMp3Url(url);

      // Clean up FFmpeg filesystem
      await ffmpeg.deleteFile("input.webm");
      await ffmpeg.deleteFile("output.mp3");

      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
      toast.success(`Gotowe! Plik MP3: ${sizeMB} MB`);
    } catch (err: any) {
      console.error("FFmpeg conversion error:", err);
      toast.error("Błąd konwersji: " + (err.message || "nieznany błąd"));
    } finally {
      setConverting(false);
      setProgress(0);
    }
  }

  function handleDownloadMp3() {
    if (!mp3Url) return;
    const a = document.createElement("a");
    a.href = mp3Url;
    a.download = mp3Filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  if (mp3Url) {
    return (
      <button
        onClick={handleDownloadMp3}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        Pobierz MP3
      </button>
    );
  }

  return (
    <button
      onClick={handleConvert}
      disabled={converting}
      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
    >
      {converting ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {progress > 0 ? `MP3 ${progress}%` : "Ładowanie FFmpeg…"}
        </>
      ) : (
        <>
          <Music className="w-3.5 h-3.5" />
          Konwertuj do MP3
        </>
      )}
    </button>
  );
}
