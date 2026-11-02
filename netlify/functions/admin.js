import { createClient } from "@supabase/supabase-js";
import {
  db, json, erro, lerConfig, reData, reHora, dataHora, normalizarWhats, whatsValido, emailValido, limpar, diasEntre,
} from "../lib/util.js";
import { calcular } from "../lib/disponibilidade.js";
import { googleConfigurado, urlAutorizacao, desconectar, conflitosGoogle, conectado } from "../lib/google.js";
import {
  CAMPOS_PROF, carregarCompleto, salvarCliente, inserir, aposCriar, aposAlterar, aposCancelar,
} from "../lib/agendamentos.js";

const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function usuario(req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t) return null;
  const { data, error } = await db.auth.getUser(t);
  if (error || !data?.user?.email) return null;
  const { data: p } = await db.from("profissionais").select("id,nome").eq("email", data.user.email.toLowerCase()).maybeSingle();
  return p;
}

async function permitido(email) {
  const { data } = await db.from("profissionais").select("id").eq("email", String(email).toLowerCase()).maybeSingle();
  return !!data;
}

const sessao = (s) => ({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
const ok = (extra = {}) => json({ ok: true, ...extra });

const profPublica = (p) => ({
  id: p.id, nome: p.nome, slug: p.slug, email: p.email, whatsapp: p.whatsapp, instagram: p.instagram,
  bio: p.bio, foto_url: p.foto_url, ativo: p.ativo, ordem: p.ordem,
  google: { conectado: conectado(p), email: p.google_email, status: p.google_status },
});

async function verificarConflitoGoogle(prof, inicio, fim, ignorarEventId, forcar) {
  if (forcar) return null;
  try {
    const c = await conflitosGoogle(prof, inicio, fim, ignorarEventId);
    if (c.length) return erro(`A agenda Google da ${prof.nome} tem outro compromisso nesse horário: ${c.join(", ")}.`, 409, { confirmar: true });
  } catch (e) { console.error(e.message); }
  return null;
}

const ACOES = {
  // ---------- leitura geral ----------
  async painel() {
    const [cfg, prof, serv, hor, blq, dep] = await Promise.all([
      lerConfig(),
      db.from("profissionais").select("*").order("ordem"),
      db.from("servicos").select("*").order("ordem").order("nome"),
      db.from("horarios").select("*").order("dia_semana").order("inicio"),
      db.from("bloqueios").select("*").gte("fim", new Date().toISOString()).order("inicio"),
      db.from("depoimentos").select("*").order("ordem"),
    ]);
    return json({
      config: cfg,
      google_configurado: googleConfigurado(),
      profissionais: prof.data.map(profPublica),
      servicos: serv.data, horarios: hor.data, bloqueios: blq.data, depoimentos: dep.data,
    });
  },

  async agendamentos(b) {
    if (!reData.test(b.de || "") || !reData.test(b.ate || "")) return erro("Período inválido.");
    if (diasEntre(b.de, b.ate) > 120) return erro("Período muito longo.");
    let q = db.from("agendamentos")
      .select("*, cliente:clientes(id,nome,whatsapp,email), profissional:profissionais(id,nome)")
      .gte("inicio", dataHora(b.de, "00:00").toISOString())
      .lt("inicio", dataHora(b.ate, "23:59").toISOString())
      .order("inicio");
    if (b.profissional_id) q = q.eq("profissional_id", b.profissional_id);
    if (b.status) q = q.eq("status", b.status);
    const { data, error } = await q;
    if (error) throw error;
    return json({ agendamentos: data });
  },

  async clientes(b) {
    let q = db.from("clientes")
      .select("*, agendamentos(id,inicio,servico_nome,servico_preco,status,profissional:profissionais(nome))")
      .order("nome").limit(60);
    const busca = limpar(b.busca, 60).replace(/[,%()]/g, " ").trim();
    if (busca) {
      const digitos = busca.replace(/\D/g, "");
      q = digitos.length >= 4
        ? q.or(`nome.ilike.%${busca}%,whatsapp.ilike.%${digitos}%`)
        : q.ilike("nome", `%${busca}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    for (const c of data) c.agendamentos.sort((a, z) => z.inicio.localeCompare(a.inicio));
    return json({ clientes: data });
  },

  async horarios_livres(b) {
    const cfg = await lerConfig();
    const { data: serv } = await db.from("servicos").select("duracao_min").eq("id", b.servico_id).maybeSingle();
    const duracao = Number(b.duracao_min) || serv?.duracao_min;
    if (!duracao || !reData.test(b.data || "")) return erro("Escolha serviço e data.");
    const { data: prof } = await db.from("profissionais").select(CAMPOS_PROF).eq("id", b.profissional_id).maybeSingle();
    if (!prof) return erro("Profissional não encontrada.");
    const ignorar = b.ignorar_id ? await carregarCompleto(b.ignorar_id) : null;
    const mapa = await calcular({ profissionais: [prof], duracao, de: b.data, ate: b.data, cfg: { ...cfg, antecedencia_min: 0 }, ignorarAgendamento: ignorar });
    return json({ horas: mapa[prof.id]?.[b.data] || [] });
  },

  // ---------- agendamentos ----------
  async criar_agendamento(b) {
    const cfg = await lerConfig();
    const nome = limpar(b.nome, 120);
    const whatsapp = normalizarWhats(b.whatsapp);
    const email = limpar(b.email, 160).toLowerCase();
    if (nome.length < 2) return erro("Informe o nome da cliente.");
    if (!whatsValido(whatsapp)) return erro("Confira o WhatsApp com DDD.");
    if (email && !emailValido(email)) return erro("Confira o e-mail.");
    if (!reData.test(b.data || "") || !reHora.test(b.hora || "")) return erro("Informe data e horário.");
    const { data: serv } = await db.from("servicos").select("*").eq("id", b.servico_id).maybeSingle();
    if (!serv) return erro("Escolha o serviço.");
    const { data: prof } = await db.from("profissionais").select(CAMPOS_PROF).eq("id", b.profissional_id).maybeSingle();
    if (!prof) return erro("Escolha a profissional.");

    const duracao = Number(b.duracao_min) || serv.duracao_min;
    const inicio = dataHora(b.data, b.hora);
    const fim = new Date(inicio.getTime() + duracao * 60000);
    const conflito = await verificarConflitoGoogle(prof, inicio, fim, null, b.forcar);
    if (conflito) return conflito;

    const cliente = await salvarCliente({ nome, whatsapp, email });
    const { ag, resposta } = await inserir({
      cliente_id: cliente.id, profissional_id: prof.id, servico_id: serv.id,
      servico_nome: serv.nome, servico_preco: serv.preco, duracao_min: duracao,
      inicio: inicio.toISOString(), fim: fim.toISOString(), origem: "painel",
      observacoes: limpar(b.observacoes, 500) || null,
    }, cfg);
    if (resposta) return erro("Esse horário conflita com outro agendamento da profissional.", 409);
    await aposCriar(ag, cfg);
    return ok({ id: ag.id });
  },

  async reagendar(b) {
    const cfg = await lerConfig();
    const antes = await carregarCompleto(b.id);
    if (!antes || antes.status !== "confirmado") return erro("Agendamento não encontrado ou já encerrado.");
    if (!reData.test(b.data || "") || !reHora.test(b.hora || "")) return erro("Informe a nova data e o horário.");
    const profId = b.profissional_id || antes.profissional_id;
    const { data: prof } = await db.from("profissionais").select(CAMPOS_PROF).eq("id", profId).maybeSingle();
    if (!prof) return erro("Profissional não encontrada.");

    const inicio = dataHora(b.data, b.hora);
    const fim = new Date(inicio.getTime() + antes.duracao_min * 60000);
    const ignorarEvento = profId === antes.profissional_id ? antes.google_event_id : null;
    const conflito = await verificarConflitoGoogle(prof, inicio, fim, ignorarEvento, b.forcar);
    if (conflito) return conflito;

    const faltam = inicio.getTime() - Date.now();
    const curto = (Number(cfg.lembrete_curto_horas) || 3) * 3600000;
    const agora = new Date().toISOString();
    const { error } = await db.from("agendamentos").update({
      profissional_id: profId, inicio: inicio.toISOString(), fim: fim.toISOString(),
      lembrete_24h_em: faltam < 24 * 3600000 ? agora : null,
      lembrete_curto_em: faltam < curto ? agora : null,
      atualizado_em: agora,
    }).eq("id", antes.id);
    if (error) {
      if (error.code === "23P01") return erro("Esse horário conflita com outro agendamento da profissional.", 409);
      throw error;
    }
    const depois = await carregarCompleto(antes.id);
    await aposAlterar(antes, depois, cfg);
    return ok();
  },

  async cancelar(b) {
    const cfg = await lerConfig();
    const ag = await carregarCompleto(b.id);
    if (!ag || ag.status !== "confirmado") return erro("Agendamento não encontrado ou já encerrado.");
    await db.from("agendamentos").update({ status: "cancelado", atualizado_em: new Date().toISOString() }).eq("id", ag.id);
    await aposCancelar(ag, cfg, b.avisar !== false);
    return ok();
  },

  async marcar_status(b) {
    if (!["concluido", "faltou"].includes(b.status)) return erro("Status inválido.");
    const { error } = await db.from("agendamentos").update({ status: b.status, atualizado_em: new Date().toISOString() })
      .eq("id", b.id).in("status", ["confirmado", "concluido", "faltou"]);
    if (error) throw error;
    return ok();
  },

  // ---------- serviços ----------
  async salvar_servico(b) {
    const reg = {
      nome: limpar(b.nome, 100), descricao: limpar(b.descricao, 400) || null,
      preco: Number(String(b.preco).replace(",", ".")) || 0,
      duracao_min: parseInt(b.duracao_min, 10), foto_url: limpar(b.foto_url, 500) || null,
      ativo: b.ativo !== false, ordem: parseInt(b.ordem, 10) || 0,
    };
    if (!reg.nome) return erro("Informe o nome do serviço.");
    if (!(reg.duracao_min >= 5 && reg.duracao_min <= 600)) return erro("Duração entre 5 e 600 minutos.");
    const r = b.id ? await db.from("servicos").update(reg).eq("id", b.id) : await db.from("servicos").insert(reg);
    if (r.error) throw r.error;
    return ok();
  },
  async excluir_servico(b) {
    const { error } = await db.from("servicos").delete().eq("id", b.id);
    if (error) throw error;
    return ok();
  },

  // ---------- horários e bloqueios ----------
  async salvar_horarios(b) {
    const faixas = (b.faixas || []).map((f) => ({
      profissional_id: b.profissional_id, dia_semana: Number(f.dia_semana), inicio: f.inicio, fim: f.fim,
    }));
    for (const f of faixas) {
      if (!(f.dia_semana >= 0 && f.dia_semana <= 6) || !reHora.test(f.inicio) || !reHora.test(f.fim) || f.fim <= f.inicio) {
        return erro("Confira as faixas de horário: o fim precisa ser depois do início.");
      }
    }
    const del = await db.from("horarios").delete().eq("profissional_id", b.profissional_id);
    if (del.error) throw del.error;
    if (faixas.length) {
      const ins = await db.from("horarios").insert(faixas);
      if (ins.error) throw ins.error;
    }
    return ok();
  },
  async salvar_bloqueio(b) {
    if (!reData.test(b.data_inicio || "") || !reData.test(b.data_fim || "")) return erro("Informe as datas.");
    const inicio = dataHora(b.data_inicio, reHora.test(b.hora_inicio || "") ? b.hora_inicio : "00:00");
    const fim = reHora.test(b.hora_fim || "") ? dataHora(b.data_fim, b.hora_fim) : dataHora(b.data_fim, "23:59");
    if (fim <= inicio) return erro("O fim precisa ser depois do início.");
    const { error } = await db.from("bloqueios").insert({
      profissional_id: b.profissional_id || null, inicio: inicio.toISOString(), fim: fim.toISOString(),
      motivo: limpar(b.motivo, 120) || null,
    });
    if (error) throw error;
    return ok();
  },
  async excluir_bloqueio(b) {
    const { error } = await db.from("bloqueios").delete().eq("id", b.id);
    if (error) throw error;
    return ok();
  },

  // ---------- profissionais e Google ----------
  async salvar_profissional(b) {
    const { error } = await db.from("profissionais").update({
      nome: limpar(b.nome, 60), bio: limpar(b.bio, 600) || null, foto_url: limpar(b.foto_url, 500) || null,
      whatsapp: normalizarWhats(b.whatsapp) || null, instagram: limpar(b.instagram, 60).replace(/^@/, "") || null,
      ativo: b.ativo !== false, ordem: parseInt(b.ordem, 10) || 0,
    }).eq("id", b.id);
    if (error) throw error;
    return ok();
  },
  async google_url(b) {
    if (!googleConfigurado()) return erro("Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Netlify.");
    return json({ url: urlAutorizacao(b.profissional_id) });
  },
  async google_desconectar(b) {
    const { data: prof } = await db.from("profissionais").select("*").eq("id", b.profissional_id).maybeSingle();
    if (prof) await desconectar(prof);
    return ok();
  },

  // ---------- estúdio ----------
  async salvar_config(b) {
    const permitidas = ["nome", "cidade", "endereco", "maps_url", "instagram", "intervalo_slots", "antecedencia_min", "dias_max", "lembrete_curto_horas"];
    const linhas = Object.entries(b.config || {})
      .filter(([k]) => permitidas.includes(k))
      .map(([chave, valor]) => ({ chave, valor: limpar(valor, 300) }));
    const { error } = await db.from("config").upsert(linhas);
    if (error) throw error;
    return ok();
  },
  async salvar_depoimento(b) {
    const reg = { nome: limpar(b.nome, 60), texto: limpar(b.texto, 500), visivel: b.visivel !== false, ordem: parseInt(b.ordem, 10) || 0 };
    if (!reg.nome || !reg.texto) return erro("Preencha nome e depoimento.");
    const r = b.id ? await db.from("depoimentos").update(reg).eq("id", b.id) : await db.from("depoimentos").insert(reg);
    if (r.error) throw r.error;
    return ok();
  },
  async excluir_depoimento(b) {
    const { error } = await db.from("depoimentos").delete().eq("id", b.id);
    if (error) throw error;
    return ok();
  },
};

export default async (req) => {
  if (req.method !== "POST") return erro("Método não permitido.", 405);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.acao === "login") {
      const { data, error } = await auth.auth.signInWithPassword({ email: String(b.email || "").trim(), password: String(b.senha || "") });
      if (error) return erro("E-mail ou senha incorretos.", 401);
      if (!(await permitido(data.user.email))) return erro("Este e-mail não tem acesso ao painel.", 403);
      return json({ sessao: sessao(data.session) });
    }
    if (b.acao === "renovar") {
      const { data, error } = await auth.auth.refreshSession({ refresh_token: b.refresh_token });
      if (error || !data.session) return erro("Sessão expirada. Entre de novo.", 401);
      return json({ sessao: sessao(data.session) });
    }
    const quem = await usuario(req);
    if (!quem) return erro("Sessão expirada. Entre de novo.", 401);
    const acao = ACOES[b.acao];
    if (!acao) return erro("Ação desconhecida.", 404);
    const r = await acao(b, quem);
    return r;
  } catch (e) {
    console.error(b.acao, e);
    return erro("Algo deu errado no servidor. Tente de novo.", 500);
  }
};

export const config = { path: "/api/admin" };
