
CREATE TABLE public.meeting_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE CASCADE NOT NULL,
  source text NOT NULL CHECK (source IN ('gemini', 'chatgpt', 'merged')),
  analysis_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analyses"
  ON public.meeting_analyses FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.meetings
    WHERE meetings.id = meeting_analyses.meeting_id
      AND meetings.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own analyses"
  ON public.meeting_analyses FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.meetings
    WHERE meetings.id = meeting_analyses.meeting_id
      AND meetings.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own analyses"
  ON public.meeting_analyses FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.meetings
    WHERE meetings.id = meeting_analyses.meeting_id
      AND meetings.user_id = auth.uid()
  ));
