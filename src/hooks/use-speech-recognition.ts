import { useState, useRef, useCallback } from "react";

export interface TranscriptSegment {
  timestamp: string; // "MM:SS"
  speaker: string;
  text: string;
  startSeconds: number;
}

interface SpeechRecognitionState {
  isListening: boolean;
  segments: TranscriptSegment[];
  liveText: string;
  start: (language?: string) => void;
  stop: () => TranscriptSegment[];
  pause: () => void;
  resume: () => void;
  clear: () => void;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type SpeechRecognitionInstance = InstanceType<typeof window.SpeechRecognition> & any;

// Check browser support
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useSpeechRecognition(): SpeechRecognitionState {
  const [isListening, setIsListening] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [liveText, setLiveText] = useState("");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const startTimeRef = useRef<number>(0);
  const segmentsRef = useRef<TranscriptSegment[]>([]);

  const start = useCallback((language = "pl-PL") => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) {
      console.warn("Web Speech API not supported in this browser");
      return;
    }

    // Clean up existing
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { }
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 1;

    startTimeRef.current = Date.now();
    segmentsRef.current = [];
    setSegments([]);
    setLiveText("");

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();

        if (result.isFinal && text.length > 0) {
          const elapsedMs = Date.now() - startTimeRef.current;
          const elapsedSec = Math.floor(elapsedMs / 1000);

          const segment: TranscriptSegment = {
            timestamp: formatTimestamp(elapsedSec),
            speaker: "Speaker",
            text,
            startSeconds: elapsedSec,
          };

          segmentsRef.current = [...segmentsRef.current, segment];
          setSegments([...segmentsRef.current]);
          setLiveText("");
        } else {
          interim += text + " ";
        }
      }

      if (interim.trim()) {
        setLiveText(interim.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" and "aborted" are normal during pauses
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("Speech recognition error:", event.error);
      }
    };

    // Auto-restart on end (browser stops after silence)
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          // Already stopped intentionally
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
    }
  }, []);

  const stop = useCallback((): TranscriptSegment[] => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null; // Prevent auto-restart
    if (recognition) {
      try { recognition.stop(); } catch { }
    }
    setIsListening(false);
    setLiveText("");
    return segmentsRef.current;
  }, []);

  const pause = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognitionRef.current = null; // Prevent auto-restart
      try { recognition.stop(); } catch { }
      // Keep the ref data so resume can restart
      (window as any).__cerebro_paused_lang = recognition.lang;
    }
    setIsListening(false);
  }, []);

  const resume = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    const lang = (window as any).__cerebro_paused_lang || "pl-PL";
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal && text.length > 0) {
          const elapsedMs = Date.now() - startTimeRef.current;
          const elapsedSec = Math.floor(elapsedMs / 1000);
          const segment: TranscriptSegment = {
            timestamp: formatTimestamp(elapsedSec),
            speaker: "Speaker",
            text,
            startSeconds: elapsedSec,
          };
          segmentsRef.current = [...segmentsRef.current, segment];
          setSegments([...segmentsRef.current]);
          setLiveText("");
        } else {
          interim += text + " ";
        }
      }
      if (interim.trim()) setLiveText(interim.trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("Speech recognition error:", event.error);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        try { recognition.start(); } catch { }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch (err) {
      console.error("Failed to resume speech recognition:", err);
    }
  }, []);

  const clear = useCallback(() => {
    segmentsRef.current = [];
    setSegments([]);
    setLiveText("");
  }, []);

  return { isListening, segments, liveText, start, stop, pause, resume, clear };
}
