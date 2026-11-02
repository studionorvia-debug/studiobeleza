import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// Brasil sem horário de verão desde 2019: UTC-3 fixo.
export const TZ = "America/Sao_Paulo";
export const OFFSET = "-03:00";

export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
export const erro = (mensagem, status = 400, extra = {}) => json({ erro: mensagem, ...extra }, status);

// ---------- datas (sempre no fuso do estúdio) ----------
export const reData = /^\d{4}-\d{2}-\d{2}$/;
export const reHora = /^\d{2}:\d{2}$/;

export const dataHora = (data, hora) => new Date(`${data}T${hora}:00${OFFSET}`);
export const diaSemana = (data) => new Date(`${data}T12:00:00${OFFSET}`).getUTCDay();

export function fmtData(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function fmtHora(d) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
export function fmtDataLonga(d) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
}
export const hojeLocal = () => fmtData(new Date());
export function addDias(data, n) {
  const d = new Date(`${data}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtData(d);
}
export function diasEntre(de, ate) {
  return Math.round((new Date(`${ate}T12:00:00Z`) - new Date(`${de}T12:00:00Z`)) / 86400000);
}
export function minutos(h) {
  const [hh, mm] = String(h).slice(0, 5).split(":").map(Number);
  return hh * 60 + mm;
}
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ---------- criptografia ----------
function chave() {
  const buf = Buffer.from(process.env.ENCRYPTION_KEY || "", "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY precisa ter 32 bytes em base64.");
  return buf;
}
export function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chave(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decifrar(s) {
  const [iv, tag, enc] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", chave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
export function assinar(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const s = crypto.createHmac("sha256", chave()).update(p).digest("base64url");
  return `${p}.${s}`;
}
export function verificarAssinatura(token) {
  const [p, s] = String(token || "").split(".");
  if (!p || !s) return null;
  const esperado = crypto.createHmac("sha256", chave()).update(p).digest("base64url");
  if (s.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esperado))) return null;
  const o = JSON.parse(Buffer.from(p, "base64url").toString());
  if (o.exp && Date.now() > o.exp) return null;
  return o;
}

// ---------- diversos ----------
export async function lerConfig() {
  const { data } = await db.from("config").select("chave,valor");
  const c = {};
  for (const r of data || []) c[r.chave] = r.valor;
  return {
    nome: "Studio Beleza", cidade: "Miguel Pereira – RJ", endereco: "", maps_url: "", instagram: "",
    intervalo_slots: "30", antecedencia_min: "120", dias_max: "60", lembrete_curto_horas: "3",
    ...c,
  };
}

export function normalizarWhats(w) {
  let d = String(w || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}
export const whatsValido = (d) => /^55\d{10,11}$/.test(d);
export const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ""));
export const siteUrl = () => (process.env.SITE_URL || process.env.URL || "").replace(/\/$/, "");
export const limpar = (s, max = 300) => String(s ?? "").trim().slice(0, max);
export const moeda = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
