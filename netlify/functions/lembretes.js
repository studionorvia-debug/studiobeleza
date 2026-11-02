import { db, lerConfig } from "../lib/util.js";
import { carregarCompleto } from "../lib/agendamentos.js";
import { notificar } from "../lib/notificar.js";

// Roda a cada 15 minutos (Netlify Scheduled Functions).
export default async () => {
  const cfg = await lerConfig();
  const agora = Date.now();
  const curto = (Number(cfg.lembrete_curto_horas) || 3) * 3600000;

  const tarefas = [
    { campo: "lembrete_24h_em", tipo: "lembrete24", janela: 24 * 3600000 },
    { campo: "lembrete_curto_em", tipo: "lembreteCurto", janela: curto },
  ];
  for (const t of tarefas) {
    const { data, error } = await db.from("agendamentos").select("id")
      .eq("status", "confirmado").is(t.campo, null)
      .gt("inicio", new Date(agora).toISOString())
      .lte("inicio", new Date(agora + t.janela).toISOString())
      .limit(50);
    if (error) { console.error(error); continue; }
    for (const { id } of data) {
      const ag = await carregarCompleto(id);
      await notificar(t.tipo, ag, cfg);
      await db.from("agendamentos").update({ [t.campo]: new Date().toISOString() }).eq("id", id);
    }
  }
  return new Response("ok");
};

export const config = { schedule: "*/15 * * * *" };
