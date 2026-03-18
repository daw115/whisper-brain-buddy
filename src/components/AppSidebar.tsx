import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Search,
  MessageSquare,
  ListChecks,
  Upload,
  Settings,
  Brain,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Search, label: "Search", path: "/search" },
  { icon: MessageSquare, label: "Ask AI", path: "/chat" },
  { icon: ListChecks, label: "Action Items", path: "/actions" },
  { icon: Upload, label: "Batch Upload", path: "/upload" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

interface AppSidebarProps {
  isRecording: boolean;
  recordingTime: number;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function AppSidebar({ isRecording, recordingTime }: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, pinUserName, signOut } = useAuth();

  return (
    <aside className="w-[280px] min-h-screen border-r border-border bg-sidebar flex flex-col">
      <div className="h-16 flex items-center gap-3 px-6 border-b border-border">
        <Brain className="w-6 h-6 text-primary" />
        <span className="text-lg font-semibold tracking-tight text-sidebar-accent-foreground">
          Cerebro
        </span>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors duration-150 press-effect ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {isRecording && (
        <div className="mx-3 mb-4 border border-recording/30 bg-recording/5 rounded-md p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-recording recording-pulse" />
            <span className="text-xs font-medium text-recording uppercase tracking-wider">
              Recording
            </span>
          </div>
          <span className="font-mono-data text-sm text-foreground">
            {formatTime(recordingTime)}
          </span>
        </div>
      )}

      <div className="px-6 py-4 border-t border-border">
        {user && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground font-mono-data truncate max-w-[180px]">
              {pinUserName || user.user_metadata?.display_name || "User"}
            </span>
            <button onClick={() => void signOut()} className="text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground/60 font-mono-data">
          CEREBRO v0.1.0 · Local · Private
        </p>
      </div>
    </aside>
  );
}
