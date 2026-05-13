-- Migration: 004_create_ai_analysis_table
-- Persisted AI outputs; symbol aligns with public.stocks.symbol.

CREATE TABLE IF NOT EXISTS public.ai_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  confidence_score NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (
    confidence_score >= 0
    AND confidence_score <= 100
  ),
  support_level NUMERIC(20, 4),
  resistance_level NUMERIC(20, 4),
  trend TEXT,
  analysis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_analysis_symbol_uppercase CHECK (symbol = upper(symbol)),
  CONSTRAINT ai_analysis_symbol_fk FOREIGN KEY (symbol) REFERENCES public.stocks (symbol) ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE public.ai_analysis IS 'Model outputs (buy/sell/hold, levels, narrative) for API + dashboards.';
