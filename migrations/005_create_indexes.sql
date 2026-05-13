-- Migration: 005_create_indexes
-- Read paths: market by symbol, portfolio by user, AI by symbol/time, stocks freshness.

CREATE INDEX IF NOT EXISTS stocks_symbol_idx ON public.stocks (symbol);
CREATE INDEX IF NOT EXISTS stocks_last_updated_idx ON public.stocks (last_updated DESC);

CREATE INDEX IF NOT EXISTS portfolio_user_id_idx ON public.portfolio (user_id);
CREATE INDEX IF NOT EXISTS portfolio_created_at_idx ON public.portfolio (created_at DESC);
CREATE INDEX IF NOT EXISTS portfolio_stock_symbol_idx ON public.portfolio (stock_symbol);

CREATE INDEX IF NOT EXISTS ai_analysis_symbol_idx ON public.ai_analysis (symbol);
CREATE INDEX IF NOT EXISTS ai_analysis_created_at_idx ON public.ai_analysis (created_at DESC);

CREATE INDEX IF NOT EXISTS users_created_at_idx ON public.users (created_at DESC);

CREATE INDEX IF NOT EXISTS user_watchlist_user_id_idx ON public.user_watchlist (user_id);
CREATE INDEX IF NOT EXISTS user_watchlist_created_at_idx ON public.user_watchlist (created_at DESC);
