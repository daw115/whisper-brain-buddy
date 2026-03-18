/**
 * Extracts key frames from a video blob at regular intervals.
 * Uses an offscreen <video> + <canvas> to capture screenshots of slides.
 */

export interface ExtractedFrame {
  timestamp: number; // seconds
  blob: Blob;
  dataUrl: string;
}

export async function extractFrames(
  videoBlob: Blob,
  intervalSeconds = 30,
  maxFrames = 30,
): Promise<ExtractedFrame[]> {
  const url = URL.createObjectURL(videoBlob);

  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;

    // Wait for metadata
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video"));
      setTimeout(() => reject(new Error("Video load timeout")), 30_000);
    });

    const duration = video.duration;
    if (!duration || !isFinite(duration)) return [];

    // Calculate timestamps to capture
    const timestamps: number[] = [];
    for (let t = 5; t < duration && timestamps.length < maxFrames; t += intervalSeconds) {
      timestamps.push(t);
    }
    // Always capture last frame area
    if (duration > 10 && timestamps[timestamps.length - 1] < duration - 10) {
      timestamps.push(Math.max(0, duration - 5));
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    const frames: ExtractedFrame[] = [];
    let prevHash = "";

    for (const ts of timestamps) {
      video.currentTime = ts;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 3000); // timeout safety
      });

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      // Simple change detection: compare a small sample of pixels
      const sample = ctx.getImageData(
        Math.floor(canvas.width / 4),
        Math.floor(canvas.height / 4),
        Math.min(100, canvas.width),
        Math.min(100, canvas.height),
      );
      const hash = quickHash(sample.data);

      // Skip if frame is too similar to previous (same slide)
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

/** Quick hash of pixel data for change detection */
function quickHash(data: Uint8ClampedArray): string {
  let hash = 0;
  // Sample every 40th byte for speed
  for (let i = 0; i < data.length; i += 40) {
    hash = ((hash << 5) - hash + data[i]) | 0;
  }
  return hash.toString(36);
}

/** Upload frames to storage, returns paths */
export async function uploadFrames(
  supabase: any,
  userId: string,
  recordingStem: string,
  frames: ExtractedFrame[],
): Promise<string[]> {
  const paths: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const path = `${userId}/frames/${recordingStem}/frame_${String(i + 1).padStart(3, "0")}.jpg`;
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
