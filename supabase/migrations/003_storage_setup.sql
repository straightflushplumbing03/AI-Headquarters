-- Create storage bucket for organizations
insert into storage.buckets (id, name)
values ('organizations', 'organizations')
on conflict do nothing;

-- Storage policies for organizations bucket
create policy "Anyone can view organization logos"
  on storage.objects for select
  using (bucket_id = 'organizations');

create policy "Authenticated users can upload to their org bucket"
  on storage.objects for insert
  with check (
    bucket_id = 'organizations'
    and auth.role() = 'authenticated'
  );
