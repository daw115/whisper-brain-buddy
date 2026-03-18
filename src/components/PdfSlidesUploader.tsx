import { useState, useRef } from "react";
import { FileUp, Loader2, Check, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import * as pdfjsLib from "pdfjs-dist";

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface Props {
  meetingId: string;
  recordingFilename: string;
  onComplete?: (result: any) => void;
}

export default function PdfSlidesUploader({ meetingId, recordingFilename, onComplete }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("Wybierz plik PDF");
      return;
    }

    setUploading(true);
    setProgress("Ładowanie PDF...");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nie zalogowano");

      const stem = recordingFilename.replace(/\.[^.]+$/, "");
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;

      setProgress(`Renderowanie ${numPages} stron...`);

      const slidePaths: { path: string; page: number; ts_formatted: string }[] = [];

      for (let i = 1; i <= numPages; i++) {
        setProgress(`Strona ${i}/${numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // high res

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;

        await page.render({ canvasContext: ctx, viewport }).promise;

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
            "image/jpeg",
            0.85,
          );
        });

        const path = `${user.id}/slides/${stem}/page_${String(i).padStart(3, "0")}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from("recordings")
          .upload(path, blob, { contentType: "image/jpeg", upsert: true });

        if (uploadErr) {
          console.warn(`Upload page ${i} error:`, uploadErr.message);
          continue;
        }

        slidePaths.push({ path, page: i, ts_formatted: `P${i}` });
      }

      setProgress("Zapisywanie metadanych...");

      // Delete previous pdf-slides data
      await (supabase as any).from("meeting_analyses").delete()
        .eq("meeting_id", meetingId).eq("source", "pdf-slides");

      const pdfData = {
        unique_slides: slidePaths.map(s => ({
          path: s.path,
          timestamp: s.page,
          ts_formatted: s.ts_formatted,
        })),
        total_pages: numPages,
        total_unique_slides: slidePaths.length,
        filename: file.name,
      };

      const { error: saveErr } = await (supabase as any).from("meeting_analyses").insert({
        meeting_id: meetingId,
        source: "pdf-slides",
        analysis_json: pdfData,
      });
      if (saveErr) throw new Error("Błąd zapisu: " + saveErr.message);

      setUploadedCount(slidePaths.length);
      onComplete?.(pdfData);
      toast.success(`Wgrano ${slidePaths.length} stron z PDF`);
    } catch (err: any) {
      toast.error("Błąd: " + (err.message || "nieznany"));
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleClear() {
    await (supabase as any).from("meeting_analyses").delete()
      .eq("meeting_id", meetingId).eq("source", "pdf-slides");
    setUploadedCount(null);
    toast.success("Usunięto PDF slajdy");
    onComplete?.({});
  }

  return (
    <div className="space-y-1">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        onChange={handleFile}
        className="hidden"
      />
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex-1 justify-start gap-2 text-xs h-8"
        >
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
          ) : uploadedCount ? (
            <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          ) : (
            <FileUp className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          <span>5. {uploading ? "Wgrywam PDF…" : "Wgraj prezentację (PDF)"}</span>
        </Button>
        {uploadedCount && !uploading && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-8 px-2"
            title="Wyczyść PDF"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
      {uploading && progress && (
        <p className="text-[9px] text-muted-foreground pl-6 animate-pulse">⏳ {progress}</p>
      )}
      {uploadedCount && !uploading && (
        <p className="text-[9px] text-muted-foreground pl-6">✓ {uploadedCount} stron wgrano</p>
      )}
    </div>
  );
}
