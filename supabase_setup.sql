-- Math Teacher Website: Supabase setup
-- Run this whole file in Supabase Dashboard > SQL Editor.
-- Create the first admin user in Authentication > Users before inserting their UUID below.

create extension if not exists pgcrypto;

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.site_admins enable row level security;

drop policy if exists "Admins can read own admin record" on public.site_admins;
create policy "Admins can read own admin record" on public.site_admins
for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.site_admins
    where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to authenticated;

create table if not exists public.site_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 220),
  kind text not null check (kind in ('file','note','link')),
  url text not null,
  storage_path text,
  created_at timestamptz not null default now()
);
alter table public.site_resources enable row level security;

create table if not exists public.site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;

-- Public visitors may read published resource metadata.
drop policy if exists "Public can read resources" on public.site_resources;
create policy "Public can read resources" on public.site_resources
for select to anon, authenticated using (true);

-- Only an authenticated user explicitly added to site_admins can mutate resources.
drop policy if exists "Admins can insert resources" on public.site_resources;
create policy "Admins can insert resources" on public.site_resources
for insert to authenticated with check (public.is_site_admin());

drop policy if exists "Admins can update resources" on public.site_resources;
create policy "Admins can update resources" on public.site_resources
for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

drop policy if exists "Admins can delete resources" on public.site_resources;
create policy "Admins can delete resources" on public.site_resources
for delete to authenticated using (public.is_site_admin());

-- Settings: public can read only the WhatsApp value; admins can change settings.
drop policy if exists "Public can read settings" on public.site_settings;
create policy "Public can read settings" on public.site_settings
for select to anon, authenticated using (key = 'whatsapp');

drop policy if exists "Admins can insert settings" on public.site_settings;
create policy "Admins can insert settings" on public.site_settings
for insert to authenticated with check (public.is_site_admin());

drop policy if exists "Admins can update settings" on public.site_settings;
create policy "Admins can update settings" on public.site_settings
for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- Storage bucket for teaching materials. Public read means students can download files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teaching-files',
  'teaching-files',
  true,
  20971520,
  array[
    'application/pdf','image/png','image/jpeg','image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can download teaching files" on storage.objects;
create policy "Public can download teaching files" on storage.objects
for select to anon, authenticated using (bucket_id = 'teaching-files');

drop policy if exists "Admins can upload teaching files" on storage.objects;
create policy "Admins can upload teaching files" on storage.objects
for insert to authenticated with check (bucket_id = 'teaching-files' and public.is_site_admin());

drop policy if exists "Admins can update teaching files" on storage.objects;
create policy "Admins can update teaching files" on storage.objects
for update to authenticated using (bucket_id = 'teaching-files' and public.is_site_admin())
with check (bucket_id = 'teaching-files' and public.is_site_admin());

drop policy if exists "Admins can delete teaching files" on storage.objects;
create policy "Admins can delete teaching files" on storage.objects
for delete to authenticated using (bucket_id = 'teaching-files' and public.is_site_admin());

-- Bootstrap instructions:
-- 1) Create the first user in Authentication > Users > Add user.
-- 2) Copy that user's UUID.
-- 3) Run this SQL separately after replacing YOUR_ADMIN_USER_UUID:
-- insert into public.site_admins (user_id) values ('YOUR_ADMIN_USER_UUID');
-- 4) Optionally seed the WhatsApp number:
-- insert into public.site_settings(key, value) values ('whatsapp', '201xxxxxxxxx')
-- on conflict (key) do update set value = excluded.value, updated_at = now();
