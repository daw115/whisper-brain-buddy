
-- Categories table
CREATE TABLE public.categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own categories" ON public.categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own categories" ON public.categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own categories" ON public.categories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own categories" ON public.categories FOR DELETE USING (auth.uid() = user_id);

-- Add category_id to meetings
ALTER TABLE public.meetings ADD COLUMN category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL;

-- Pin users table (stores PIN-to-auth mapping)
CREATE TABLE public.pin_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  pin_code TEXT NOT NULL,
  auth_email TEXT NOT NULL,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pin_code)
);

ALTER TABLE public.pin_users ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read pin_users (needed for login lookup) - but only pin_code for matching
-- We'll use a security definer function instead of direct access
CREATE POLICY "No direct access to pin_users" ON public.pin_users FOR SELECT USING (false);
CREATE POLICY "Authenticated users can manage pin_users" ON public.pin_users FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Function to look up auth email by PIN code (security definer to bypass RLS)
CREATE OR REPLACE FUNCTION public.get_auth_email_by_pin(p_pin TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth_email FROM public.pin_users WHERE pin_code = p_pin LIMIT 1;
$$;
