-- Meetings table
CREATE TABLE public.meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  duration TEXT,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'processing', 'processed')),
  tags TEXT[] DEFAULT '{}',
  summary TEXT,
  recording_filename TEXT,
  recording_size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transcript lines
CREATE TABLE public.transcript_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  speaker TEXT NOT NULL DEFAULT 'unknown',
  text TEXT NOT NULL,
  line_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Action items
CREATE TABLE public.action_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  owner TEXT NOT NULL,
  deadline TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Decisions
CREATE TABLE public.decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  rationale TEXT,
  timestamp TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Participants
CREATE TABLE public.meeting_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(meeting_id, name)
);

-- Enable RLS
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

-- Meetings policies
CREATE POLICY "Users can view own meetings" ON public.meetings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own meetings" ON public.meetings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meetings" ON public.meetings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own meetings" ON public.meetings FOR DELETE USING (auth.uid() = user_id);

-- Transcript policies
CREATE POLICY "Users can view own transcripts" ON public.transcript_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.meetings WHERE meetings.id = transcript_lines.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can insert own transcripts" ON public.transcript_lines FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings WHERE meetings.id = transcript_lines.meeting_id AND meetings.user_id = auth.uid()));

-- Action items policies
CREATE POLICY "Users can view own action items" ON public.action_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own action items" ON public.action_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own action items" ON public.action_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own action items" ON public.action_items FOR DELETE USING (auth.uid() = user_id);

-- Decisions policies
CREATE POLICY "Users can view own decisions" ON public.decisions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.meetings WHERE meetings.id = decisions.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can insert own decisions" ON public.decisions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings WHERE meetings.id = decisions.meeting_id AND meetings.user_id = auth.uid()));

-- Participants policies
CREATE POLICY "Users can view own participants" ON public.meeting_participants FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.meetings WHERE meetings.id = meeting_participants.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can insert own participants" ON public.meeting_participants FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings WHERE meetings.id = meeting_participants.meeting_id AND meetings.user_id = auth.uid()));

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_meetings_updated_at BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_action_items_updated_at BEFORE UPDATE ON public.action_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_meetings_user_id ON public.meetings(user_id);
CREATE INDEX idx_meetings_date ON public.meetings(date DESC);
CREATE INDEX idx_action_items_meeting_id ON public.action_items(meeting_id);
CREATE INDEX idx_transcript_lines_meeting_id ON public.transcript_lines(meeting_id);
CREATE INDEX idx_decisions_meeting_id ON public.decisions(meeting_id);