
CREATE POLICY "Users can delete own transcripts"
ON public.transcript_lines
FOR DELETE
TO public
USING (EXISTS (
  SELECT 1 FROM meetings
  WHERE meetings.id = transcript_lines.meeting_id
  AND meetings.user_id = auth.uid()
));
