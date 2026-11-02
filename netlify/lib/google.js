import { db, cifrar, decifrar, TZ, siteUrl, assinar, fmtHora, moeda } from "./util.js";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export const googleConfigurado = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const redirectUri = () => `${siteUrl()}/api/google-callback`;

export function urlAutorizacao(profissionalId) {
  const state = assinar({ p: profissionalId, exp: Date.now() + 10 * 60 * 1000 });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

export async function conectar(profissionalId, code) {
  const { ok, j } = await token({ code, redirect_uri: redirectUri(), grant_type: "authorization_code" });
  if (!ok) throw new Error(j.error_description || j.error || "O Google recusou a conexão.");
  if (!j.refresh_token) throw new Error("O Google não devolveu o acesso permanente. Remova o app em myaccount.google.com/permissions e conecte de novo.");
  let email = null;
  try { email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email; } catch {}
  const { error } = await db.from("profissionais").update({
    google_refresh_token: cifrar(j.refresh_token),
    google_email: email,
    google_calendar_id: "primary",
    google_status: "ok",
  }).eq("id", profissionalId);
  if (error) throw error;
  return email;
}

export async function desconectar(prof) {
  if (prof.google_refresh_token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decifrar(prof.google_refresh_token))}`, { method: "POST" });
    } catch {}
  }
  await db.from("profissionais").update({ google_refresh_token: null, google_email: null, google_status: null }).eq("id", prof.id);
}

const cache = new Map();
async function accessToken(prof) {
  if (!prof?.google_refresh_token) return null;
  const c = cache.get(prof.id);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const { ok, j } = await token({ refresh_token: decifrar(prof.google_refresh_token), grant_type: "refresh_token" });
  if (!ok) {
    if (j.error === "invalid_grant") {
      await db.from("profissionais").update({ google_status: "reconectar" }).eq("id", prof.id);
    }
    throw new Error(`Google: ${j.error_description || j.error || "falha ao renovar acesso"}`);
  }
  cache.set(prof.id, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

async function api(prof, method, path, body, query = {}) {
  const t = await accessToken(prof);
  if (!t) return null;
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE" && (r.status === 204 || r.status === 404 || r.status === 410)) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google: ${j.error?.message || r.status}`);
  return j;
}

const calId = (p) => p.google_calendar_id || "primary";
const calPath = (p) => `/calendars/${encodeURIComponent(calId(p))}`;
export const conectado = (p) => !!p?.google_refresh_token && p.google_status !== "reconectar";

/** Períodos ocupados na agenda Google da profissional. */
export async function ocupadoGoogle(prof, de, ate) {
  if (!conectado(prof)) return [];
  const j = await api(prof, "POST", "/freeBusy", {
    timeMin: de.toISOString(), timeMax: ate.toISOString(), timeZone: TZ,
    items: [{ id: calId(prof) }],
  });
  const busy = j?.calendars?.[calId(prof)]?.busy || [];
  return busy.map((b) => ({ inicio: new Date(b.start).getTime(), fim: new Date(b.end).getTime() }));
}

/** Eventos que conflitam com um período (usado pelo painel ao remarcar). */
export async function conflitosGoogle(prof, inicio, fim, ignorarEventId) {
  if (!conectado(prof)) return [];
  const j = await api(prof, "GET", `${calPath(prof)}/events`, null, {
    timeMin: inicio.toISOString(), timeMax: fim.toISOString(), singleEvents: "true", maxResults: "20",
  });
  return (j?.items || [])
    .filter((e) => e.id !== ignorarEventId && e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime)
    .map((e) => `${e.summary || "Compromisso"} (${fmtHora(new Date(e.start.dateTime))})`);
}

function corpoEvento(ag, cfg) {
  const c = ag.cliente;
  const local = [cfg.nome, cfg.endereco, cfg.cidade].filter(Boolean).join(", ");
  const linhas = [
    `Cliente: ${c.nome}`,
    `WhatsApp: +${c.whatsapp}`,
    c.email ? `E-mail: ${c.email}` : null,
    `Serviço: ${ag.servico_nome}`,
    `Profissional: ${ag.profissional.nome}`,
    `Duração: ${ag.duracao_min} min`,
    ag.servico_preco != null ? `Valor: ${moeda(ag.servico_preco)}` : null,
    ag.observacoes ? `Observações: ${ag.observacoes}` : null,
    "",
    `${cfg.nome} — ${local}`,
    ag.profissional.whatsapp ? `Contato do estúdio: +${ag.profissional.whatsapp}` : null,
  ].filter((l) => l !== null);
  return {
    summary: `${ag.servico_nome} – ${c.nome} (${cfg.nome})`,
    location: local,
    description: linhas.join("\n"),
    start: { dateTime: new Date(ag.inicio).toISOString(), timeZone: TZ },
    end: { dateTime: new Date(ag.fim).toISOString(), timeZone: TZ },
    attendees: c.email ? [{ email: c.email, displayName: c.nome }] : [],
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
    extendedProperties: { private: { agendamentoId: ag.id } },
  };
}

/** Cria o evento e envia o convite ao e-mail da cliente (sendUpdates=all). */
export async function criarEvento(prof, ag, cfg) {
  if (!conectado(prof)) return null;
  const j = await api(prof, "POST", `${calPath(prof)}/events`, corpoEvento(ag, cfg), { sendUpdates: "all" });
  return j?.id || null;
}
export async function atualizarEvento(prof, eventId, ag, cfg) {
  if (!conectado(prof) || !eventId) return null;
  return api(prof, "PATCH", `${calPath(prof)}/events/${encodeURIComponent(eventId)}`, corpoEvento(ag, cfg), { sendUpdates: "all" });
}
export async function excluirEvento(prof, eventId) {
  if (!conectado(prof) || !eventId) return null;
  return api(prof, "DELETE", `${calPath(prof)}/events/${encodeURIComponent(eventId)}`, null, { sendUpdates: "all" });
}
