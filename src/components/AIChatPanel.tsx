import { useState, useRef, useEffect } from "react";
import { Send, Brain, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

async function streamChat({
  messages,
  meetingId,
  onDelta,
  onDone,
  onError,
}: {
  messages: Message[];
  meetingId?: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ messages, meetingId }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 429) {
      onError("Rate limit exceeded — please wait a moment and try again.");
    } else if (resp.status === 402) {
      onError("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
    } else {
      onError(data.error || "Failed to get AI response.");
    }
    return;
  }

  if (!resp.body) { onError("No response stream"); return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;

  while (!done) {
    const { done: rd, value } = await reader.read();
    if (rd) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || !line.trim()) continue;
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buf = line + "\n" + buf;
        break;
      }
    }
  }

  // flush remainder
  if (buf.trim()) {
    for (let raw of buf.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (!raw.startsWith("data: ")) continue;
      const json = raw.slice(6).trim();
      if (json === "[DONE]") continue;
      try {
        const p = JSON.parse(json);
        const c = p.choices?.[0]?.delta?.content;
        if (c) onDelta(c);
      } catch {}
    }
  }
  onDone();
}

interface AIChatPanelProps {
  meetingId?: string;
  meetingTitle?: string;
}

export default function AIChatPanel({ meetingId, meetingTitle }: AIChatPanelProps = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);
    setError(null);

    let soFar = "";
    const upsert = (chunk: string) => {
      soFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: soFar } : m));
        }
        return [...prev, { role: "assistant", content: soFar }];
      });
    };

    try {
      await streamChat({
        messages: updated,
        meetingId,
        onDelta: upsert,
        onDone: () => setLoading(false),
        onError: (msg) => { setError(msg); setLoading(false); },
      });
    } catch (e) {
      console.error(e);
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Brain className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              {meetingTitle ? `Ask about "${meetingTitle}"` : "Ask a question about your meetings."}
            </p>
            <div className="flex flex-wrap gap-2 mt-4 max-w-md justify-center">
              {(meetingId
                ? [
                    "Summarize this meeting",
                    "What were the key decisions?",
                    "List all action items",
                  ]
                : [
                    "What decisions were made about transformer parameters?",
                    "Summarize all meetings from last week",
                    "List tasks assigned to Dawid",
                  ]
              ).map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs border border-border rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded border border-primary/30 bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                <Brain className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-primary/10 border border-primary/20 text-foreground"
                  : "bg-card border border-border text-foreground"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:text-foreground [&_em]:text-muted-foreground">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded border border-primary/30 bg-primary/10 flex items-center justify-center shrink-0">
              <Brain className="w-3.5 h-3.5 text-primary animate-pulse" />
            </div>
            <div className="bg-card border border-border rounded-lg px-4 py-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0.1s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-center gap-2 text-xs text-recording border border-recording/30 bg-recording/5 rounded-md px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask your meetings..."
            className="flex-1 bg-secondary border border-border rounded-md px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2.5 hover:bg-primary/90 disabled:opacity-40 transition-colors press-effect"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground/60 mt-2 font-mono-data">
          Powered by Lovable AI · Streams responses in real-time
        </p>
      </div>
    </div>
  );
}
