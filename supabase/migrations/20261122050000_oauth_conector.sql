-- Conector do ChatGPT/Claude por OAuth (como o do Metricool): o assistente
-- se registra sozinho, a pessoa toca em Permitir no painel e o assistente
-- recebe um token. O token de acesso é uma linha de tokens_api (mesmas
-- regras da chave manual); o refresh troca o segredo da mesma linha.
create table oauth_clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  redirect_uris text[] not null,
  criado_em timestamptz not null default now()
);

create table oauth_pedidos (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  cliente_nome text not null,
  redirect_uri text not null,
  code_challenge text not null,
  escopos text[] not null,
  state text,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usuario_id uuid,
  org_id uuid references organizacoes(id) on delete cascade,
  codigo_hash text unique,
  usado boolean not null default false
);
create index on oauth_pedidos (criado_em);

alter table tokens_api
  add column refresh_hash text unique,
  add column refresh_expira_em timestamptz,
  add column oauth_client_id text,
  add column oauth_pedido_id uuid;

alter table oauth_clientes enable row level security;
alter table oauth_pedidos enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on oauth_clientes, oauth_pedidos from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on oauth_clientes, oauth_pedidos to service_role;
  end if;
end $$;
