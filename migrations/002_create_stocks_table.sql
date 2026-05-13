-- Migration: 002_create_stocks_table
-- Canonical symbols for market cards, search, charts, gainers/losers; fed by ingest + realtime updates.

CREATE TABLE IF NOT EXISTS public.stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  company_name TEXT NOT NULL,
  price NUMERIC(20, 4) NOT NULL DEFAULT 0,
  high NUMERIC(20, 4),
  low NUMERIC(20, 4),
  volume BIGINT NOT NULL DEFAULT 0,
  market_cap NUMERIC(24, 2),
  change_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stocks_symbol_uppercase CHECK (symbol = upper(symbol)),
  CONSTRAINT stocks_symbol_unique UNIQUE (symbol)
);

COMMENT ON TABLE public.stocks IS 'Realtime-friendly quote cache; replace seed values via backend ingest.';
