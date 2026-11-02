import { fmtDataLonga, fmtHora, moeda } from "./util.js";
import { conectado } from "./google.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEsc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function gerarIcs(ag, cfg) {
  const local = [cfg.nome, cfg.endereco, cfg.cidade].filter(Boolean).join(", ");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Studio Beleza//Agendamento//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ag.id}@studiobeleza`,
    `DTSTAMP:${utc(Date.now())}`,
    `DTSTART:${utc(ag.inicio)}`,
    `DTEND:${utc(ag.fim)}`,
    `SUMMARY:${icsEsc(`${ag.servico_nome} – ${cfg.nome}`)}`,
    `LOCATION:${icsEsc(local)}`,
    `DESCRIPTION:${icsEsc(`Profissional: ${ag.profissional.nome}\nDuração: ${ag.duracao_min} min`)}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Lembrete", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function linkGoogleAgenda(ag, cfg) {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `${ag.servico_nome} – ${cfg.nome}`,
    dates: `${utc(ag.inicio)}/${utc(ag.fim)}`,
    details: `Profissional: ${ag.profissional.nome}\nDuração: ${ag.duracao_min} min`,
    location: [cfg.nome, cfg.endereco, cfg.cidade].filter(Boolean).join(", "),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const TEXTOS = {
  confirmacao: { assunto: "Seu horário está confirmado", titulo: "Seu horário está confirmado", abertura: "Estamos esperando por você no Studio Beleza." },
  lembrete24: { assunto: "Seu horário é amanhã", titulo: "Até amanhã!", abertura: "Passando para lembrar do seu horário." },
  lembreteCurto: { assunto: "Seu horário é daqui a pouco", titulo: "Daqui a pouquinho", abertura: "Seu horário é hoje. Já estamos preparando tudo." },
  cancelamento: { assunto: "Seu horário foi cancelado", titulo: "Horário cancelado", abertura: "Seu horário abaixo foi cancelado. Quando quiser, é só agendar de novo pelo site." },
  alteracao: { assunto: "Seu horário mudou", titulo: "Novo horário", abertura: "Seu agendamento foi alterado. Confira os novos detalhes." },
};

function htmlEmail(tipo, ag, cfg, extras) {
  const t = TEXTOS[tipo];
  const local = [cfg.endereco, cfg.cidade].filter(Boolean).join(", ");
  const linha = (rot, val) => `<tr><td style="padding:6px 0;color:#8a6f74;font-size:14px;width:120px">${rot}</td><td style="padding:6px 0;color:#3b2a2e;font-size:15px">${esc(val)}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#f6ece9;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6ece9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffcfa;border-radius:20px;padding:36px 32px">
