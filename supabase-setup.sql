-- Run this in the Supabase SQL editor

-- ============================================================
-- 1) Uploads table (existing) + storage bucket
-- ============================================================
create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  file_name   text not null,
  file_type   text,
  file_size   bigint,
  storage_path text not null,
  storage_url  text not null,
  uploaded_at  timestamptz not null default now()
);

alter table public.uploads enable row level security;

drop policy if exists "uploads_read"   on public.uploads;
drop policy if exists "uploads_insert" on public.uploads;
drop policy if exists "uploads_delete" on public.uploads;

create policy "uploads_read"   on public.uploads for select using (true);
create policy "uploads_insert" on public.uploads for insert with check (true);
create policy "uploads_delete" on public.uploads for delete using (true);

insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do update set public = true;

drop policy if exists "documents_read"   on storage.objects;
drop policy if exists "documents_insert" on storage.objects;
drop policy if exists "documents_delete" on storage.objects;

create policy "documents_read"
  on storage.objects for select using (bucket_id = 'documents');
create policy "documents_insert"
  on storage.objects for insert with check (bucket_id = 'documents');
create policy "documents_delete"
  on storage.objects for delete using (bucket_id = 'documents');

-- ============================================================
-- 2) NEW: app_state table for real-time cross-device sync
--    Stores the JSON for dt_users / dt_docs / dt_logs / dt_notifs
-- ============================================================
create table if not exists public.app_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "app_state_read"   on public.app_state;
drop policy if exists "app_state_write"  on public.app_state;
drop policy if exists "app_state_update" on public.app_state;
drop policy if exists "app_state_delete" on public.app_state;

-- Demo policies (open). Tighten for production.
create policy "app_state_read"   on public.app_state for select using (true);
create policy "app_state_write"  on public.app_state for insert with check (true);
create policy "app_state_update" on public.app_state for update using (true) with check (true);
create policy "app_state_delete" on public.app_state for delete using (true);

-- ============================================================
-- 3) Realtime
-- ============================================================
alter publication supabase_realtime add table public.uploads;
alter publication supabase_realtime add table public.app_state;
