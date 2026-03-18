import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user: caller } } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, name, pin_code, user_id } = await req.json();

    if (action === "create") {
      if (!name || !pin_code || pin_code.length !== 4 || !/^\d{4}$/.test(pin_code)) {
        return new Response(JSON.stringify({ error: "Name and 4-digit PIN required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check PIN uniqueness
      const { data: existing } = await supabaseAdmin
        .from("pin_users")
        .select("id")
        .eq("pin_code", pin_code)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ error: "PIN already in use" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create auth user
      const email = `pin-${crypto.randomUUID().slice(0, 8)}@cerebro.pin`;
      const password = `cerebro-pin-${pin_code}-${crypto.randomUUID().slice(0, 8)}`;

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError) {
        return new Response(JSON.stringify({ error: authError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store in pin_users with the password so we can sign in later
      const { error: insertError } = await supabaseAdmin.from("pin_users").insert({
        name,
        pin_code,
        auth_email: email,
        auth_user_id: authData.user.id,
      });

      if (insertError) {
        // Cleanup auth user on failure
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store password hash reference - we need to save the password somewhere
      // We'll use a metadata approach: store in user metadata
      await supabaseAdmin.auth.admin.updateUserById(authData.user.id, {
        user_metadata: { pin_password: password, display_name: name },
      });

      return new Response(JSON.stringify({ success: true, name, pin_code }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pinUser } = await supabaseAdmin
        .from("pin_users")
        .select("auth_user_id")
        .eq("id", user_id)
        .single();

      if (pinUser) {
        await supabaseAdmin.from("pin_users").delete().eq("id", user_id);
        await supabaseAdmin.auth.admin.deleteUser(pinUser.auth_user_id);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "login") {
      if (!pin_code || pin_code.length !== 4) {
        return new Response(JSON.stringify({ error: "4-digit PIN required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Look up user by PIN
      const { data: pinUser } = await supabaseAdmin
        .from("pin_users")
        .select("auth_email, auth_user_id, name")
        .eq("pin_code", pin_code)
        .maybeSingle();

      if (!pinUser) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get the stored password from user metadata
      const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(
        pinUser.auth_user_id
      );

      const password = authUser?.user_metadata?.pin_password;
      if (!password) {
        return new Response(JSON.stringify({ error: "User configuration error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        email: pinUser.auth_email,
        password,
        name: pinUser.name,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