<tr><td align="center" style="padding-bottom:20px"><div style="width:64px;height:64px;border-radius:50%;background:#f4e4e2;color:#9a4457;font-family:Georgia,serif;font-size:28px;line-height:64px;text-align:center">SB</div></td></tr>
<tr><td style="font-family:Georgia,serif;font-size:26px;color:#5e2433;text-align:center;padding-bottom:8px">${esc(t.titulo)}</td></tr>
<tr><td style="font-size:15px;color:#6b5357;text-align:center;padding-bottom:24px">Olá, ${esc(ag.cliente.nome.split(" ")[0])}. ${esc(t.abertura)}</td></tr>
<tr><td><table role="presentation" width="100%" style="border-top:1px solid #efdcd8;border-bottom:1px solid #efdcd8;padding:12px 0">
${linha("Serviço", ag.servico_nome)}
${linha("Com", ag.profissional.nome)}
${linha("Data", fmtDataLonga(new Date(ag.inicio)))}
${linha("Horário", `${fmtHora(new Date(ag.inicio))} (cerca de ${ag.duracao_min} min)`)}
${ag.servico_preco != null ? linha("Valor", moeda(ag.servico_preco)) : ""}
${local ? linha("Endereço", local) : ""}
</table></td></tr>
${extras.googleLink ? `<tr><td align="center" style="padding-top:24px"><a href="${esc(extras.googleLink)}" style="display:inline-block;background:#9a4457;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px">Adicionar ao Google Agenda</a></td></tr>` : ""}
<tr><td style="font-size:13px;color:#8a6f74;text-align:center;padding-top:24px">Precisa mudar algo? Fale com a ${esc(ag.profissional.nome)} pelo WhatsApp${ag.profissional.whatsapp ? ` <a style="color:#9a4457" href="https://wa.me/${esc(ag.profissional.whatsapp)}">+${esc(ag.profissional.whatsapp)}</a>` : ""}.</td></tr>
</table>
<div style="font-size:12px;color:#a58c90;padding-top:16px">${esc(cfg.nome)} · ${esc(cfg.cidade)}</div>
</td></tr></table></body></html>`;
}

async function enviarEmail(tipo, ag, cfg) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !ag.cliente.email) return;
  // Se a agenda Google da profissional está conectada, o Google já mandou o convite:
  // evitamos anexar outro evento para não duplicar no calendário da cliente.
  const semConvite = !conectado(ag.profissional);
  const comEvento = semConvite && (tipo === "confirmacao" || tipo === "alteracao");
  const body = {
    from: process.env.EMAIL_FROM,
    to: [ag.cliente.email],
    subject: `${TEXTOS[tipo].assunto} – ${cfg.nome}`,
    html: htmlEmail(tipo, ag, cfg, { googleLink: comEvento ? linkGoogleAgenda(ag, cfg) : null }),
  };
  if (process.env.EMAIL_REPLY_TO) body.reply_to = process.env.EMAIL_REPLY_TO;
  if (comEvento) {
    body.attachments = [{ filename: "agendamento.ics", content: Buffer.from(gerarIcs(ag, cfg)).toString("base64") }];
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`E-mail: ${await r.text()}`);
}

// WhatsApp Business (Cloud API da Meta) — opcional.
// Cada tipo usa um modelo aprovado na Meta com 4 variáveis: {{1}} nome, {{2}} serviço, {{3}} data, {{4}} horário.
const MODELOS = {
  confirmacao: "WA_TPL_CONFIRMACAO", lembrete24: "WA_TPL_LEMBRETE", lembreteCurto: "WA_TPL_LEMBRETE",
  cancelamento: "WA_TPL_CANCELAMENTO", alteracao: "WA_TPL_ALTERACAO",
};
async function enviarWhatsApp(tipo, ag) {
  const modelo = process.env[MODELOS[tipo]];
  if (!process.env.WA_TOKEN || !process.env.WA_PHONE_ID || !modelo) return;
  const params = [ag.cliente.nome.split(" ")[0], ag.servico_nome, fmtDataLonga(new Date(ag.inicio)), fmtHora(new Date(ag.inicio))]
    .map((text) => ({ type: "text", text }));
  const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: ag.cliente.whatsapp, type: "template",
      template: { name: modelo, language: { code: "pt_BR" }, components: [{ type: "body", parameters: params }] },
    }),
  });
  if (!r.ok) throw new Error(`WhatsApp: ${await r.text()}`);
}

// Aviso no WhatsApp da PROFISSIONAL (CallMeBot, gratuito).
// Cada profissional ativa uma vez e recebe um código (apikey), salvo no painel.
export async function enviarCallMeBot(telefone, apikey, texto) {
  const url = `https://api.callmebot.com/whatsapp.php?${new URLSearchParams({ phone: `+${telefone}`, text: texto, apikey })}`;
  const r = await fetch(url);
  const corpo = (await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!r.ok || /invalid|error|not allowed/i.test(corpo)) throw new Error(`CallMeBot: ${corpo.slice(0, 200) || r.status}`);
}

const AVISOS = {
  confirmacao: "📅 *Novo agendamento*",
  alteracao: "🔄 *Agendamento remarcado*",
  cancelamento: "❌ *Agendamento cancelado*",
};
async function avisarProfissional(tipo, ag) {
  const p = ag.profissional;
  if (!AVISOS[tipo] || !p?.whatsapp || !p?.callmebot_apikey) return;
  const c = ag.cliente;
  const d = c.whatsapp.replace(/^55/, "");
  const texto = [
    AVISOS[tipo],
    "",
    `*Cliente:* ${c.nome}`,
    `*WhatsApp:* (${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)} wa.me/${c.whatsapp}`,
    `*Serviço:* ${ag.servico_nome} (${ag.duracao_min} min)`,
    `*Quando:* ${fmtDataLonga(new Date(ag.inicio))} às ${fmtHora(new Date(ag.inicio))}`,
    ag.observacoes ? `*Obs.:* ${ag.observacoes}` : null,
    ag.origem === "painel" ? "_Feito pelo painel_" : null,
  ].filter((l) => l !== null).join("\n");
  await enviarCallMeBot(p.whatsapp, p.callmebot_apikey, texto);
}

/** Envia por todos os canais configurados. Falhas são registradas, não interrompem. */
export async function notificar(tipo, ag, cfg) {
  const res = await Promise.allSettled([enviarEmail(tipo, ag, cfg), enviarWhatsApp(tipo, ag), avisarProfissional(tipo, ag)]);
  for (const r of res) if (r.status === "rejected") console.error(tipo, r.reason?.message);
}
