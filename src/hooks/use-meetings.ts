import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type DbMeeting = {
  id: string;
  user_id: string;
  title: string;
  date: string;
  duration: string | null;
  status: string;
  tags: string[] | null;
  summary: string | null;
  recording_filename: string | null;
  recording_size_bytes: number | null;
  created_at: string;
  category_id: string | null;
};

export type DbActionItem = {
  id: string;
  meeting_id: string;
  user_id: string;
  task: string;
  owner: string;
  deadline: string | null;
  completed: boolean;
};

export type DbDecision = {
  id: string;
  meeting_id: string;
  decision: string;
  rationale: string | null;
  timestamp: string | null;
};

export type DbTranscriptLine = {
  id: string;
  meeting_id: string;
  timestamp: string;
  speaker: string;
  text: string;
  line_order: number;
};

export type DbParticipant = {
  id: string;
  meeting_id: string;
  name: string;
};

export type DbCategory = {
  id: string;
  name: string;
  color: string;
};

// Full meeting with relations
export type MeetingWithRelations = DbMeeting & {
  action_items: DbActionItem[];
  decisions: DbDecision[];
  transcript_lines?: DbTranscriptLine[];
  meeting_participants: DbParticipant[];
  categories?: DbCategory | null;
};

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*, meeting_participants(*), action_items(*), decisions(*), categories:category_id(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as MeetingWithRelations[];
    },
  });
}

export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: ["meeting", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*, meeting_participants(*), action_items(*), decisions(*), transcript_lines(*), categories:category_id(*)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      // Sort transcript lines
      if (data.transcript_lines) {
        data.transcript_lines.sort((a: DbTranscriptLine, b: DbTranscriptLine) => a.line_order - b.line_order);
      }
      return data as MeetingWithRelations;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, color")
        .order("name");
      if (error) throw error;
      return data as DbCategory[];
    },
  });
}

export function useAllActionItems() {
  return useQuery({
    queryKey: ["all-action-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("action_items")
        .select("*, meetings:meeting_id(title)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (meeting: {
      title: string;
      duration?: string;
      recording_filename?: string;
      recording_size_bytes?: number;
      participants?: string[];
      tags?: string[];
      summary?: string;
      category_id?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("meetings")
        .insert({
          user_id: user.id,
          title: meeting.title,
          duration: meeting.duration,
          recording_filename: meeting.recording_filename,
          recording_size_bytes: meeting.recording_size_bytes,
          tags: meeting.tags?.length ? meeting.tags : [],
          summary: meeting.summary,
          category_id: meeting.category_id || null,
        })
        .select()
        .single();
      if (error) throw error;

      // Insert participants
      if (meeting.participants?.length) {
        const { error: pErr } = await supabase
          .from("meeting_participants")
          .insert(meeting.participants.map((name) => ({ meeting_id: data.id, name })));
        if (pErr) console.error("Failed to insert participants:", pErr);
      }

      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useUpdateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; title?: string; date?: string; category_id?: string | null }) => {
      const { error } = await supabase
        .from("meetings")
        .update(fields)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["meeting", vars.id] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("meetings")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useToggleActionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase
        .from("action_items")
        .update({ completed })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meeting"] });
      qc.invalidateQueries({ queryKey: ["all-action-items"] });
    },
  });
}
