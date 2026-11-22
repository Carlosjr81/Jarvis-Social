// Edge Function `mcp`: o conector do Jarvis Social para o ChatGPT e o Claude.
//  - OAuth (como o Metricool): endereço https://<ref>.supabase.co/functions/v1/mcp
//  - Sem autenticação: https://<ref>.supabase.co/functions/v1/mcp/<chave js_...>
// Toda a lógica está em _compartilhado/mcp-http.js (testada no Node).
import { criarServidorMcp } from "../_compartilhado/mcp-http.js";
import { criarApiDoServidor } from "../_compartilhado/servidor.js";

const env = (k: string) => Deno.env.get(k) || "";
const api = criarApiDoServidor(env);
Deno.serve(criarServidorMcp({ api, base: `${env("SUPABASE_URL")}/functions/v1/mcp` }));
