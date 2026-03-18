
-- knowledge_summaries
CREATE TABLE public.knowledge_summaries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  summary_text TEXT NOT NULL,
  key_topics TEXT[] NOT NULL DEFAULT '{}',
  project_context TEXT,
  sentiment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can select knowledge_summaries" ON public.knowledge_summaries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert knowledge_summaries" ON public.knowledge_summaries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update knowledge_summaries" ON public.knowledge_summaries FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete knowledge_summaries" ON public.knowledge_summaries FOR DELETE TO authenticated USING (true);

-- task_patterns
CREATE TABLE public.task_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pattern_name TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  suggested_category TEXT,
  frequency INTEGER NOT NULL DEFAULT 1,
  last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  auto_actions JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.task_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can select task_patterns" ON public.task_patterns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert task_patterns" ON public.task_patterns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update task_patterns" ON public.task_patterns FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete task_patterns" ON public.task_patterns FOR DELETE TO authenticated USING (true);

-- project_contexts
CREATE TABLE public.project_contexts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  color TEXT NOT NULL DEFAULT '#6366f1',
  meeting_count INTEGER NOT NULL DEFAULT 0,
  last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.project_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can select project_contexts" ON public.project_contexts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert project_contexts" ON public.project_contexts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update project_contexts" ON public.project_contexts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete project_contexts" ON public.project_contexts FOR DELETE TO authenticated USING (true);
