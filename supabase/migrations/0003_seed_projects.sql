-- Projects whose name differs from their repository, or that span several repositories.
-- Everything else is created on its own, named after the repository, when the GitHub App reports it.

with p as (insert into projects (name) values ('Baja.kz') returning id)
insert into repos (full_name, project_id) select 'dkicekeeper/AutoParts4x4', id from p
on conflict (full_name) do nothing;

with p as (insert into projects (name) values ('Tenra') returning id)
insert into repos (full_name, project_id)
select r, p.id from p, (values ('dkicekeeper/Tenra'), ('dkicekeeper/tenra-assets')) as t (r)
on conflict (full_name) do nothing;
