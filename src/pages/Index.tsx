import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";
import RecordingHUD from "@/components/RecordingHUD";
import Dashboard from "@/pages/Dashboard";
import MeetingDetail from "@/pages/MeetingDetail";
import ChatPage from "@/pages/ChatPage";
import ActionsPage from "@/pages/ActionsPage";
import SearchPage from "@/pages/SearchPage";
import SettingsPage from "@/pages/SettingsPage";

export default function Index() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      // In a real app, MediaRecorder would capture here
      stream.getTracks().forEach((track) => {
        track.onended = () => stopRecording();
      });
      setIsRecording(true);
      setRecordingTime(0);
    } catch {
      // User cancelled screen picker
    }
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setRecordingTime(0);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

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
        time={recordingTime}
        onStart={startRecording}
        onStop={stopRecording}
      />
    </div>
  );
}
