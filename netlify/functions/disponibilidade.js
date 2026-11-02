import { db, json, erro, lerConfig, reData, diasEntre, hojeLocal } from "../lib/util.js";
import { calcular } from "../lib/disponibilidade.js";

export default async (req) => {
  try {
    const u = new URL(req.url);
    const servicoId = u.searchParams.get("servico");
    const profissional = u.searchParams.get("profissional") || "qualquer";
    let de = u.searchParams.get("de");
    const ate = u.searchParams.get("ate");
    if (!servicoId || !reData.test(de || "") || !reData.test(ate || "")) return erro("Parâmetros inválidos.");
    if (de < hojeLocal()) de = hojeLocal();
    if (ate < de) return json({ dias: {} });
    if (diasEntre(de, ate) > 62) return erro("Período muito longo.");

    const cfg = await lerConfig();
    const { data: serv } = await db.from("servicos").select("id,duracao_min,ativo").eq("id", servicoId).maybeSingle();
    if (!serv || !serv.ativo) return erro("Serviço não encontrado.", 404);

    let q = db.from("profissionais").select("id,nome,google_refresh_token,google_calendar_id,google_status").eq("ativo", true);
    if (profissional !== "qualquer") q = q.eq("id", profissional);
    const { data: profs, error } = await q;
    if (error) throw error;

    const mapa = await calcular({ profissionais: profs, duracao: serv.duracao_min, de, ate, cfg });

    // junta tudo: { data: [{ hora, profissionais: [ids] }] }
    const dias = {};
    for (const [pid, porDia] of Object.entries(mapa)) {
      for (const [data, horas] of Object.entries(porDia)) {
        dias[data] ??= {};
        for (const h of horas) (dias[data][h] ??= []).push(pid);
      }
    }
    const saida = {};
    for (const [data, horas] of Object.entries(dias)) {
      saida[data] = Object.keys(horas).sort().map((hora) => ({ hora, profissionais: horas[hora] }));
    }
    return json({ dias: saida });
  } catch (e) {
    console.error(e);
    return erro("Não foi possível consultar a agenda agora. Tente de novo em instantes.", 500);
  }
};

export const config = { path: "/api/disponibilidade" };
