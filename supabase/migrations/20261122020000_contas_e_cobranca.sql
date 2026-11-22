-- Cadastro com aprovação, termos, cobrança e escolha da conta do Instagram.
-- Mesmo princípio da migração inicial: só a API (chave de serviço) lê e grava.

alter table organizacoes add column conta_padrao_id uuid references conexoes(id) on delete set null;

create table contas (
  id uuid primary key,                       -- o id do usuário no Supabase Auth
  email text not null,
  nome text,
  status text not null check (status in ('pendente','liberado','bloqueado')),
  ate timestamptz,                           -- prazo de acesso (fim do dia)
  motivo text, nota text,
  aviso text, aviso_em timestamptz, aviso_visto timestamptz,
  entrou_auto boolean not null default false, decidido_em timestamptz,
  criado_em timestamptz not null default now(), ultimo_acesso timestamptz, acessos int not null default 0,
  termos_versao text, termos_em timestamptz,
  plano text, pago_ate timestamptz, vitalicio boolean not null default false,
  cortesia boolean not null default false, cortesia_ate timestamptz, cortesia_motivo text,
  senha_link_em timestamptz
);
create index on contas (email);

create table config_plataforma (
  id text primary key,
  auto boolean not null default false,
  cobranca boolean not null default false, cobranca_desde timestamptz,
  teste_dias int, planos jsonb,
  pix_chave text, pix_nome text, pix_cidade text,
  atualizado_em timestamptz
);

create table pagamentos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null,                    -- sem FK: o livro-caixa fica mesmo se a conta sair da lista
  email text, nome text, plano text not null, valor numeric(10,2) not null, dias int not null,
  txid text not null, status text not null check (status in ('informado','confirmado','recusado','devolvido')),
  condicoes text, motivo text, registrado_pelo_dono boolean not null default false,
  criado_em timestamptz not null default now(), decidido_em timestamptz
);
create index on pagamentos (conta_id, criado_em desc);
create index on pagamentos (status);

-- Histórico de aceites dos termos: só inclusão (nem o dono altera pelo app).
create table aceites (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null, email text, nome text, versao text not null, hash text not null,
  de text, navegador text, em timestamptz not null default now()
);
create index on aceites (conta_id, em desc);
create or replace function aceites_imutaveis() returns trigger language plpgsql as $$
begin raise exception 'aceites não podem ser alterados nem apagados'; end $$;
create trigger aceites_sem_mudanca before update or delete on aceites for each row execute function aceites_imutaveis();

alter table contas enable row level security;
alter table config_plataforma enable row level security;
alter table pagamentos enable row level security;
alter table aceites enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on contas, config_plataforma, pagamentos, aceites from anon, authenticated;
  end if;
end $$;
