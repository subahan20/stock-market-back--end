-- Migration: 007_create_triggers
-- updated_at maintenance + auth.users -> public.users sync

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Stocks: refresh last_updated on quote writes (application can also set explicitly)
CREATE OR REPLACE FUNCTION public.touch_stock_last_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_updated := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stocks_touch_last_updated ON public.stocks;
CREATE TRIGGER stocks_touch_last_updated
BEFORE UPDATE ON public.stocks
FOR EACH ROW
EXECUTE FUNCTION public.touch_stock_last_updated();

-- New Supabase Auth user -> public.users row
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, provider, created_at, updated_at)
  VALUES (
    NEW.id,
    lower(coalesce(NEW.email, '')),
    coalesce(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    coalesce(NEW.raw_app_meta_data->>'provider', NEW.raw_user_meta_data->>'provider', 'email'),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.users.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
    provider = coalesce(excluded.provider, public.users.provider),
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();
