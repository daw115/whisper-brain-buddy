import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Brain, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Account created! Check your email to confirm.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <Brain className="w-8 h-8 text-primary" />
          <span className="text-2xl font-semibold tracking-tight text-foreground">Cerebro</span>
        </div>

        <div className="border border-border rounded-lg bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {isSignUp ? "Create account" : "Sign in"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {isSignUp
              ? "Start indexing your meeting knowledge."
              : "Access your meeting knowledge base."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider block mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase text-muted-foreground font-mono-data tracking-wider block mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors press-effect"
            >
              {isSignUp ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
              {loading ? "Processing..." : isSignUp ? "Create Account" : "Sign In"}
            </button>
          </form>

          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full text-sm text-muted-foreground hover:text-foreground mt-4 transition-colors"
          >
            {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground/50 font-mono-data text-center mt-6">
          Local · Private · Open Source
        </p>
      </div>
    </div>
  );
}
