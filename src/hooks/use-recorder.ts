import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractFrames, uploadFrames } from "@/lib/frame-extractor";

const MAX_SEGMENT_BYTES = 100 * 1024 * 1024; // 100 MB

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  isUploading: boolean;
  recordingTime: number;
  currentSizeMB: number;
  segmentCount: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  lastRecording: { blob: Blob; filename: string; url: string | null } | null;
}

function generateFilename(partIndex?: number) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
  const suffix = partIndex != null ? `_part${partIndex}` : "";
  return `meeting_${date}_${time}${suffix}.webm`;
}

async function uploadToStorage(blob: Blob, filename: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const path = `${user.id}/${filename}`;
  const { error } = await supabase.storage
    .from("recordings")
    .upload(path, blob, { contentType: "video/webm", upsert: true });

  if (error) {
    console.error("Upload error:", error);
    return null;
  }

  const { data: urlData } = await supabase.storage
    .from("recordings")
    .createSignedUrl(path, 60 * 60 * 24 * 365);

  return urlData?.signedUrl ?? null;
}

export function useRecorder(): RecordingState {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentSizeMB, setCurrentSizeMB] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [lastRecording, setLastRecording] = useState<RecordingState["lastRecording"]>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accumulatedSizeRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const isSplittingRef = useRef(false);
  const mimeTypeRef = useRef("video/webm");
  const baseFilenameRef = useRef("");

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setIsPaused(false);
    setRecordingTime(0);
    setCurrentSizeMB(0);
    setSegmentCount(0);
    accumulatedSizeRef.current = 0;
    segmentIndexRef.current = 0;
    isSplittingRef.current = false;
  }, []);

  const uploadSegment = useCallback(async (blob: Blob, filename: string) => {
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
    toast.loading(`Przesyłanie segmentu (${sizeMB} MB)…`, { id: `upload-${filename}` });

    const signedUrl = await uploadToStorage(blob, filename);

    if (signedUrl) {
      toast.success(`Segment przesłany — ${sizeMB} MB`, {
        id: `upload-${filename}`,
        description: filename,
        duration: 4000,
      });
      return { filename, signedUrl };
    } else {
      // Fallback: download locally
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.warning(`Upload failed — pobrano lokalnie (${sizeMB} MB)`, {
        id: `upload-${filename}`,
        duration: 5000,
      });
      return { filename, signedUrl: null };
    }
  }, []);

  const saveCurrentSegment = useCallback(async () => {
    const chunks = chunksRef.current;
    if (chunks.length === 0) return null;

    const blob = new Blob(chunks, { type: mimeTypeRef.current });
    chunksRef.current = [];
    accumulatedSizeRef.current = 0;
    setCurrentSizeMB(0);

    if (blob.size === 0) return null;

    const idx = segmentIndexRef.current;
    segmentIndexRef.current++;
    setSegmentCount(segmentIndexRef.current);

    // If this is the first segment ever (idx=0) and no split happened, use plain filename
    const filename = idx === 0 && !isSplittingRef.current
      ? `${baseFilenameRef.current}.webm`
      : `${baseFilenameRef.current}_part${idx + 1}.webm`;

    const result = await uploadSegment(blob, filename);
    return { blob, ...result };
  }, [uploadSegment]);

  const startNewRecorderSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || stream.getTracks().every(t => t.readyState === "ended")) return;

    const recorder = new MediaRecorder(stream, {
      mimeType: mimeTypeRef.current,
      videoBitsPerSecond: 2_500_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        accumulatedSizeRef.current += e.data.size;
        setCurrentSizeMB(Math.round(accumulatedSizeRef.current / (1024 * 1024)));

        // Check if we need to split
        if (accumulatedSizeRef.current >= MAX_SEGMENT_BYTES && !isSplittingRef.current) {
          isSplittingRef.current = true;
          recorder.stop(); // will trigger onstop → save + restart
        }
      }
    };

    recorder.onstop = async () => {
      if (isSplittingRef.current) {
        // Auto-split: save segment and start new one
        setIsUploading(true);
        await saveCurrentSegment();
        setIsUploading(false);
        isSplittingRef.current = false;

        // Start next segment if stream is still active
        if (streamRef.current && streamRef.current.getTracks().some(t => t.readyState === "live")) {
          startNewRecorderSegment();
        } else {
          cleanup();
        }
        return;
      }

      // Normal stop (user pressed stop)
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      const segIdx = segmentIndexRef.current;
      const hadPriorSegments = segIdx > 0;
      chunksRef.current = [];
      cleanup();

      if (blob.size === 0) return;

      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
      const filename = hadPriorSegments
        ? `${baseFilenameRef.current}_part${segIdx + 1}.webm`
        : `${baseFilenameRef.current}.webm`;

      setIsUploading(true);
      toast.loading("Przesyłanie nagrania…", { id: "upload" });

      const signedUrl = await uploadToStorage(blob, filename);
      setIsUploading(false);

      if (signedUrl) {
        toast.success(`Nagranie przesłane — ${sizeMB} MB`, {
          id: "upload",
          description: filename,
          duration: 5000,
        });
        setLastRecording({ blob, filename, url: signedUrl });

        // Extract frames in background
        toast.loading("Wyodrębnianie klatek…", { id: "frames" });
        try {
          const frames = await extractFrames(blob, 30, 30);
          if (frames.length > 0) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const stem = filename.replace(/\.[^.]+$/, "");
              await uploadFrames(supabase, user.id, stem, frames);
              toast.success(`${frames.length} klatek przechwyconych`, {
                id: "frames",
                duration: 4000,
              });
            }
          } else {
            toast.dismiss("frames");
          }
        } catch (err) {
          console.error("Frame extraction error:", err);
          toast.dismiss("frames");
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        toast.warning(`Upload failed — pobrano lokalnie (${sizeMB} MB)`, {
          id: "upload",
          description: filename,
          duration: 5000,
        });
        setLastRecording({ blob, filename, url: null });
      }
    };

    recorder.onerror = () => {
      toast.error("Nagrywanie nie powiodło się");
      cleanup();
    };

    recorder.start(1000); // 1s chunks for size monitoring
    mediaRecorderRef.current = recorder;
  }, [cleanup, saveCurrentSegment]);

  const stopRecording = useCallback(() => {
    isSplittingRef.current = false; // ensure normal stop flow
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      cleanup();
    }
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });

      let combinedStream = displayStream;
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioCtx = new AudioContext();
        const dest = audioCtx.createMediaStreamDestination();

        const displayAudioTracks = displayStream.getAudioTracks();
        if (displayAudioTracks.length > 0) {
          const sysSource = audioCtx.createMediaStreamSource(new MediaStream(displayAudioTracks));
          sysSource.connect(dest);
        }

        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(dest);

        combinedStream = new MediaStream([
          ...displayStream.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ]);

        displayStream.getVideoTracks()[0].addEventListener("ended", () => {
          micStream.getTracks().forEach((t) => t.stop());
          audioCtx.close();
        });
      } catch {
        // Mic not available
      }

      streamRef.current = combinedStream;
      chunksRef.current = [];
      accumulatedSizeRef.current = 0;
      segmentIndexRef.current = 0;
      setCurrentSizeMB(0);
      setSegmentCount(0);
      isSplittingRef.current = false;

      // Generate base filename (without extension)
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
      baseFilenameRef.current = `meeting_${date}_${time}`;

      mimeTypeRef.current = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

      displayStream.getVideoTracks()[0].addEventListener("ended", () => {
        stopRecording();
      });

      startNewRecorderSegment();
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);
      setLastRecording(null);

      toast.success("Nagrywanie rozpoczęte", {
        description: "Przechwytywanie ekranu aktywne. Auto-podział co 100 MB.",
      });
    } catch {
      // User cancelled
    }
  }, [cleanup, stopRecording, startNewRecorderSegment]);

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.pause();
      setIsPaused(true);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "paused") {
      recorder.resume();
      setIsPaused(false);
    }
  }, []);

  // Timer
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, isPaused]);

  return {
    isRecording,
    isPaused,
    isUploading,
    recordingTime,
    currentSizeMB,
    segmentCount,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    lastRecording,
  };
}
