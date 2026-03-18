import { useState, useEffect, createContext, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  pinUserName: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  pinUserName: null,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const clearPinSession = () => {
  localStorage.removeItem("cerebro_pin");
  localStorage.removeItem("cerebro_user_name");
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinUserName, setPinUserName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const syncSession = async (sessionUser: User | null) => {
      if (!active) return;

      if (!sessionUser) {
        setUser(null);
        setPinUserName(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data, error } = await supabase
        .from("pin_users")
        .select("name")
        .eq("auth_user_id", sessionUser.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.error("PIN user lookup failed:", error);
        setUser(null);
        setPinUserName(null);
        clearPinSession();
        await supabase.auth.signOut();
        if (active) setLoading(false);
        return;
      }

      if (!data) {
        setUser(null);
        setPinUserName(null);
        clearPinSession();
        await supabase.auth.signOut();
        if (active) setLoading(false);
        return;
      }

      localStorage.setItem("cerebro_user_name", data.name);
      setUser(sessionUser);
      setPinUserName(data.name);
      setLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSession(session?.user ?? null);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void syncSession(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    clearPinSession();
    setUser(null);
    setPinUserName(null);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, pinUserName, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
