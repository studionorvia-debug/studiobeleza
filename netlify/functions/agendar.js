import {
  db, json, erro, lerConfig, reData, reHora, dataHora, normalizarWhats, whatsValido, emailValido, limpar,
} from "../lib/util.js";
import { calcular } from "../lib/disponibilidade.js";
import { salvarCliente, inserir, aposCriar } from "../lib/agendamentos.js";

export default async (req) => {
  if (req.method !== "POST") return erro("Método não permitido.", 405);
  try {
    const b = await req.json().catch(() => null);
    if (!b) return erro("Dados inválidos.");
    if (b.empresa) return erro("Dados inválidos."); // campo-isca contra robôs

    const nome = limpar(b.nome, 120);
    const whatsapp = normalizarWhats(b.whatsapp);
    const email = limpar(b.email, 160).toLowerCase();
    const observacoes = limpar(b.observacoes, 500) || null;
    if (nome.length < 3) return erro("Informe seu nome completo.");
    if (!whatsValido(whatsapp)) return erro("Confira o número de WhatsApp com DDD.");
    if (!emailValido(email)) return erro("Confira o e-mail.");
    if (!reData.test(b.data || "") || !reHora.test(b.hora || "")) return erro("Escolha a data e o horário.");

    const cfg = await lerConfig();
    const { data: serv } = await db.from("servicos").select("*").eq("id", b.servico_id).maybeSingle();
    if (!serv || !serv.ativo) return erro("Esse serviço não está mais disponível.", 404);

    let q = db.from("profissionais").select("id,nome,google_refresh_token,google_calendar_id,google_status").eq("ativo", true).order("ordem");
    if (b.profissional_id && b.profissional_id !== "qualquer") q = q.eq("id", b.profissional_id);
    const { data: candidatas } = await q;
    if (!candidatas?.length) return erro("Profissional não encontrada.", 404);

    // confere de novo, no servidor, se o horário ainda está livre
    const mapa = await calcular({ profissionais: candidatas, duracao: serv.duracao_min, de: b.data, ate: b.data, cfg });
    const livres = candidatas.filter((p) => mapa[p.id]?.[b.data]?.includes(b.hora));
    if (!livres.length) return erro("Esse horário não está mais disponível. Escolha outro, por favor.", 409);

    // "qualquer profissional": escolhe quem tem menos atendimentos no dia
    let escolhida = livres[0];
    if (livres.length > 1) {
      const ini = dataHora(b.data, "00:00").toISOString();
      const fim = dataHora(b.data, "23:59").toISOString();
      const { data: doDia } = await db.from("agendamentos").select("profissional_id")
        .eq("status", "confirmado").gte("inicio", ini).lte("inicio", fim);
      const conta = (id) => (doDia || []).filter((a) => a.profissional_id === id).length;
      escolhida = [...livres].sort((a, c) => conta(a.id) - conta(c.id))[0];
    }

    const cliente = await salvarCliente({ nome, whatsapp, email });
    const inicio = dataHora(b.data, b.hora);
    const fim = new Date(inicio.getTime() + serv.duracao_min * 60000);

    const { ag, resposta } = await inserir({
      cliente_id: cliente.id,
      profissional_id: escolhida.id,
      servico_id: serv.id,
      servico_nome: serv.nome,
      servico_preco: serv.preco,
      duracao_min: serv.duracao_min,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      origem: "site",
      observacoes,
    }, cfg);
    if (resposta) return resposta;

    await aposCriar(ag, cfg);

    return json({
      agendamento: {
        id: ag.id,
        servico: ag.servico_nome,
        preco: ag.servico_preco,
        duracao_min: ag.duracao_min,
        profissional: ag.profissional.nome,
        inicio: ag.inicio,
        fim: ag.fim,
        convite_enviado: !!ag.google_event_id,
      },
    }, 201);
  } catch (e) {
    console.error(e);
    return erro("Não foi possível concluir o agendamento agora. Tente de novo em instantes.", 500);
  }
};

export const config = { path: "/api/agendar" };
