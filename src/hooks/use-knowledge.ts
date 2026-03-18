import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type KnowledgeSummary = {
  id: string;
  meeting_id: string;
  user_id: string;
  summary_text: string;
  key_topics: string[];
  project_context: string | null;
  sentiment: string | null;
  created_at: string;
};

export type TaskPattern = {
  id: string;
  user_id: string;
  pattern_name: string;
  keywords: string[];
  suggested_category: string | null;
  frequency: number;
  last_seen: string;
  auto_actions: any;
  created_at: string;
};

export type ProjectContext = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  keywords: string[];
  color: string;
  meeting_count: number;
  last_activity: string;
  created_at: string;
};

export function useKnowledgeSummaries() {
  return useQuery({
    queryKey: ["knowledge-summaries"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("knowledge_summaries")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as KnowledgeSummary[];
    },
  });
}

export function useTaskPatterns() {
  return useQuery({
    queryKey: ["task-patterns"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_patterns")
        .select("*")
        .order("frequency", { ascending: false });
      if (error) throw error;
      return data as TaskPattern[];
    },
  });
}

export function useProjectContexts() {
  return useQuery({
    queryKey: ["project-contexts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("project_contexts")
        .select("*")
        .order("last_activity", { ascending: false });
      if (error) throw error;
      return data as ProjectContext[];
    },
  });
}

export function useBuildKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (meetingId: string) => {
      const { data, error } = await supabase.functions.invoke("build-knowledge", {
        body: { meetingId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-summaries"] });
      qc.invalidateQueries({ queryKey: ["task-patterns"] });
      qc.invalidateQueries({ queryKey: ["project-contexts"] });
    },
  });
}

export function useUpdateTaskPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; pattern_name?: string; keywords?: string[]; suggested_category?: string | null }) => {
      const { error } = await (supabase as any)
        .from("task_patterns")
        .update(fields)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-patterns"] }),
  });
}

export function useUpdateProjectContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; name?: string; description?: string; color?: string; keywords?: string[] }) => {
      const { error } = await (supabase as any)
        .from("project_contexts")
        .update(fields)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-contexts"] }),
  });
}
