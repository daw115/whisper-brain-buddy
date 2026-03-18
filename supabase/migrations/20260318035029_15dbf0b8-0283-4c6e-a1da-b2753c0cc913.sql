
-- Fix: replace overly permissive policy with specific ones
DROP POLICY "Authenticated users can manage pin_users" ON public.pin_users;

-- Authenticated users can view all pin_users (to list users in settings)
CREATE POLICY "Authenticated can view pin_users" ON public.pin_users FOR SELECT TO authenticated USING (true);

-- Only service role (edge functions) can insert/update/delete pin_users
-- No direct client insert/update/delete policies needed
