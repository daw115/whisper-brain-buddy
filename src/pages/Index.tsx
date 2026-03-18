import { useRef, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";
import RecordingHUD from "@/components/RecordingHUD";
import Dashboard from "@/pages/Dashboard";
import MeetingDetail from "@/pages/MeetingDetail";
import ChatPage from "@/pages/ChatPage";
import ActionsPage from "@/pages/ActionsPage";
import SearchPage from "@/pages/SearchPage";
import SettingsPage from "@/pages/SettingsPage";
import UploadPage from "@/pages/UploadPage";
import { useRecorder } from "@/hooks/use-recorder";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useCreateMeeting } from "@/hooks/use-meetings";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import PinLoginPage from "@/pages/PinLoginPage";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Index() {
  const { user, loading: authLoading } = useAuth();
  const recorder = useRecorder();
  const speech = useSpeechRecognition();
  const createMeeting = useCreateMeeting();

  const handleStartRecording = async () => {
    await recorder.startRecording();
    // Start live transcription alongside recording
    speech.start("pl-PL");
  };

  const durationAtStop = useRef(0);
  const transcriptRef = useRef<ReturnType<typeof speech.stop>>([]);

  const handleStopRecording = () => {
    durationAtStop.current = recorder.recordingTime;
    // Stop speech recognition and capture segments
    transcriptRef.current = speech.stop();
    recorder.stopRecording();
  };

  const handlePause = () => {
    recorder.pauseRecording();
    speech.pause();
  };

  const handleResume = () => {
    recorder.resumeRecording();
    speech.resume();
  };

  // When upload completes, create meeting entry with transcript
  useEffect(() => {
    if (recorder.lastRecording && !recorder.isUploading) {
      const duration = durationAtStop.current;
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      const durationStr = `${mins}:${secs.toString().padStart(2, "0")}`;
      const now = new Date();
      const title = `Meeting ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      createMeeting.mutate(
        {
          title,
          duration: durationStr,
          recording_filename: recorder.lastRecording.filename,
          recording_size_bytes: recorder.lastRecording.blob.size,
        },
        {
          onSuccess: async (meeting) => {
            // Save transcript lines to DB
            const segments = transcriptRef.current;
            if (segments.length > 0 && meeting?.id) {
              const lines = segments.map((seg, i) => ({
                meeting_id: meeting.id,
                timestamp: seg.timestamp,
                speaker: seg.speaker,
                text: seg.text,
                line_order: i,
              }));

              const { error } = await supabase
                .from("transcript_lines")
                .insert(lines);

              if (error) {
                console.error("Failed to save transcript:", error);
                toast.error("Nie udało się zapisać transkryptu");
              } else {
                toast.success(`Transkrypt zapisany — ${segments.length} segmentów`, {
                  duration: 4000,
                });
              }
            }
            transcriptRef.current = [];
          },
        }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.lastRecording, recorder.isUploading]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar isRecording={recorder.isRecording} recordingTime={recorder.recordingTime} />
      <main className="flex-1 min-h-screen overflow-y-auto">
        <Routes>
          <Route index element={<Dashboard onStartRecording={handleStartRecording} />} />
          <Route path="meeting/:id" element={<MeetingDetail />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="actions" element={<ActionsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <RecordingHUD
        isRecording={recorder.isRecording}
        isPaused={recorder.isPaused}
        time={recorder.recordingTime}
        liveTranscript={speech.liveText}
        segmentCount={speech.segments.length}
        onStop={handleStopRecording}
        onPause={handlePause}
        onResume={handleResume}
      />
    </div>
  );
}
