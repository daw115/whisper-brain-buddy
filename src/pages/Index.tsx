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

export default function Index() {
  const {
    isRecording,
    isPaused,
    recordingTime,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  } = useRecorder();

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar isRecording={isRecording} recordingTime={recordingTime} />
      <main className="flex-1 min-h-screen overflow-y-auto">
        <Routes>
          <Route index element={<Dashboard onStartRecording={startRecording} />} />
          <Route path="meeting/:id" element={<MeetingDetail />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="actions" element={<ActionsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <RecordingHUD
        isRecording={isRecording}
        isPaused={isPaused}
        time={recordingTime}
        onStop={stopRecording}
        onPause={pauseRecording}
        onResume={resumeRecording}
      />
    </div>
  );
}
