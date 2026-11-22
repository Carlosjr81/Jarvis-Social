-- Chaves de integração (ChatGPT, Claude, outros clientes da API).
-- Guarda só o SHA-256 do segredo; o segredo aparece uma vez, na criação.
create table tokens_api (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizacoes(id) on delete cascade,
  usuario_id uuid not null,
  nome text not null,
  prefixo text not null,
  hash text not null unique,
  escopos text[] not null default array['leitura'],
  criado_em timestamptz not null default now(),
  expira_em timestamptz,
  ultimo_uso timestamptz,
  revogado boolean not null default false,
  revogado_em timestamptz
);
create index on tokens_api (org_id);
alter table tokens_api enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on tokens_api from anon, authenticated; end if;
end $$;

-- Mídia importada por link (ChatGPT/Claude programando como no Metricool).
alter table midias add column origem_url text;

-- Menos passos na instalação: dono automático (primeira conta confirmada) e
-- app da Meta configurado pelo painel (segredo cifrado). Piloto automático.
alter table config_plataforma add column dono_email text, add column dono_desde timestamptz,
  add column meta_app_id text, add column meta_app_secret_cifrado text;
alter table organizacoes add column piloto_automatico boolean not null default false;
