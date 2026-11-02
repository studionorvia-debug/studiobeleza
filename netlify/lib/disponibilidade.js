import { db, dataHora, diaSemana, addDias, minutos, hhmm, hojeLocal } from "./util.js";
import { ocupadoGoogle } from "./google.js";

/**
 * Calcula os horários livres de cada profissional entre duas datas.
 * Considera: faixas de expediente (intervalos entre faixas), bloqueios
 * (folgas, feriados, manuais), agendamentos já feitos, a agenda Google
 * da profissional, a duração do serviço e a antecedência mínima.
 * Retorna: { [profissionalId]: { "YYYY-MM-DD": ["09:00", ...] } }
 */
export async function calcular({ profissionais, duracao, de, ate, cfg, ignorarAgendamento = null }) {
  const ids = profissionais.map((p) => p.id);
  const resultado = {};
  if (!ids.length) return resultado;

  const ini = dataHora(de, "00:00");
  const fimRange = dataHora(addDias(ate, 1), "00:00");

  const [hor, ags, blq] = await Promise.all([
    db.from("horarios").select("profissional_id,dia_semana,inicio,fim").in("profissional_id", ids),
    db.from("agendamentos").select("id,profissional_id,inicio,fim")
      .in("profissional_id", ids).in("status", ["confirmado", "concluido"])
      .lt("inicio", fimRange.toISOString()).gt("fim", ini.toISOString()),
    db.from("bloqueios").select("profissional_id,inicio,fim")
      .lt("inicio", fimRange.toISOString()).gt("fim", ini.toISOString())
      .or(`profissional_id.is.null,profissional_id.in.(${ids.join(",")})`),
  ]);
  for (const r of [hor, ags, blq]) if (r.error) throw r.error;

  const google = await Promise.all(profissionais.map(async (p) => {
    try { return await ocupadoGoogle(p, ini, fimRange); }
    catch (e) { console.error("freebusy", p.nome, e.message); return []; }
  }));

  const passo = Math.max(5, Number(cfg.intervalo_slots) || 30);
  const minInicio = Date.now() + (Number(cfg.antecedencia_min) || 0) * 60000;
  const limite = dataHora(addDias(hojeLocal(), Number(cfg.dias_max) || 60), "23:59").getTime();
  const durMs = duracao * 60000;

  profissionais.forEach((p, i) => {
    let ocupado = [
      ...ags.data.filter((a) => a.profissional_id === p.id && a.id !== ignorarAgendamento?.id),
      ...blq.data.filter((b) => !b.profissional_id || b.profissional_id === p.id),
    ].map((o) => ({ inicio: new Date(o.inicio).getTime(), fim: new Date(o.fim).getTime() }));

    // ao remarcar, o próprio evento no Google não deve bloquear o novo horário
    const ign = ignorarAgendamento
      ? { inicio: new Date(ignorarAgendamento.inicio).getTime(), fim: new Date(ignorarAgendamento.fim).getTime() }
      : null;
    ocupado = ocupado.concat(google[i].filter((g) => !(ign && g.inicio === ign.inicio && g.fim === ign.fim)));

    const porDia = {};
    for (let d = de; d <= ate; d = addDias(d, 1)) {
      const faixas = hor.data.filter((h) => h.profissional_id === p.id && h.dia_semana === diaSemana(d));
      const livres = new Set();
      for (const f of faixas) {
        const a = minutos(f.inicio), b = minutos(f.fim);
        for (let t = a; t + duracao <= b; t += passo) {
          const s = dataHora(d, hhmm(t)).getTime();
          const e = s + durMs;
          if (s < minInicio || s > limite) continue;
          if (ocupado.some((o) => s < o.fim && e > o.inicio)) continue;
          livres.add(hhmm(t));
        }
      }
      if (livres.size) porDia[d] = [...livres].sort();
    }
    resultado[p.id] = porDia;
  });
  return resultado;
}
