-- Migration: 003_create_portfolio_table
-- User holdings; FK to public.users (not auth.users) for consistent RLS and joins.

CREATE TABLE IF NOT EXISTS public.portfolio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  stock_symbol TEXT NOT NULL,
  quantity NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  average_buy_price NUMERIC(20, 4),
  total_investment NUMERIC(24, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_symbol_uppercase CHECK (stock_symbol = upper(stock_symbol)),
  CONSTRAINT portfolio_user_symbol_unique UNIQUE (user_id, stock_symbol)
);

COMMENT ON TABLE public.portfolio IS 'Per-user positions for dashboard; extend with lot/txn tables later.';

-- Existing REST API: watchlist (no separate migration file per project constraint).
CREATE TABLE IF NOT EXISTS public.user_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_watchlist_symbol_uppercase CHECK (symbol = upper(symbol)),
  CONSTRAINT user_watchlist_user_symbol_unique UNIQUE (user_id, symbol)
);

COMMENT ON TABLE public.user_watchlist IS 'Pinned symbols per user; used by GET/POST /user/watchlist.';

-- Existing REST API: alerts.
CREATE TABLE IF NOT EXISTS public.stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  threshold_type TEXT NOT NULL DEFAULT 'price_above',
  threshold_value NUMERIC(20, 4) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_alerts_symbol_uppercase CHECK (symbol = upper(symbol))
);

CREATE INDEX IF NOT EXISTS stock_alerts_user_id_idx ON public.stock_alerts (user_id);

COMMENT ON TABLE public.stock_alerts IS 'User-defined price/rule alerts.';
