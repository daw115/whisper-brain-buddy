import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();

    // Support single meeting or array of meetings
    const meetings: any[] = Array.isArray(payload) ? payload : [payload];
    const results = [];

    for (const meeting of meetings) {
      // 1. Insert meeting
      const { data: meetingData, error: meetingError } = await supabase
        .from("meetings")
        .insert({
          user_id: user.id,
          title: meeting.title || "Untitled Meeting",
          date: meeting.date || new Date().toISOString().split("T")[0],
          duration: meeting.duration || null,
          status: meeting.status || "processed",
          tags: meeting.tags || [],
          summary: meeting.summary || null,
          recording_filename: meeting.recording_filename || null,
          recording_size_bytes: meeting.recording_size_bytes || null,
        })
        .select()
        .single();

      if (meetingError) {
        results.push({ title: meeting.title, error: meetingError.message });
        continue;
      }

      const meetingId = meetingData.id;

      // 2. Insert participants
      if (meeting.participants?.length) {
        const { error } = await supabase
          .from("meeting_participants")
          .insert(meeting.participants.map((name: string) => ({ meeting_id: meetingId, name })));
        if (error) console.error("participants error:", error);
      }

      // 3. Insert transcript lines
      if (meeting.transcript?.length) {
        const lines = meeting.transcript.map((line: any, i: number) => ({
          meeting_id: meetingId,
          timestamp: line.timestamp || "00:00",
          speaker: line.speaker || "unknown",
          text: line.text,
          line_order: line.line_order ?? i,
        }));
        const { error } = await supabase.from("transcript_lines").insert(lines);
        if (error) console.error("transcript error:", error);
      }

      // 4. Insert action items
      if (meeting.action_items?.length) {
        const items = meeting.action_items.map((item: any) => ({
          meeting_id: meetingId,
          user_id: user.id,
          task: item.task,
          owner: item.owner || "Unassigned",
          deadline: item.deadline || null,
          completed: item.completed || false,
        }));
        const { error } = await supabase.from("action_items").insert(items);
        if (error) console.error("action_items error:", error);
      }

      // 5. Insert decisions
      if (meeting.decisions?.length) {
        const decs = meeting.decisions.map((d: any) => ({
          meeting_id: meetingId,
          decision: d.decision,
          rationale: d.rationale || null,
          timestamp: d.timestamp || null,
        }));
        const { error } = await supabase.from("decisions").insert(decs);
        if (error) console.error("decisions error:", error);
      }

      results.push({ title: meeting.title, id: meetingId, status: "ok" });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("batch-upload error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
