(() => {
  "use strict";

  const TZ = "America/Sao_Paulo";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const moeda = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fData = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  const fHora = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
  const fLonga = (data) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(`${data}T12:00:00-03:00`));
  const fCurta = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(d));
  const hoje = () => fData(Date.now());
  const somaDias = (data, n) => { const d = new Date(`${data}T12:00:00-03:00`); d.setUTCDate(d.getUTCDate() + n); return fData(d); };
  const fWhats = (n) => { const d = String(n || "").replace(/^55/, ""); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : n; };
  const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const STATUS = { confirmado: ["Confirmado", ""], concluido: ["Concluído", "ok"], faltou: ["Faltou", "ruim"], cancelado: ["Cancelado", "neutro"] };

  // ------------------------------------------------------------ sessão e API
  let sessao = null;
  try { sessao = JSON.parse(localStorage.getItem("sb-admin") || "null"); } catch {}
  const guardar = (s) => { sessao = s; s ? localStorage.setItem("sb-admin", JSON.stringify(s)) : localStorage.removeItem("sb-admin"); };

  async function chamar(corpo, token) {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "Falha na comunicação com o servidor."), { status: r.status, dados: j });
    return j;
  }
  async function api(acao, dados = {}) {
    if (!sessao) throw Object.assign(new Error("Entre para continuar."), { status: 401 });
    if (sessao.expires_at * 1000 < Date.now() + 60000) {
      try { guardar((await chamar({ acao: "renovar", refresh_token: sessao.refresh_token })).sessao); }
      catch { guardar(null); mostrarLogin(); throw new Error("Sessão expirada. Entre de novo."); }
    }
    try { return await chamar({ acao, ...dados }, sessao.access_token); }
    catch (e) { if (e.status === 401) { guardar(null); mostrarLogin(); } throw e; }
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("ver");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("ver"), 3200);
  }

  // ------------------------------------------------------------ login
  function mostrarLogin() { $("#tela-app").hidden = true; $("#tela-login").hidden = false; $("#l-email").focus(); }
  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#login-erro"); erro.hidden = true;
    const bt = e.submitter; bt.disabled = true; bt.textContent = "Entrando…";
    try {
      const j = await chamar({ acao: "login", email: $("#l-email").value, senha: $("#l-senha").value });
      guardar(j.sessao);
      $("#l-senha").value = "";
      iniciar();
    } catch (err) { erro.textContent = err.message; erro.hidden = false; }
    finally { bt.disabled = false; bt.textContent = "Entrar"; }
  });
  $("#sair").addEventListener("click", () => { guardar(null); mostrarLogin(); });

  // ------------------------------------------------------------ modal
  const modal = $("#modal");
  // Enter dentro do formulário não deve fechar a janela
  $("#modal-form").addEventListener("submit", (e) => { if (e.submitter?.value !== "cancelar") e.preventDefault(); });
  function abrirModal({ titulo, corpo, acoes, aoAbrir }) {
    $("#modal-titulo").textContent = titulo;
    $("#modal-corpo").innerHTML = corpo;
    $("#modal-erro").hidden = true;
    const area = $("#modal-acoes"); area.innerHTML = "";
    for (const a of acoes) {
      const b = document.createElement("button");
      b.type = "button"; b.className = `btn ${a.classe || ""}`; b.textContent = a.texto;
      b.addEventListener("click", async () => {
        if (!a.acao) return modal.close();
        $("#modal-erro").hidden = true;
        $$("button", area).forEach((x) => (x.disabled = true));
        try { await a.acao(); }
        catch (e) { mostrarErroModal(e, a); }
        finally { $$("button", area).forEach((x) => (x.disabled = false)); }
      });
      area.append(b);
    }
    modal.showModal();
    aoAbrir?.();
  }
  function mostrarErroModal(e, acao) {
    const el = $("#modal-erro");
    el.textContent = e.message; el.hidden = false;
    if (e.dados?.confirmar && acao.forcar) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn btn--claro btn--pequeno"; b.style.marginTop = ".6rem";
      b.textContent = "Agendar mesmo assim";
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await acao.forcar(); } catch (err) { el.textContent = err.message; }
      });
      el.append(document.createElement("br"), b);
    }
  }
  const valores = () => Object.fromEntries(new FormData($("#modal-form")));

  // ------------------------------------------------------------ dados gerais
  let P = null; // painel
  const prof = (id) => P.profissionais.find((p) => p.id === id);
  async function recarregarPainel() { P = await api("painel"); }

  // ------------------------------------------------------------ roteamento
  const VISOES = { agenda: verAgenda, clientes: verClientes, servicos: verServicos, horarios: verHorarios, profissionais: verProfissionais, estudio: verEstudio };
  function rota() {
    const nome = (location.hash || "#agenda").slice(1);
    const v = VISOES[nome] ? nome : "agenda";
    $$("#abas a").forEach((a) => {
      if (a.getAttribute("href") === `#${v}`) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("#conteudo").innerHTML = `<div class="carregando">Carregando</div>`;
    VISOES[v]().catch((e) => { $("#conteudo").innerHTML = `<div class="vazio-adm">${esc(e.message)}</div>`; });
  }
  addEventListener("hashchange", rota);

  async function iniciar() {
    $("#tela-login").hidden = true;
    $("#tela-app").hidden = false;
    try { await recarregarPainel(); }
    catch (e) { if (e.status !== 401) toast(e.message); return; }

    const q = new URLSearchParams(location.search);
    if (q.get("google")) {
      const m = { ok: "Agenda Google conectada.", cancelado: "Conexão com o Google cancelada.", expirado: "O link de conexão expirou. Tente de novo.", erro: `Não foi possível conectar: ${q.get("msg") || ""}` };
      toast(m[q.get("google")] || "");
      history.replaceState(null, "", location.pathname + location.hash);
    }
    avisos();
    rota();
  }

  function avisos() {
    const msgs = [];
    if (!P.google_configurado) msgs.push("Integração com o Google ainda não configurada no servidor.");
    for (const p of P.profissionais.filter((x) => x.ativo)) {
      if (p.google.status === "reconectar") msgs.push(`A agenda Google da ${p.nome} precisa ser reconectada.`);
      else if (P.google_configurado && !p.google.conectado) msgs.push(`A ${p.nome} ainda não conectou a agenda Google.`);
    }
    if (!P.horarios.length) msgs.push("Cadastre os horários de atendimento para a agenda abrir no site.");
    const el = $("#aviso-topo");
    el.hidden = !msgs.length;
    el.innerHTML = msgs.map(esc).join("<br>") + (msgs.length ? ` <a href="#${P.horarios.length ? "profissionais" : "horarios"}">Resolver</a>` : "");
  }

  // ------------------------------------------------------------ AGENDA
  const ag = { base: hoje(), modo: "semana", prof: "", status: "" };
  function periodo() {
    if (ag.modo === "dia") return [ag.base, ag.base];
    if (ag.modo === "semana") return [ag.base, somaDias(ag.base, 6)];
    return [ag.base, somaDias(ag.base, 29)];
  }

  async function verAgenda() {
    const [de, ate] = periodo();
    const { agendamentos } = await api("agendamentos", { de, ate, profissional_id: ag.prof || undefined, status: ag.status || undefined });
    const passo = { dia: 1, semana: 7, mes: 30 }[ag.modo];
    const grupos = {};
    for (const a of agendamentos) (grupos[fData(a.inicio)] ??= []).push(a);

    $("#conteudo").innerHTML = `
      <div class="barra">
        <button class="icone" id="ant" aria-label="Período anterior">‹</button>
        <input type="date" id="base" value="${ag.base}" aria-label="Data inicial">
        <button class="icone" id="prox" aria-label="Próximo período">›</button>
        <button class="link" id="hoje">Hoje</button>
        <div class="segmento" role="group" aria-label="Período">
          ${[["dia", "Dia"], ["semana", "7 dias"], ["mes", "30 dias"]].map(([k, t]) => `<button data-modo="${k}" aria-pressed="${ag.modo === k}">${t}</button>`).join("")}
        </div>
        <select id="f-prof" aria-label="Profissional"><option value="">Todas</option>${P.profissionais.map((p) => `<option value="${p.id}" ${ag.prof === p.id ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select>
        <select id="f-status" aria-label="Situação">
          <option value="">Todas as situações</option>
          ${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}" ${ag.status === k ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <span class="espaco"></span>
        <button class="btn btn--pequeno" id="novo">Novo agendamento</button>
      </div>
      ${agendamentos.length ? Object.entries(grupos).map(([data, lista]) => `
        <h2 class="dia-titulo">${esc(fLonga(data))}</h2>
        ${lista.map(cartaoAgendamento).join("")}`).join("")
        : `<div class="vazio-adm">Nenhum agendamento neste período.</div>`}`;

    $("#ant").onclick = () => { ag.base = somaDias(ag.base, -passo); verAgenda(); };
    $("#prox").onclick = () => { ag.base = somaDias(ag.base, passo); verAgenda(); };
    $("#hoje").onclick = () => { ag.base = hoje(); verAgenda(); };
    $("#base").onchange = (e) => { if (e.target.value) { ag.base = e.target.value; verAgenda(); } };
    $$("[data-modo]").forEach((b) => (b.onclick = () => { ag.modo = b.dataset.modo; verAgenda(); }));
    $("#f-prof").onchange = (e) => { ag.prof = e.target.value; verAgenda(); };
    $("#f-status").onchange = (e) => { ag.status = e.target.value; verAgenda(); };
    $("#novo").onclick = () => formAgendamento();

    const porId = Object.fromEntries(agendamentos.map((a) => [a.id, a]));
    $$("[data-acao]").forEach((b) => (b.onclick = () => acaoAgendamento(b.dataset.acao, porId[b.dataset.id])));
  }

  function cartaoAgendamento(a) {
    const [rot, cls] = STATUS[a.status];
    const futuro = new Date(a.inicio) > Date.now();
    const msg = encodeURIComponent(`Olá, ${a.cliente.nome.split(" ")[0]}! Passando para lembrar do seu horário no Studio Beleza: ${a.servico_nome} com a ${a.profissional.nome}, ${fLonga(fData(a.inicio))} às ${fHora(a.inicio)}. Até lá! 💗`);
    return `
      <article class="ag ${a.status}">
        <div class="hora">${fHora(a.inicio)}<small>até ${fHora(a.fim)}</small></div>
        <div>
          <div class="quem">${esc(a.cliente.nome)} <span class="chip ${cls}">${rot}</span>${a.origem === "painel" ? `<span class="chip neutro">pelo painel</span>` : ""}</div>
          <div class="det">${esc(a.servico_nome)} com ${esc(a.profissional.nome)}${a.servico_preco != null ? ` · ${moeda(a.servico_preco)}` : ""}</div>
          <div class="det">${esc(fWhats(a.cliente.whatsapp))}${a.cliente.email ? ` · ${esc(a.cliente.email)}` : ""}</div>
          ${a.observacoes ? `<div class="det">Obs.: ${esc(a.observacoes)}</div>` : ""}
          ${a.status === "confirmado" && !a.google_event_id && prof(a.profissional_id)?.google.conectado ? `<div class="det">Sem evento no Google Agenda.</div>` : ""}
        </div>
        <div class="acoes">
          <a class="link" href="https://wa.me/${esc(a.cliente.whatsapp)}?text=${msg}" target="_blank" rel="noopener">WhatsApp</a>
          ${a.status === "confirmado" && futuro ? `
            <button class="link" data-acao="remarcar" data-id="${a.id}">Remarcar</button>
            <button class="link perigo" data-acao="cancelar" data-id="${a.id}">Cancelar</button>` : ""}
          ${a.status !== "cancelado" && !futuro ? `
            <button class="link" data-acao="concluido" data-id="${a.id}">Concluído</button>
            <button class="link" data-acao="faltou" data-id="${a.id}">Faltou</button>` : ""}
        </div>
      </article>`;
  }

  async function acaoAgendamento(acao, a) {
    if (acao === "remarcar") return formRemarcar(a);
    if (acao === "cancelar") {
      return abrirModal({
        titulo: "Cancelar agendamento",
        corpo: `<p>${esc(a.cliente.nome)}, ${esc(a.servico_nome)}, ${esc(fLonga(fData(a.inicio)))} às ${fHora(a.inicio)}.</p>
          <label class="check"><input type="checkbox" name="avisar" checked> Avisar a cliente por e-mail</label>
          <p class="nota">O horário volta a ficar livre e o evento sai da agenda Google.</p>`,
        acoes: [
          { texto: "Manter", classe: "btn--claro" },
          { texto: "Cancelar agendamento", acao: async () => {
            await api("cancelar", { id: a.id, avisar: !!valores().avisar });
            modal.close(); toast("Agendamento cancelado."); verAgenda();
          } },
        ],
      });
    }
    await api("marcar_status", { id: a.id, status: acao });
    toast(acao === "concluido" ? "Marcado como concluído." : "Marcado como falta.");
    verAgenda();
  }

  function opcoes(lista, sel, rotulo = (x) => x.nome) {
    return lista.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(rotulo(x))}</option>`).join("");
  }

  function sugestoes(obterParams) {
    const area = $("#sugestoes");
    let pedido = 0;
    return async () => {
      const p = obterParams();
      if (!p) { area.innerHTML = ""; return; }
      const n = ++pedido;
      area.innerHTML = `<small class="nota" style="margin:0">Buscando horários livres…</small>`;
      try {
        const { horas } = await api("horarios_livres", p);
        if (n !== pedido) return;
        area.innerHTML = horas.length
          ? horas.map((h) => `<button type="button" data-h="${h}">${h}</button>`).join("")
          : `<small class="nota" style="margin:0">Sem horários livres no expediente deste dia. Você ainda pode digitar um horário.</small>`;
        $$("button", area).forEach((b) => (b.onclick = () => ($("#m-hora").value = b.dataset.h)));
      } catch (e) { area.innerHTML = `<small class="nota" style="margin:0">${esc(e.message)}</small>`; }
    };
  }

  function formAgendamento() {
    const ativos = P.servicos.filter((s) => s.ativo);
    abrirModal({
      titulo: "Novo agendamento",
      corpo: `
        <div class="grade-2">
          <div class="campo"><label for="m-prof">Profissional</label><select id="m-prof" name="profissional_id">${opcoes(P.profissionais.filter((p) => p.ativo), ag.prof || P.profissionais[0]?.id)}</select></div>
          <div class="campo"><label for="m-serv">Serviço</label><select id="m-serv" name="servico_id">${opcoes(ativos, null, (s) => `${s.nome} (${s.duracao_min} min)`)}</select></div>
          <div class="campo"><label for="m-data">Data</label><input id="m-data" name="data" type="date" value="${ag.base >= hoje() ? ag.base : hoje()}" required></div>
          <div class="campo"><label for="m-hora">Horário</label><input id="m-hora" name="hora" type="time" step="300" required></div>
        </div>
        <div class="horas-sugestao" id="sugestoes"></div>
        <div class="grade-2">
          <div class="campo"><label for="m-nome">Nome da cliente</label><input id="m-nome" name="nome" required></div>
          <div class="campo"><label for="m-whats">WhatsApp</label><input id="m-whats" name="whatsapp" type="tel" required></div>
        </div>
        <div class="campo"><label for="m-email">E-mail (opcional, para confirmação e convite)</label><input id="m-email" name="email" type="email"></div>
        <div class="campo"><label for="m-obs">Observações</label><textarea id="m-obs" name="observacoes"></textarea></div>`,
      acoes: (() => {
        const enviar = async (forcar = false) => {
          await api("criar_agendamento", { ...valores(), forcar });
          modal.close(); toast("Agendamento criado."); verAgenda();
        };
        return [{ texto: "Fechar", classe: "btn--claro" }, { texto: "Agendar", acao: () => enviar(false), forcar: () => enviar(true) }];
      })(),
      aoAbrir: () => {
        const atualizar = sugestoes(() => {
          const v = valores();
          return v.profissional_id && v.servico_id && v.data ? { profissional_id: v.profissional_id, servico_id: v.servico_id, data: v.data } : null;
        });
        ["#m-prof", "#m-serv", "#m-data"].forEach((s) => $(s).addEventListener("change", atualizar));
        atualizar();
      },
    });
  }

  function formRemarcar(a) {
    abrirModal({
      titulo: "Remarcar",
      corpo: `
        <p>${esc(a.cliente.nome)}, ${esc(a.servico_nome)}. Hoje marcado para ${esc(fLonga(fData(a.inicio)))} às ${fHora(a.inicio)}.</p>
        <div class="grade-2">
          <div class="campo"><label for="m-prof">Profissional</label><select id="m-prof" name="profissional_id">${opcoes(P.profissionais.filter((p) => p.ativo), a.profissional_id)}</select></div>
          <div class="campo"><label for="m-data">Nova data</label><input id="m-data" name="data" type="date" value="${fData(a.inicio)}" required></div>
          <div class="campo"><label for="m-hora">Novo horário</label><input id="m-hora" name="hora" type="time" step="300" required></div>
        </div>
        <div class="horas-sugestao" id="sugestoes"></div>
        <p class="nota">A cliente recebe o aviso da mudança e o evento é atualizado na agenda Google.</p>`,
      acoes: (() => {
        const enviar = async (forcar = false) => {
          await api("reagendar", { id: a.id, ...valores(), forcar });
          modal.close(); toast("Agendamento remarcado."); verAgenda();
        };
        return [{ texto: "Fechar", classe: "btn--claro" }, { texto: "Remarcar", acao: () => enviar(false), forcar: () => enviar(true) }];
      })(),
      aoAbrir: () => {
        const atualizar = sugestoes(() => {
          const v = valores();
          return v.data ? { profissional_id: v.profissional_id, duracao_min: a.duracao_min, data: v.data, ignorar_id: a.id } : null;
        });
        ["#m-prof", "#m-data"].forEach((s) => $(s).addEventListener("change", atualizar));
        atualizar();
      },
    });
  }

  // ------------------------------------------------------------ CLIENTES
  async function verClientes(busca = "") {
    const { clientes } = await api("clientes", { busca });
    $("#conteudo").innerHTML = `
      <h1>Clientes</h1>
      <div class="barra"><input id="busca" type="search" placeholder="Buscar por nome ou WhatsApp" value="${esc(busca)}" style="flex:1;min-width:220px"></div>
      <div class="bloco">${clientes.length ? `<ul class="lista">${clientes.map((c) => {
        const feitos = c.agendamentos.filter((x) => x.status === "concluido").length;
        const faltas = c.agendamentos.filter((x) => x.status === "faltou").length;
        return `<li>
          <div class="principal"><strong>${esc(c.nome)}</strong>
            <small>${esc(fWhats(c.whatsapp))}${c.email ? ` · ${esc(c.email)}` : ""}</small>
            <small>${c.agendamentos.length} agendamento(s), ${feitos} concluído(s)${faltas ? `, ${faltas} falta(s)` : ""}</small>
            ${c.agendamentos.length ? `<details><summary class="link" style="display:inline-block">Ver histórico</summary><ul class="historico">${c.agendamentos.map((x) =>
              `<li>${fCurta(x.inicio)} ${fHora(x.inicio)}: ${esc(x.servico_nome)} com ${esc(x.profissional?.nome || "")} (${STATUS[x.status][0].toLowerCase()})</li>`).join("")}</ul></details>` : ""}
          </div>
          <a class="link" href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>
        </li>`; }).join("")}</ul>` : `<p class="vazio">Nenhuma cliente encontrada.</p>`}</div>`;
    const campo = $("#busca");
    let t;
    campo.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => verClientes(campo.value).then(() => { const c = $("#busca"); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }), 350); });
  }

  // ------------------------------------------------------------ SERVIÇOS
  async function verServicos() {
    await recarregarPainel();
    $("#conteudo").innerHTML = `
      <div class="barra"><h1 style="margin:0">Serviços</h1><span class="espaco"></span><button class="btn btn--pequeno" id="novo-serv">Novo serviço</button></div>
      <div class="bloco">${P.servicos.length ? `<ul class="lista">${P.servicos.map((s) => `
        <li>
          <div class="principal"><strong>${esc(s.nome)}</strong> ${s.ativo ? "" : `<span class="chip neutro">oculto</span>`}
            <small>${moeda(s.preco)} · ${s.duracao_min} min${s.descricao ? ` · ${esc(s.descricao)}` : ""}</small></div>
          <button class="link" data-editar="${s.id}">Editar</button>
        </li>`).join("")}</ul>` : `<p class="vazio">Cadastre o primeiro serviço para ele aparecer no site.</p>`}</div>`;
    $("#novo-serv").onclick = () => formServico();
    $$("[data-editar]").forEach((b) => (b.onclick = () => formServico(P.servicos.find((s) => s.id === b.dataset.editar))));
  }

  function formServico(s = { ativo: true, ordem: P.servicos.length + 1 }) {
    abrirModal({
      titulo: s.id ? "Editar serviço" : "Novo serviço",
      corpo: `
        <div class="campo"><label for="s-nome">Nome</label><input id="s-nome" name="nome" value="${esc(s.nome)}" required></div>
        <div class="campo"><label for="s-desc">Descrição</label><textarea id="s-desc" name="descricao">${esc(s.descricao)}</textarea></div>
        <div class="grade-2">
          <div class="campo"><label for="s-preco">Preço (R$)</label><input id="s-preco" name="preco" inputmode="decimal" value="${s.preco ?? ""}" required></div>
          <div class="campo"><label for="s-dur">Duração (minutos)</label><input id="s-dur" name="duracao_min" type="number" min="5" max="600" step="5" value="${s.duracao_min ?? 60}" required></div>
          <div class="campo"><label for="s-ordem">Ordem no site</label><input id="s-ordem" name="ordem" type="number" value="${s.ordem ?? 0}"></div>
          <div class="campo"><label for="s-foto">Link da foto (opcional)</label><input id="s-foto" name="foto_url" type="url" value="${esc(s.foto_url)}"></div>
        </div>
        <label class="check"><input type="checkbox" name="ativo" ${s.ativo ? "checked" : ""}> Mostrar no site</label>`,
      acoes: [
        ...(s.id ? [{ texto: "Excluir", classe: "btn--claro", acao: async () => {
          if (!confirm(`Excluir “${s.nome}”? Os agendamentos já feitos continuam no histórico.`)) return;
          await api("excluir_servico", { id: s.id }); modal.close(); toast("Serviço excluído."); verServicos();
        } }] : []),
        { texto: "Salvar", acao: async () => {
          const v = valores();
          await api("salvar_servico", { ...v, id: s.id, ativo: !!v.ativo });
          modal.close(); toast("Serviço salvo."); verServicos();
        } },
      ],
    });
  }

  // ------------------------------------------------------------ HORÁRIOS E BLOQUEIOS
  let profHorario = null;
  async function verHorarios() {
    await recarregarPainel();
    profHorario ??= P.profissionais[0]?.id;
    const faixas = P.horarios.filter((h) => h.profissional_id === profHorario);
    $("#conteudo").innerHTML = `
      <h1>Horários e folgas</h1>
      <div class="bloco">
        <div class="barra">
          <h2 style="margin:0">Expediente de</h2>
          <select id="h-prof">${opcoes(P.profissionais, profHorario)}</select>
        </div>
        <p class="nota" style="margin-top:0">Para um intervalo de almoço, crie duas faixas no mesmo dia (ex.: 09:00 às 12:00 e 13:00 às 19:00). Dia sem faixa é folga.</p>
        <div class="semana" id="semana">${DIAS.map((nome, d) => `
          <div class="dia" data-dia="${d}">
            <strong>${nome}</strong>
            <div class="faixas">
              ${faixas.filter((f) => f.dia_semana === d).map((f) => linhaFaixa(f.inicio.slice(0, 5), f.fim.slice(0, 5))).join("") || `<span class="folga">Folga</span>`}
              <div><button class="link" data-add="${d}">+ faixa</button>${d === 1 ? ` <button class="link" id="copiar">Copiar segunda para terça a sexta</button>` : ""}</div>
            </div>
          </div>`).join("")}</div>
        <div class="barra" style="margin:1rem 0 0"><span class="espaco"></span><button class="btn" id="salvar-h">Salvar horários</button></div>
      </div>

      <div class="bloco">
        <div class="barra"><h2 style="margin:0">Folgas, feriados e bloqueios</h2><span class="espaco"></span><button class="btn btn--pequeno btn--claro" id="novo-bloq">Bloquear período</button></div>
        ${P.bloqueios.length ? `<ul class="lista">${P.bloqueios.map((b) => `
          <li><div class="principal"><strong>${esc(b.motivo || "Bloqueio")}</strong>
            <small>${b.profissional_id ? esc(prof(b.profissional_id)?.nome) : "Estúdio inteiro"}: ${fCurta(b.inicio)} ${fHora(b.inicio)} até ${fCurta(b.fim)} ${fHora(b.fim)}</small></div>
            <button class="link perigo" data-del="${b.id}">Remover</button></li>`).join("")}</ul>`
          : `<p class="vazio">Nenhum bloqueio futuro.</p>`}
      </div>`;

    $("#h-prof").onchange = (e) => { profHorario = e.target.value; verHorarios(); };
    $("#semana").addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      const rem = e.target.closest("[data-rem]");
      if (add) {
        const box = add.closest(".faixas");
        $(".folga", box)?.remove();
        add.parentElement.insertAdjacentHTML("beforebegin", linhaFaixa("09:00", "18:00"));
      }
      if (rem) {
        const box = rem.closest(".faixas");
        rem.closest(".faixa").remove();
        if (!$(".faixa", box)) box.insertAdjacentHTML("afterbegin", `<span class="folga">Folga</span>`);
      }
    });
    $("#copiar").onclick = () => {
      const html = $$(`.dia[data-dia="1"] .faixa`).map((f) => linhaFaixa($("[data-i]", f).value, $("[data-f]", f).value)).join("");
      for (const d of [2, 3, 4, 5]) {
        const box = $(`.dia[data-dia="${d}"] .faixas`);
        $$(".faixa, .folga", box).forEach((x) => x.remove());
        box.insertAdjacentHTML("afterbegin", html || `<span class="folga">Folga</span>`);
      }
    };
    $("#salvar-h").onclick = async (e) => {
      const lista = $$(".dia").flatMap((dia) => $$(".faixa", dia).map((f) => ({
        dia_semana: Number(dia.dataset.dia), inicio: $("[data-i]", f).value, fim: $("[data-f]", f).value,
      })));
      e.target.disabled = true;
      try { await api("salvar_horarios", { profissional_id: profHorario, faixas: lista }); toast("Horários salvos."); await recarregarPainel(); avisos(); }
      catch (err) { toast(err.message); }
      finally { e.target.disabled = false; }
    };
    $("#novo-bloq").onclick = formBloqueio;
    $$("[data-del]").forEach((b) => (b.onclick = async () => {
      await api("excluir_bloqueio", { id: b.dataset.del }); toast("Bloqueio removido."); verHorarios();
    }));
  }
  const linhaFaixa = (i, f) => `<div class="faixa"><input type="time" data-i value="${i}" aria-label="Início"> às <input type="time" data-f value="${f}" aria-label="Fim"><button class="link perigo" data-rem aria-label="Remover faixa">Remover</button></div>`;

  function formBloqueio() {
    abrirModal({
      titulo: "Bloquear período",
      corpo: `
        <div class="campo"><label for="b-prof">Para quem</label><select id="b-prof" name="profissional_id"><option value="">Estúdio inteiro (feriado, recesso)</option>${opcoes(P.profissionais, null)}</select></div>
        <div class="grade-2">
          <div class="campo"><label for="b-di">De (data)</label><input id="b-di" name="data_inicio" type="date" value="${hoje()}" required></div>
          <div class="campo"><label for="b-hi">A partir das (opcional)</label><input id="b-hi" name="hora_inicio" type="time"></div>
          <div class="campo"><label for="b-df">Até (data)</label><input id="b-df" name="data_fim" type="date" value="${hoje()}" required></div>
          <div class="campo"><label for="b-hf">Até as (opcional)</label><input id="b-hf" name="hora_fim" type="time"></div>
        </div>
        <div class="campo"><label for="b-mot">Motivo</label><input id="b-mot" name="motivo" placeholder="Ex.: Feriado, médico, curso"><small>Sem horas, o bloqueio vale para o dia inteiro.</small></div>`,
      acoes: [{ texto: "Fechar", classe: "btn--claro" }, { texto: "Bloquear", acao: async () => {
        await api("salvar_bloqueio", valores()); modal.close(); toast("Período bloqueado."); verHorarios();
      } }],
    });
  }

  // ------------------------------------------------------------ PROFISSIONAIS
  async function verProfissionais() {
    await recarregarPainel(); avisos();
    $("#conteudo").innerHTML = `<h1>Profissionais</h1>${P.profissionais.map((p) => `
      <div class="bloco">
        <div class="prof-card">
          <form data-prof="${p.id}">
            <h2>${esc(p.nome)} ${p.ativo ? "" : `<span class="chip neutro">fora do site</span>`}</h2>
            <div class="grade-2">
              <div class="campo"><label>Nome</label><input name="nome" value="${esc(p.nome)}"></div>
              <div class="campo"><label>WhatsApp</label><input name="whatsapp" value="${esc(fWhats(p.whatsapp))}"></div>
              <div class="campo"><label>Instagram</label><input name="instagram" value="${esc(p.instagram ? "@" + p.instagram : "")}"></div>
              <div class="campo"><label>Ordem no site</label><input name="ordem" type="number" value="${p.ordem}"></div>
            </div>
            <div class="campo"><label>Link da foto</label><input name="foto_url" type="url" value="${esc(p.foto_url)}"></div>
            <div class="campo"><label>Apresentação</label><textarea name="bio">${esc(p.bio)}</textarea></div>
            <label class="check"><input type="checkbox" name="ativo" ${p.ativo ? "checked" : ""}> Aparece no site e recebe agendamentos</label>
            <div class="google" style="margin-bottom:1rem">
              <h3>Aviso no WhatsApp</h3>
              <p>${p.aviso_whatsapp
                ? `Ativo. A ${esc(p.nome)} recebe uma mensagem a cada novo agendamento, remarcação ou cancelamento.`
                : `Para a ${esc(p.nome)} receber uma mensagem a cada agendamento, ela precisa ativar o CallMeBot no celular dela (veja o LEIA-ME) e colar aqui o código que receber.`}</p>
              <div class="campo"><label>Código do CallMeBot (apikey)</label>
                <input name="callmebot_apikey" inputmode="numeric" autocomplete="off" placeholder="${p.aviso_whatsapp ? "Já cadastrado. Preencha só para trocar." : "Ex.: 1234567"}"></div>
              ${p.aviso_whatsapp ? `<label class="check"><input type="checkbox" name="remover_aviso"> Desligar os avisos</label>` : ""}
              <button class="btn btn--claro btn--pequeno" type="button" data-teste="${p.id}" ${p.aviso_whatsapp ? "" : "disabled"}>Enviar mensagem de teste</button>
            </div>
            <button class="btn btn--pequeno" type="submit">Salvar</button>
          </form>
          <div>
            <div class="google">
              <h3>Google Agenda</h3>
              ${p.google.conectado
                ? `<p>Conectada a <strong>${esc(p.google.email || "conta Google")}</strong>. Os agendamentos entram nessa agenda e os compromissos dela bloqueiam horários no site.</p>
                   <button class="btn btn--claro btn--pequeno" data-desc="${p.id}">Desconectar</button>`
                : p.google.status === "reconectar"
                  ? `<p>O acesso expirou ou foi revogado. Conecte de novo para voltar a sincronizar.</p><button class="btn btn--pequeno" data-con="${p.id}">Reconectar</button>`
                  : `<p>Ainda não conectada. Ao conectar, cada agendamento vira um evento na agenda da ${esc(p.nome)} e a cliente recebe o convite.</p>
                     <button class="btn btn--pequeno" data-con="${p.id}" ${P.google_configurado ? "" : "disabled"}>Conectar Google Agenda</button>`}
              <p class="nota">Peça para a ${esc(p.nome)} entrar com a conta Google dela na tela que vai abrir.</p>
            </div>
            <p class="nota">Login no painel: ${p.email ? esc(p.email) : "nenhum e-mail ligado (veja o LEIA-ME)"}</p>
          </div>
        </div>
      </div>`).join("")}`;

    $$("form[data-prof]").forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      try {
        await api("salvar_profissional", { ...v, id: f.dataset.prof, ativo: !!v.ativo, remover_aviso: !!v.remover_aviso });
        toast("Dados salvos.");
        if (v.callmebot_apikey || v.remover_aviso) verProfissionais();
      } catch (err) { toast(err.message); }
    }));
    $$("[data-teste]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = "Enviando…";
      try { await api("testar_whatsapp", { profissional_id: b.dataset.teste }); toast("Teste enviado. Confira o WhatsApp em alguns segundos."); }
      catch (e) { toast(e.message); }
      finally { b.disabled = false; b.textContent = "Enviar mensagem de teste"; }
    }));
    $$("[data-con]").forEach((b) => (b.onclick = async () => {
      try { const { url } = await api("google_url", { profissional_id: b.dataset.con }); location.href = url; }
      catch (e) { toast(e.message); }
    }));
    $$("[data-desc]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Desconectar a agenda Google? Novos agendamentos deixam de ir para lá.")) return;
      await api("google_desconectar", { profissional_id: b.dataset.desc }); toast("Agenda desconectada."); verProfissionais();
    }));
  }

  // ------------------------------------------------------------ ESTÚDIO
  async function verEstudio() {
    await recarregarPainel();
    const c = P.config;
    $("#conteudo").innerHTML = `
      <h1>Estúdio</h1>
      <form class="bloco" id="form-config">
        <h2>Informações</h2>
        <div class="grade-2">
          <div class="campo"><label>Nome</label><input name="nome" value="${esc(c.nome)}"></div>
          <div class="campo"><label>Cidade</label><input name="cidade" value="${esc(c.cidade)}"></div>
        </div>
        <div class="campo"><label>Endereço (rua, número, bairro)</label><input name="endereco" value="${esc(c.endereco)}"><small>Aparece no site, nos e-mails e nos eventos da agenda.</small></div>
        <div class="grade-2">
          <div class="campo"><label>Link do Google Maps</label><input name="maps_url" type="url" value="${esc(c.maps_url)}"></div>
          <div class="campo"><label>Instagram do estúdio</label><input name="instagram" value="${esc(c.instagram)}"></div>
        </div>
        <h2 style="margin-top:1rem">Regras da agenda</h2>
        <div class="grade-2">
          <div class="campo"><label>Horários a cada (minutos)</label><input name="intervalo_slots" type="number" min="5" step="5" value="${esc(c.intervalo_slots)}"></div>
          <div class="campo"><label>Antecedência mínima (minutos)</label><input name="antecedencia_min" type="number" min="0" step="15" value="${esc(c.antecedencia_min)}"></div>
          <div class="campo"><label>Agenda aberta por (dias)</label><input name="dias_max" type="number" min="1" value="${esc(c.dias_max)}"></div>
          <div class="campo"><label>Segundo lembrete (horas antes)</label><input name="lembrete_curto_horas" type="number" min="1" max="12" value="${esc(c.lembrete_curto_horas)}"></div>
        </div>
        <button class="btn btn--pequeno" type="submit">Salvar</button>
      </form>
      <div class="bloco">
        <div class="barra"><h2 style="margin:0">Depoimentos</h2><span class="espaco"></span><button class="btn btn--pequeno btn--claro" id="novo-dep">Adicionar</button></div>
        <p class="nota" style="margin-top:0">Use depoimentos reais, com a autorização da cliente. A seção só aparece no site quando houver algum.</p>
        ${P.depoimentos.length ? `<ul class="lista">${P.depoimentos.map((d) => `
          <li><div class="principal"><strong>${esc(d.nome)}</strong> ${d.visivel ? "" : `<span class="chip neutro">oculto</span>`}<small>${esc(d.texto)}</small></div>
          <button class="link" data-dep="${d.id}">Editar</button></li>`).join("")}</ul>` : ""}
      </div>`;
    $("#form-config").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("salvar_config", { config: Object.fromEntries(new FormData(e.target)) }); toast("Informações salvas."); }
      catch (err) { toast(err.message); }
    });
    $("#novo-dep").onclick = () => formDepoimento();
    $$("[data-dep]").forEach((b) => (b.onclick = () => formDepoimento(P.depoimentos.find((d) => d.id === b.dataset.dep))));
  }

  function formDepoimento(d = { visivel: true, ordem: 0 }) {
    abrirModal({
      titulo: d.id ? "Editar depoimento" : "Novo depoimento",
      corpo: `
        <div class="campo"><label>Nome da cliente</label><input name="nome" value="${esc(d.nome)}"></div>
        <div class="campo"><label>Depoimento</label><textarea name="texto">${esc(d.texto)}</textarea></div>
        <div class="campo"><label>Ordem</label><input name="ordem" type="number" value="${d.ordem}"></div>
        <label class="check"><input type="checkbox" name="visivel" ${d.visivel ? "checked" : ""}> Mostrar no site</label>`,
      acoes: [
        ...(d.id ? [{ texto: "Excluir", classe: "btn--claro", acao: async () => {
          await api("excluir_depoimento", { id: d.id }); modal.close(); toast("Depoimento excluído."); verEstudio();
        } }] : []),
        { texto: "Salvar", acao: async () => {
          const v = valores();
          await api("salvar_depoimento", { ...v, id: d.id, visivel: !!v.visivel });
          modal.close(); toast("Depoimento salvo."); verEstudio();
        } },
      ],
    });
  }

  // ------------------------------------------------------------ início
  sessao ? iniciar() : mostrarLogin();
})();
