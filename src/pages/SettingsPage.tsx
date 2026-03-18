import { useState, useEffect } from "react";
import { Plus, X, Loader2, Users, FolderOpen, LogOut, Trash2, Pencil, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface PinUser {
  id: string;
  name: string;
  pin_code: string;
  created_at: string;
}

const CATEGORY_COLORS = [
  { name: "Indigo", value: "#6366f1" },
  { name: "Emerald", value: "#10b981" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Orange", value: "#f97316" },
  { name: "Teal", value: "#14b8a6" },
];

interface Category {
  id: string;
  name: string;
  color: string;
}

export default function SettingsPage() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  // PIN Users
  const [pinUsers, setPinUsers] = useState<PinUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPin, setNewUserPin] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);

  // Categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(CATEGORY_COLORS[0].value);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [editingPinValue, setEditingPinValue] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  useEffect(() => {
    loadPinUsers();
    loadCategories();
  }, []);

  const loadPinUsers = async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase
      .from("pin_users")
      .select("id, name, pin_code, created_at")
      .order("created_at");
    if (!error) setPinUsers(data || []);
    setLoadingUsers(false);
  };

  const loadCategories = async () => {
    setLoadingCategories(true);
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, color")
      .order("name");
    if (!error) setCategories(data || []);
    setLoadingCategories(false);
  };

  const createPinUser = async () => {
    if (!newUserName.trim() || newUserPin.length !== 4 || !/^\d{4}$/.test(newUserPin)) {
      toast.error("Podaj imię i 4-cyfrowy PIN");
      return;
    }
    setCreatingUser(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-pin-user", {
        body: { action: "create", name: newUserName.trim(), pin_code: newUserPin },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success(`Użytkownik ${newUserName.trim()} utworzony`);
      setNewUserName("");
      setNewUserPin("");
      loadPinUsers();
    } catch (err: any) {
      toast.error(err.message || "Nie udało się utworzyć użytkownika");
    } finally {
      setCreatingUser(false);
    }
  };

  const changePin = async (userId: string) => {
    if (editingPinValue.length !== 4 || !/^\d{4}$/.test(editingPinValue)) {
      toast.error("PIN musi mieć 4 cyfry");
      return;
    }
    setSavingPin(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-pin-user", {
        body: { action: "change_pin", user_id: userId, pin_code: editingPinValue },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("PIN zmieniony");
      setEditingPinId(null);
      setEditingPinValue("");
      loadPinUsers();
    } catch (err: any) {
      toast.error(err.message || "Nie udało się zmienić PIN-u");
    } finally {
      setSavingPin(false);
    }
  };

  const deletePinUser = async (user: PinUser) => {
    if (!confirm(`Usunąć użytkownika ${user.name}?`)) return;
    try {
      const { data, error } = await supabase.functions.invoke("manage-pin-user", {
        body: { action: "delete", user_id: user.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Użytkownik usunięty");
      loadPinUsers();
    } catch (err: any) {
      toast.error(err.message || "Nie udało się usunąć");
    }
  };

  const createCategory = async () => {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      const { error } = await supabase
        .from("categories")
        .insert({ name: newCategoryName.trim(), color: newCategoryColor, user_id: (await supabase.auth.getUser()).data.user!.id });
      if (error) throw error;
      toast.success(`Kategoria "${newCategoryName.trim()}" dodana`);
      setNewCategoryName("");
      setNewCategoryColor(CATEGORY_COLORS[0].value);
      loadCategories();
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (err: any) {
      if (err.message?.includes("duplicate")) {
        toast.error("Kategoria o tej nazwie już istnieje");
      } else {
        toast.error(err.message || "Nie udało się dodać kategorii");
      }
    } finally {
      setCreatingCategory(false);
    }
  };

  const deleteCategory = async (cat: Category) => {
    if (!confirm(`Usunąć kategorię "${cat.name}"? Spotkania zostaną odkategoryzowane.`)) return;
    try {
      const { error } = await supabase.from("categories").delete().eq("id", cat.id);
      if (error) throw error;
      toast.success("Kategoria usunięta");
      loadCategories();
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    } catch (err: any) {
      toast.error(err.message || "Nie udało się usunąć");
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem("cerebro_pin");
    localStorage.removeItem("cerebro_user_name");
    signOut();
  };

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Ustawienia</h1>
      <p className="text-sm text-muted-foreground mb-8">Konfiguracja Cerebro.</p>

      <div className="space-y-8">
        {/* PIN Users Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Użytkownicy PIN</h2>
          </div>

          <div className="border border-border rounded-lg bg-card overflow-hidden">
            {loadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
              </div>
            ) : (
              <>
                {pinUsers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between px-5 py-3 border-b border-border last:border-b-0">
                    <div>
                      <span className="text-sm font-medium text-foreground">{user.name}</span>
                      <span className="text-xs text-muted-foreground font-mono-data ml-3">PIN: {user.pin_code}</span>
                    </div>
                    <button
                      onClick={() => deletePinUser(user)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {pinUsers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Brak użytkowników. Dodaj pierwszego użytkownika poniżej.
                  </p>
                )}
              </>
            )}

            <div className="border-t border-border bg-secondary/50 px-5 py-4">
              <div className="flex gap-2">
                <input
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Imię"
                  className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  maxLength={50}
                />
                <input
                  value={newUserPin}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                    setNewUserPin(v);
                  }}
                  placeholder="PIN (4 cyfry)"
                  inputMode="numeric"
                  className="w-32 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors font-mono-data"
                  maxLength={4}
                />
                <button
                  onClick={createPinUser}
                  disabled={creatingUser || !newUserName.trim() || newUserPin.length !== 4}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {creatingUser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Dodaj
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Categories Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Kategorie spotkań</h2>
          </div>

          <div className="border border-border rounded-lg bg-card overflow-hidden">
            {loadingCategories ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
              </div>
            ) : (
              <>
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between px-5 py-3 border-b border-border last:border-b-0">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                      <span className="text-sm font-medium text-foreground">{cat.name}</span>
                    </div>
                    <button
                      onClick={() => deleteCategory(cat)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {categories.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Brak kategorii. Dodaj pierwszą kategorię.
                  </p>
                )}
              </>
            )}

            <div className="border-t border-border bg-secondary/50 px-5 py-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createCategory()}
                  placeholder="Nazwa kategorii (np. HR, Finanse, Projekt X)"
                  className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  maxLength={100}
                />
              </div>
              <div className="flex items-center gap-1.5">
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewCategoryColor(c.value)}
                    className={`w-6 h-6 rounded-full transition-all ${newCategoryColor === c.value ? "ring-2 ring-offset-2 ring-offset-secondary scale-110" : "hover:scale-110"}`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  />
                ))}
                <button
                  onClick={createCategory}
                  disabled={creatingCategory || !newCategoryName.trim()}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {creatingCategory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Dodaj
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sign Out */}
        <div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Wyloguj się
          </button>
        </div>
      </div>
    </div>
  );
}
