
-- Drop all existing restrictive policies and replace with shared access for authenticated users

-- MEETINGS
DROP POLICY IF EXISTS "Users can view own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can create own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can update own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can delete own meetings" ON public.meetings;

CREATE POLICY "Authenticated can select meetings" ON public.meetings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert meetings" ON public.meetings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update meetings" ON public.meetings FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete meetings" ON public.meetings FOR DELETE TO authenticated USING (true);

-- ACTION_ITEMS
DROP POLICY IF EXISTS "Users can view own action items" ON public.action_items;
DROP POLICY IF EXISTS "Users can create own action items" ON public.action_items;
DROP POLICY IF EXISTS "Users can update own action items" ON public.action_items;
DROP POLICY IF EXISTS "Users can delete own action items" ON public.action_items;

CREATE POLICY "Authenticated can select action_items" ON public.action_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert action_items" ON public.action_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update action_items" ON public.action_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete action_items" ON public.action_items FOR DELETE TO authenticated USING (true);

-- DECISIONS
DROP POLICY IF EXISTS "Users can view own decisions" ON public.decisions;
DROP POLICY IF EXISTS "Users can insert own decisions" ON public.decisions;

CREATE POLICY "Authenticated can select decisions" ON public.decisions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert decisions" ON public.decisions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update decisions" ON public.decisions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete decisions" ON public.decisions FOR DELETE TO authenticated USING (true);

-- TRANSCRIPT_LINES
DROP POLICY IF EXISTS "Users can view own transcripts" ON public.transcript_lines;
DROP POLICY IF EXISTS "Users can insert own transcripts" ON public.transcript_lines;
DROP POLICY IF EXISTS "Users can delete own transcripts" ON public.transcript_lines;

CREATE POLICY "Authenticated can select transcript_lines" ON public.transcript_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert transcript_lines" ON public.transcript_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update transcript_lines" ON public.transcript_lines FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete transcript_lines" ON public.transcript_lines FOR DELETE TO authenticated USING (true);

-- MEETING_PARTICIPANTS
DROP POLICY IF EXISTS "Users can view own participants" ON public.meeting_participants;
DROP POLICY IF EXISTS "Users can insert own participants" ON public.meeting_participants;

CREATE POLICY "Authenticated can select meeting_participants" ON public.meeting_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert meeting_participants" ON public.meeting_participants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update meeting_participants" ON public.meeting_participants FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete meeting_participants" ON public.meeting_participants FOR DELETE TO authenticated USING (true);

-- MEETING_ANALYSES
DROP POLICY IF EXISTS "Users can view own analyses" ON public.meeting_analyses;
DROP POLICY IF EXISTS "Users can insert own analyses" ON public.meeting_analyses;
DROP POLICY IF EXISTS "Users can delete own analyses" ON public.meeting_analyses;

CREATE POLICY "Authenticated can select meeting_analyses" ON public.meeting_analyses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert meeting_analyses" ON public.meeting_analyses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update meeting_analyses" ON public.meeting_analyses FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete meeting_analyses" ON public.meeting_analyses FOR DELETE TO authenticated USING (true);

-- CATEGORIES
DROP POLICY IF EXISTS "Users can view own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can create own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can update own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can delete own categories" ON public.categories;

CREATE POLICY "Authenticated can select categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update categories" ON public.categories FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete categories" ON public.categories FOR DELETE TO authenticated USING (true);
