ALTER TABLE public.meeting_analyses DROP CONSTRAINT meeting_analyses_source_check;

ALTER TABLE public.meeting_analyses ADD CONSTRAINT meeting_analyses_source_check CHECK (source = ANY (ARRAY['gemini','chatgpt','claude','merged','unique-frames','captions-ocr','slide-transcript','crop-split','slide-descriptions','pdf-slides']));