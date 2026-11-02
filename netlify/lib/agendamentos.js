import { db, erro } from "./util.js";
import { criarEvento, atualizarEvento, excluirEvento } from "./google.js";
import { notificar } from "./notificar.js";

export const CAMPOS_PROF = "id,nome,slug,whatsapp,callmebot_apikey,google_refresh_token,google_calendar_id,google_status";

export async function carregarCompleto(id) {
  const { data, error } = await db.from("agendamentos")
    .select(`*, cliente:clientes(id,nome,whatsapp,email), profissional:profissionais(${CAMPOS_PROF})`)
    .eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function salvarCliente({ nome, whatsapp, email }) {
  const { data: existente } = await db.from("clientes").select("id,email").eq("whatsapp", whatsapp).maybeSingle();
  if (existente) {
    const { data, error } = await db.from("clientes")
      .update({ nome, email: email || existente.email }).eq("id", existente.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from("clientes").insert({ nome, whatsapp, email: email || null }).select().single();
  if (error) throw error;
  return data;
}

/** Insere o agendamento. Retorna { ag } ou { resposta } com erro amigável. */
export async function inserir(dados, cfg) {
  const inicio = new Date(dados.inicio);
  const faltam = inicio.getTime() - Date.now();
  const curto = (Number(cfg.lembrete_curto_horas) || 3) * 3600000;
  const agora = new Date().toISOString();
  const { data, error } = await db.from("agendamentos").insert({
    ...dados,
    lembrete_24h_em: faltam < 24 * 3600000 ? agora : null,
    lembrete_curto_em: faltam < curto ? agora : null,
  }).select("id").single();
  if (error) {
    if (error.code === "23P01") return { resposta: erro("Esse horário acabou de ser reservado. Escolha outro, por favor.", 409) };
    throw error;
  }
  return { ag: await carregarCompleto(data.id) };
}

/** Depois de criar: evento no Google + notificações. Nunca derruba o agendamento. */
export async function aposCriar(ag, cfg) {
  try {
    const eventId = await criarEvento(ag.profissional, ag, cfg);
    if (eventId) {
      await db.from("agendamentos").update({ google_event_id: eventId }).eq("id", ag.id);
      ag.google_event_id = eventId;
    }
  } catch (e) { console.error("google criar", e.message); }
  await notificar("confirmacao", ag, cfg);
}

export async function aposAlterar(antes, depois, cfg) {
  try {
    if (antes.profissional_id !== depois.profissional_id) {
      await excluirEvento(antes.profissional, antes.google_event_id);
      const id = await criarEvento(depois.profissional, depois, cfg);
      await db.from("agendamentos").update({ google_event_id: id }).eq("id", depois.id);
    } else if (depois.google_event_id) {
      await atualizarEvento(depois.profissional, depois.google_event_id, depois, cfg);
    } else {
      const id = await criarEvento(depois.profissional, depois, cfg);
      if (id) await db.from("agendamentos").update({ google_event_id: id }).eq("id", depois.id);
    }
  } catch (e) { console.error("google alterar", e.message); }
  await notificar("alteracao", depois, cfg);
}

export async function aposCancelar(ag, cfg, avisar = true) {
  try { await excluirEvento(ag.profissional, ag.google_event_id); }
  catch (e) { console.error("google excluir", e.message); }
  if (avisar) await notificar("cancelamento", ag, cfg);
}
