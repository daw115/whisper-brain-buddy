import { useState, useEffect, useRef } from "react";
import { Brain, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function PinLoginPage() {
  const [pin, setPin] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [autoLogging, setAutoLogging] = useState(true);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-login from localStorage
  useEffect(() => {
    const savedPin = localStorage.getItem("cerebro_pin");
    if (savedPin && savedPin.length === 4) {
      handleLogin(savedPin);
    } else {
      setAutoLogging(false);
    }
  }, []);

  const handleLogin = async (pinCode: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-pin-user", {
        body: { action: "login", pin_code: pinCode },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || "Login failed");
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (signInError) throw signInError;

      // Save PIN to localStorage
      localStorage.setItem("cerebro_pin", pinCode);
      localStorage.setItem("cerebro_user_name", data.name);
    } catch (err: any) {
      toast.error(err.message || "Nieprawidłowy PIN");
      localStorage.removeItem("cerebro_pin");
      setAutoLogging(false);
      setPin(["", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleDigit = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 4 digits entered
    if (value && index === 3) {
      const fullPin = newPin.join("");
      if (fullPin.length === 4) {
        handleLogin(fullPin);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  if (autoLogging) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Brain className="w-10 h-10 text-primary mx-auto mb-4" />
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">Logowanie...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xs text-center">
        <Brain className="w-10 h-10 text-primary mx-auto mb-2" />
        <h1 className="text-2xl font-semibold text-foreground mb-1">Cerebro</h1>
        <p className="text-sm text-muted-foreground mb-8">Wprowadź PIN aby kontynuować</p>

        <div className="flex justify-center gap-3 mb-8">
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={loading}
              className="w-14 h-16 text-center text-2xl font-mono bg-secondary border border-border rounded-lg text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-50"
              autoFocus={i === 0}
            />
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Weryfikacja...</span>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/50 font-mono-data mt-12">
          Skontaktuj się z administratorem aby uzyskać PIN
        </p>
      </div>
    </div>
  );
}
