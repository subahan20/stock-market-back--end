-- Migration: 001_create_users_table
-- App profile rows linked 1:1 with Supabase Auth (auth.users).
-- Extended profile fields; auth remains source of truth for credentials.

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  provider TEXT NOT NULL DEFAULT 'email',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);

COMMENT ON TABLE public.users IS 'Application user profile; synced from auth.users via trigger.';

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON public.users (lower(email));
