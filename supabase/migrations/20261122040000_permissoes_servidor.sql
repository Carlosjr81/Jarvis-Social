-- O servidor (chave service_role) precisa ler e gravar todas as tabelas, mesmo
-- quando o projeto foi criado com "Conceder acesso à API para novas tabelas"
-- desligado. anon e authenticated continuam SEM acesso (só a API do Jarvis).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
    alter default privileges in schema public grant execute on functions to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke execute on all functions in schema public from anon, authenticated;
  end if;
end $$;
