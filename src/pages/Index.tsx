import { Routes, Route } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";
import RecordingHUD from "@/components/RecordingHUD";
import Dashboard from "@/pages/Dashboard";
import MeetingDetail from "@/pages/MeetingDetail";
import ChatPage from "@/pages/ChatPage";
import ActionsPage from "@/pages/ActionsPage";
import SearchPage from "@/pages/SearchPage";
import SettingsPage from "@/pages/SettingsPage";
import { useRecorder } from "@/hooks/use-recorder";
import { useCreateMeeting } from "@/hooks/use-meetings";
import { useAuth } from "@/hooks/use-auth";
import AuthPage from "@/pages/AuthPage";
import { Loader2 } from "lucide-react";

export default function Index() {
  const { user, loading: authLoading } = useAuth();
  const recorder = useRecorder();
  const createMeeting = useCreateMeeting();

  const handleStartRecording = async () => {
    await recorder.startRecording();
  };

  const durationAtStop = useRef(0);

  // Override stop to also save meeting
  const handleStopRecording = () => {
    durationAtStop.current = recorder.recordingTime;
    recorder.stopRecording();
  };

  // When upload completes, create meeting entry with recording info
  useEffect(() => {
    if (recorder.lastRecording && !recorder.isUploading) {
      const duration = durationAtStop.current;
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      const durationStr = `${mins}:${secs.toString().padStart(2, "0")}`;
      const now = new Date();
      const title = `Meeting ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      createMeeting.mutate({
        title,
        duration: durationStr,
        recording_filename: recorder.lastRecording.filename,
        recording_size_bytes: recorder.lastRecording.blob.size,
      });
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
          <Route path="settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <RecordingHUD
        isRecording={recorder.isRecording}
        isPaused={recorder.isPaused}
        time={recorder.recordingTime}
        onStop={handleStopRecording}
        onPause={recorder.pauseRecording}
        onResume={recorder.resumeRecording}
      />
    </div>
  );
}
