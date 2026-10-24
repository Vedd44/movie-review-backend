-- News-only state. Existing tables, grants, identities and personal records are unchanged.
create table if not exists public.reelbot_news_state (
 id integer primary key check (id = 1), snapshot jsonb not null default '{"version":1,"updatedAt":null,"items":[]}',
 previous_snapshot jsonb, lease_token uuid, lease_until timestamptz, next_refresh_at timestamptz not null default now()
);
alter table public.reelbot_news_state enable row level security;
revoke all on public.reelbot_news_state from anon, authenticated;
grant select, insert, update on public.reelbot_news_state to service_role;
insert into public.reelbot_news_state(id) values (1) on conflict do nothing;
create table if not exists public.reelbot_news_budget (
 month text primary key, reserved_microdollars bigint not null default 0 check (reserved_microdollars between 0 and 5000000)
);
alter table public.reelbot_news_budget enable row level security;
revoke all on public.reelbot_news_budget from anon, authenticated;
grant select, insert, update on public.reelbot_news_budget to service_role;
create table if not exists public.reelbot_news_reservations (
 id uuid primary key, month text not null, lease_token uuid not null, settled boolean not null default false,
 story_key text not null unique, take text, reviewed_at timestamptz
);
alter table public.reelbot_news_reservations enable row level security;
revoke all on public.reelbot_news_reservations from anon, authenticated;
grant select, insert, update on public.reelbot_news_reservations to service_role;
create or replace function public.reelbot_news_claim(p_token uuid) returns jsonb language plpgsql security invoker set search_path = public as $$
declare result jsonb;
begin
 update reelbot_news_state set lease_token=p_token, lease_until=now()+interval '25 minutes'
 where id=1 and next_refresh_at<=now() and (lease_until is null or lease_until<now()) returning snapshot into result;
 return result;
end $$;
create or replace function public.reelbot_news_reserve(p_token uuid,p_story_key text) returns jsonb language plpgsql security invoker set search_path = public as $$
declare m text := to_char(now() at time zone 'UTC','YYYY-MM'); r uuid := gen_random_uuid(); used bigint; prior record;
begin
 if not exists(select 1 from reelbot_news_state where id=1 and lease_token=p_token and lease_until>now()) then return null; end if;
 if p_story_key !~ '^[a-f0-9]{64}$' then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_story_key,0));
 select * into prior from reelbot_news_reservations where story_key=p_story_key;
 if found then return jsonb_build_object('take',prior.take,'reviewedAt',prior.reviewed_at); end if;
 insert into reelbot_news_budget(month) values(m) on conflict do nothing;
 update reelbot_news_budget set reserved_microdollars=reserved_microdollars+1200 where month=m and reserved_microdollars+1200<=5000000 returning reserved_microdollars into used;
 if used is null then return null; end if;
 insert into reelbot_news_reservations(id,month,lease_token,story_key) values(r,m,p_token,p_story_key);
 return jsonb_build_object('reservation',r);
end $$;
create or replace function public.reelbot_news_settle(p_token uuid,p_reservation uuid,p_cost integer,p_take text) returns boolean language plpgsql security invoker set search_path = public as $$
declare m text;
begin
 if p_cost<0 or p_cost>1200 then return false; end if;
 update reelbot_news_reservations set settled=true, take=case when length(p_take) between 1 and 600 then p_take else null end, reviewed_at=now() where id=p_reservation and lease_token=p_token and not settled returning month into m;
 if m is null then return false; end if;
 update reelbot_news_budget set reserved_microdollars=reserved_microdollars-(1200-p_cost) where month=m;
 return true;
end $$;
create or replace function public.reelbot_news_finish(p_token uuid,p_snapshot jsonb) returns boolean language plpgsql security invoker set search_path = public as $$
begin
 if p_snapshot is not null and (jsonb_typeof(p_snapshot->'items') <> 'array' or jsonb_array_length(p_snapshot->'items') not between 0 and 25) then return false; end if;
 if p_snapshot is not null and jsonb_array_length(p_snapshot->'items')=0 and exists(select 1 from reelbot_news_state where id=1 and jsonb_array_length(snapshot->'items')>0) then return false; end if;
 update reelbot_news_state set previous_snapshot=case when p_snapshot is null then previous_snapshot else snapshot end,
 snapshot=coalesce(p_snapshot,snapshot), lease_token=null,lease_until=null,
 next_refresh_at=to_timestamp((floor(extract(epoch from now()) / 21600)+1)*21600)
 where id=1 and lease_token=p_token and lease_until>now();
 return found;
end $$;
revoke all on function public.reelbot_news_claim(uuid), public.reelbot_news_reserve(uuid,text), public.reelbot_news_settle(uuid,uuid,integer,text), public.reelbot_news_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reelbot_news_claim(uuid), public.reelbot_news_reserve(uuid,text), public.reelbot_news_settle(uuid,uuid,integer,text), public.reelbot_news_finish(uuid,jsonb) to service_role;
