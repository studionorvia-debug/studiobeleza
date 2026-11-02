import { verificarAssinatura, siteUrl } from "../lib/util.js";
import { conectar } from "../lib/google.js";

const voltar = (params) => Response.redirect(`${siteUrl()}/admin.html?${new URLSearchParams(params)}#profissionais`, 302);

export default async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return voltar({ google: "cancelado" });
  const estado = verificarAssinatura(u.searchParams.get("state"));
  if (!estado?.p) return voltar({ google: "expirado" });
  try {
    await conectar(estado.p, u.searchParams.get("code"));
    return voltar({ google: "ok" });
  } catch (e) {
    console.error(e);
    return voltar({ google: "erro", msg: e.message.slice(0, 200) });
  }
};

export const config = { path: "/api/google-callback" };
