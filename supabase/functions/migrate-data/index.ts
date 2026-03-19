import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Old Supabase project credentials (service_role key for full access)
const OLD_URL = "https://iusdsamxfdtfokfdmnfm.supabase.co";
const OLD_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1c2RzYW14ZmR0Zm9rZmRtbmZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY3MjE3MCwiZXhwIjoyMDg5MjQ4MTcwfQ.JMz0OAlBpiMOJNaDnFe3wTC-SGZ3gUCpCVN4MkgqoKs";

const NEW_USER_ID = "2afbbd4c-e252-4ebe-80dc-b62461acb311";

const TABLES_TO_MIGRATE = [
  "meetings",
  "transcript_lines",
  "meeting_analyses",
  "action_items",
  "decisions",
  "meeting_participants",
  "categories",
  "knowledge_summaries",
  "project_contexts",
  "task_patterns",
  "pin_users",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, old_email, old_password } = await req.json();

    // Create old Supabase client
    const oldSupabase = createClient(OLD_URL, OLD_SERVICE_KEY);

    // If credentials provided, sign in to old project
    let oldUserId: string | null = null;
    if (old_email && old_password) {
      const { data: authData, error: authError } = await oldSupabase.auth.signInWithPassword({
        email: old_email,
        password: old_password,
      });
      if (authError) {
        return new Response(JSON.stringify({ error: `Auth failed: ${authError.message}` }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      oldUserId = authData.user?.id ?? null;
      console.log("Signed in to old project as:", oldUserId);
    }

    // New Supabase client (service role for inserting)
    const newSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "probe") {
      // Just try to read from each table and report what's accessible
      const results: Record<string, { count: number; error: string | null; sample: any }> = {};

      for (const table of TABLES_TO_MIGRATE) {
        const { data, error, count } = await oldSupabase
          .from(table)
          .select("*", { count: "exact" })
          .limit(2);

        results[table] = {
          count: count ?? (data?.length ?? 0),
          error: error?.message ?? null,
          sample: data?.[0] ? Object.keys(data[0]) : [],
        };
      }

      return new Response(JSON.stringify({ action: "probe", results, oldUserId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "migrate") {
      const results: Record<string, { read: number; inserted: number; error: string | null }> = {};

      // Map old meeting IDs to new meeting IDs
      const meetingIdMap: Record<string, string> = {};

      // 1. Migrate categories first
      {
        const table = "categories";
        const { data, error } = await oldSupabase.from(table).select("*");
        if (error || !data) {
          results[table] = { read: 0, inserted: 0, error: error?.message ?? "no data" };
        } else {
          const mapped = data.map((row: any) => ({
            ...row,
            user_id: NEW_USER_ID,
          }));
          // Remove id to let new DB generate
          const toInsert = mapped.map(({ id, ...rest }: any) => rest);
          const { data: inserted, error: insErr } = await newSupabase.from(table).insert(toInsert).select();
          results[table] = { read: data.length, inserted: inserted?.length ?? 0, error: insErr?.message ?? null };
        }
      }

      // 2. Migrate meetings
      {
        const table = "meetings";
        const { data, error } = await oldSupabase.from(table).select("*");
        if (error || !data) {
          results[table] = { read: 0, inserted: 0, error: error?.message ?? "no data" };
        } else {
          for (const row of data) {
            const oldId = row.id;
            const { id, category_id, ...rest } = row;
            const toInsert = {
              ...rest,
              user_id: NEW_USER_ID,
              category_id: null, // skip category mapping for simplicity
            };
            const { data: inserted, error: insErr } = await newSupabase.from(table).insert(toInsert).select();
            if (inserted && inserted[0]) {
              meetingIdMap[oldId] = inserted[0].id;
            }
          }
          results[table] = { read: data.length, inserted: Object.keys(meetingIdMap).length, error: null };
        }
      }

      // 3. Migrate meeting-dependent tables
      const meetingTables = ["transcript_lines", "meeting_analyses", "action_items", "decisions", "meeting_participants"];
      for (const table of meetingTables) {
        const { data, error } = await oldSupabase.from(table).select("*");
        if (error || !data) {
          results[table] = { read: 0, inserted: 0, error: error?.message ?? "no data" };
          continue;
        }
        let insertedCount = 0;
        for (const row of data) {
          const newMeetingId = meetingIdMap[row.meeting_id];
          if (!newMeetingId) continue; // skip if meeting wasn't migrated
          const { id, ...rest } = row;
          const toInsert: any = { ...rest, meeting_id: newMeetingId };
          if ("user_id" in toInsert) toInsert.user_id = NEW_USER_ID;
          const { error: insErr } = await newSupabase.from(table).insert(toInsert);
          if (!insErr) insertedCount++;
        }
        results[table] = { read: data.length, inserted: insertedCount, error: null };
      }

      // 4. Migrate standalone user tables
      const userTables = ["knowledge_summaries", "project_contexts", "task_patterns"];
      for (const table of userTables) {
        const { data, error } = await oldSupabase.from(table).select("*");
        if (error || !data) {
          results[table] = { read: 0, inserted: 0, error: error?.message ?? "no data" };
          continue;
        }
        let insertedCount = 0;
        for (const row of data) {
          const { id, ...rest } = row;
          const toInsert: any = { ...rest, user_id: NEW_USER_ID };
          if ("meeting_id" in toInsert) {
            const newMeetingId = meetingIdMap[toInsert.meeting_id];
            if (!newMeetingId) continue;
            toInsert.meeting_id = newMeetingId;
          }
          const { error: insErr } = await newSupabase.from(table).insert(toInsert);
          if (!insErr) insertedCount++;
        }
        results[table] = { read: data.length, inserted: insertedCount, error: null };
      }

      return new Response(JSON.stringify({ action: "migrate", results, meetingIdMap }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use 'probe' or 'migrate'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Migration error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
