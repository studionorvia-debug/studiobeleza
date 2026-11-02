import { db, json, erro, lerConfig } from "../lib/util.js";

export default async () => {
  try {
    const [cfg, serv, prof, dep] = await Promise.all([
      lerConfig(),
      db.from("servicos").select("id,nome,descricao,preco,duracao_min,foto_url").eq("ativo", true).order("ordem").order("nome"),
      db.from("profissionais").select("id,nome,slug,bio,foto_url,instagram,whatsapp").eq("ativo", true).order("ordem"),
      db.from("depoimentos").select("id,nome,texto").eq("visivel", true).order("ordem").limit(12),
    ]);
    for (const r of [serv, prof, dep]) if (r.error) throw r.error;
    return json({
      estudio: { nome: cfg.nome, cidade: cfg.cidade, endereco: cfg.endereco, maps_url: cfg.maps_url, instagram: cfg.instagram },
      servicos: serv.data,
      profissionais: prof.data,
      depoimentos: dep.data,
    }, 200, { "cache-control": "public, max-age=60" });
  } catch (e) {
    console.error(e);
    return erro("Não foi possível carregar os dados do estúdio.", 500);
  }
};

export const config = { path: "/api/catalogo" };
