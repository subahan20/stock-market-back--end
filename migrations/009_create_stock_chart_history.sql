-- Migration: 009_create_stock_chart_history
-- Per-bar time-series cache for /stocks/history reads (DB-first). One row per (symbol, range, timestamp).
-- Ingest jobs upsert these as bars are fetched from vendors; FK ensures the parent stocks row exists.

CREATE TABLE IF NOT EXISTS public.stock_chart_history (
  symbol TEXT NOT NULL,
  range_key TEXT NOT NULL,
  bar_t BIGINT NOT NULL,
  bar_v NUMERIC(20, 4) NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_chart_history_pk PRIMARY KEY (symbol, range_key, bar_t),
  CONSTRAINT stock_chart_history_symbol_uppercase CHECK (symbol = upper(symbol)),
  CONSTRAINT stock_chart_history_range_chk CHECK (range_key IN ('1D','1W','1M','1Y')),
  CONSTRAINT stock_chart_history_symbol_fk FOREIGN KEY (symbol)
    REFERENCES public.stocks (symbol) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS stock_chart_history_lookup_idx
  ON public.stock_chart_history (symbol, range_key, bar_t);

COMMENT ON TABLE public.stock_chart_history IS
  'Cached time-series bars per symbol/range; backend upserts on /stocks/history fetches, frontend reads via REST + chart:update ticks.';
