/**
 * Extracts key frames from a video blob at regular intervals.
 * Uses an offscreen <video> + <canvas> to capture screenshots of slides.
 */

export interface ExtractedFrame {
  timestamp: number; // seconds
  blob: Blob;
  dataUrl: string;
}

export interface ProgressInfo {
  phase: "loading" | "extracting" | "uploading";
  current: number;
  total: number;
  percent: number;
}

export type ProgressCallback = (info: ProgressInfo) => void;

export async function extractFrames(
  videoBlob: Blob,
  intervalSeconds = 30,
  maxFrames = 30,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ExtractedFrame[]> {
  const url = URL.createObjectURL(videoBlob);

  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;

    onProgress?.({ phase: "loading", current: 0, total: 1, percent: 0 });

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video"));
      setTimeout(() => reject(new Error("Video load timeout")), 30_000);
    });

    if (signal?.aborted) throw new DOMException("Anulowano", "AbortError");

    onProgress?.({ phase: "loading", current: 1, total: 1, percent: 100 });

    const duration = video.duration;
    if (!duration || !isFinite(duration)) return [];

    const timestamps: number[] = [];
    for (let t = 5; t < duration && timestamps.length < maxFrames; t += intervalSeconds) {
      timestamps.push(t);
    }
    if (duration > 10 && timestamps[timestamps.length - 1] < duration - 10) {
      timestamps.push(Math.max(0, duration - 5));
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const frames: ExtractedFrame[] = [];
    let prevHash = "";

    for (let i = 0; i < timestamps.length; i++) {
      if (signal?.aborted) throw new DOMException("Anulowano", "AbortError");

      const ts = timestamps[i];
      onProgress?.({
        phase: "extracting",
        current: i + 1,
        total: timestamps.length,
        percent: Math.round(((i + 1) / timestamps.length) * 100),
      });

      video.currentTime = ts;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 3000);
      });

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const sample = ctx.getImageData(
        Math.floor(canvas.width / 4),
        Math.floor(canvas.height / 4),
        Math.min(100, canvas.width),
        Math.min(100, canvas.height),
      );
      const hash = quickHash(sample.data);

      if (hash === prevHash) continue;
      prevHash = hash;

      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
      const blob = await (await fetch(dataUrl)).blob();
      frames.push({ timestamp: ts, blob, dataUrl });
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function quickHash(data: Uint8ClampedArray): string {
  let hash = 0;
  for (let i = 0; i < data.length; i += 40) {
    hash = ((hash << 5) - hash + data[i]) | 0;
  }
  return hash.toString(36);
}

export async function uploadFrames(
  supabase: any,
  userId: string,
  recordingStem: string,
  frames: ExtractedFrame[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<string[]> {
  const paths: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new DOMException("Anulowano", "AbortError");

    onProgress?.({
      phase: "uploading",
      current: i + 1,
      total: frames.length,
      percent: Math.round(((i + 1) / frames.length) * 100),
    });

    const secs = Math.round(frames[i].timestamp);
    const path = `${userId}/frames/${recordingStem}/frame_${secs}s.jpg`;
    const { error } = await supabase.storage
      .from("recordings")
      .upload(path, frames[i].blob, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (!error) paths.push(path);
  }

  return paths;
}
