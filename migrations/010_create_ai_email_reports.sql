-- Migration: 010_create_ai_email_reports
-- Persisted audit trail of every AI digest email request sent via POST /api/reports/ai-email.
-- Stores the form submission (name + email), the user that requested the send, the email
-- HTML snapshot, and the delivery status. Useful for analytics, retries, and abuse detection.

CREATE TABLE IF NOT EXISTS public.ai_email_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  symbol_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  delivery_error TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT ai_email_reports_email_lowercase CHECK (recipient_email = lower(recipient_email)),
  CONSTRAINT ai_email_reports_status_check CHECK (status IN ('queued', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS ai_email_reports_user_id_idx ON public.ai_email_reports (user_id);
CREATE INDEX IF NOT EXISTS ai_email_reports_recipient_idx ON public.ai_email_reports (recipient_email);
CREATE INDEX IF NOT EXISTS ai_email_reports_created_at_idx ON public.ai_email_reports (created_at DESC);

COMMENT ON TABLE public.ai_email_reports IS
  'Outbox + audit log for AI digest emails: one row per POST /api/reports/ai-email submission.';

-- RLS: service role bypasses; authenticated users can view their own send history.
ALTER TABLE public.ai_email_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_email_reports_select_own ON public.ai_email_reports;
CREATE POLICY ai_email_reports_select_own
  ON public.ai_email_reports
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Tell PostgREST to reload its schema cache immediately so the new table is visible to the
-- REST API without restarting the project. Avoids the "Could not find the table
-- 'public.ai_email_reports' in the schema cache" error you'd otherwise see for ~10s.
NOTIFY pgrst, 'reload schema';
