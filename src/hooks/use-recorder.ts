import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractFrames, uploadFrames } from "@/lib/frame-extractor";

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  isUploading: boolean;
  recordingTime: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  lastRecording: { blob: Blob; filename: string; url: string | null } | null;
}

function generateFilename() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
  return `meeting_${date}_${time}.webm`;
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
    .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 year

  return urlData?.signedUrl ?? null;
}

export function useRecorder(): RecordingState {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [lastRecording, setLastRecording] = useState<RecordingState["lastRecording"]>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  }, []);

  const stopRecording = useCallback(() => {
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

      const mimeType = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const filename = generateFilename();
        chunksRef.current = [];
        cleanup();

        if (blob.size === 0) return;

        const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);

        // Upload to cloud
        setIsUploading(true);
        toast.loading("Uploading recording…", { id: "upload" });

        const signedUrl = await uploadToStorage(blob, filename);

        setIsUploading(false);

        if (signedUrl) {
          toast.success(`Recording uploaded — ${sizeMB} MB`, {
            id: "upload",
            description: filename,
            duration: 5000,
          });
          setLastRecording({ blob, filename, url: signedUrl });

          // Extract and upload slide frames in background
          toast.loading("Extracting slide frames…", { id: "frames" });
          try {
            const frames = await extractFrames(blob, 30, 30);
            if (frames.length > 0) {
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                const stem = filename.replace(/\.[^.]+$/, "");
                await uploadFrames(supabase, user.id, stem, frames);
                toast.success(`${frames.length} slide frames captured`, {
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
          // Fallback: download locally
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);

          toast.warning(`Upload failed — downloaded locally (${sizeMB} MB)`, {
            id: "upload",
            description: filename,
            duration: 5000,
          });
          setLastRecording({ blob, filename, url: null });
        }
      };

      recorder.onerror = () => {
        toast.error("Recording failed");
        cleanup();
      };

      displayStream.getVideoTracks()[0].addEventListener("ended", () => {
        stopRecording();
      });

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);
      setLastRecording(null);

      toast.success("Recording started", {
        description: "Screen capture active. Click Stop to save.",
      });
    } catch {
      // User cancelled
    }
  }, [cleanup, stopRecording]);

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
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    lastRecording,
  };
}
