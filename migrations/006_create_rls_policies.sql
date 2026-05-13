-- Migration: 006_create_rls_policies
-- Backend uses service role (bypasses RLS). Policies protect direct browser/anon PostgREST access.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_alerts ENABLE ROW LEVEL SECURITY;

-- Users: own row only
CREATE POLICY users_select_own ON public.users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Stocks: public read (realtime dashboards, market cards)
CREATE POLICY stocks_select_public ON public.stocks FOR SELECT TO anon, authenticated USING (true);

-- Portfolio: owner only
CREATE POLICY portfolio_select_own ON public.portfolio FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY portfolio_insert_own ON public.portfolio FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY portfolio_update_own ON public.portfolio FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY portfolio_delete_own ON public.portfolio FOR DELETE TO authenticated USING (user_id = auth.uid());

-- AI analysis: public read (dashboards / widgets)
CREATE POLICY ai_analysis_select_public ON public.ai_analysis FOR SELECT TO anon, authenticated USING (true);

-- Watchlist: owner
CREATE POLICY user_watchlist_select_own ON public.user_watchlist FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_watchlist_insert_own ON public.user_watchlist FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_watchlist_delete_own ON public.user_watchlist FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Alerts: owner
CREATE POLICY stock_alerts_select_own ON public.stock_alerts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY stock_alerts_insert_own ON public.stock_alerts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY stock_alerts_delete_own ON public.stock_alerts FOR DELETE TO authenticated USING (user_id = auth.uid());
