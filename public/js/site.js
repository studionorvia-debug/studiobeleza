(() => {
  "use strict";

  const TZ = "America/Sao_Paulo";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const moeda = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const duracao = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`);
  const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dataLonga = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00-03:00`));
  const fmtWhats = (n) => {
    const d = String(n || "").replace(/\D/g, "").replace(/^55/, "");
    return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : n;
  };

  async function api(caminho, opcoes) {
    const r = await fetch(caminho, opcoes);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "Não foi possível falar com o servidor."), { status: r.status });
    return j;
  }

  // ---------------------------------------------------------------- site
  let catalogo = { servicos: [], profissionais: [], depoimentos: [], estudio: {} };

  document.getElementById("ano").textContent = new Date().getFullYear();
  const topo = document.getElementById("topo");
  addEventListener("scroll", () => topo.classList.toggle("rolou", scrollY > 8), { passive: true });

  function renderSite() {
    const { servicos, profissionais, depoimentos, estudio } = catalogo;

    const lista = document.getElementById("lista-servicos");
    lista.innerHTML = servicos.length
      ? servicos.map((s) => `
        <li><button class="item-servico" data-servico="${esc(s.id)}">
          <span class="nome">${esc(s.nome)}</span>
          <span class="preco">${moeda(s.preco)}</span>
          <span class="desc">${s.descricao ? esc(s.descricao) + " " : ""}<span class="tempo">${duracao(s.duracao_min)}</span></span>
        </button></li>`).join("")
      : `<li class="vazio">Os serviços serão publicados em breve.</li>`;

    document.getElementById("lista-profissionais").innerHTML = profissionais.map((p) => `
      <article class="prof">
        <div class="arco">
          ${p.foto_url ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nome)}" loading="lazy">` : ""}
          <div class="monograma" aria-hidden="true">${esc(p.nome[0])}</div>
        </div>
        <h3>${esc(p.nome)}</h3>
        ${p.instagram ? `<a class="insta" href="https://instagram.com/${esc(p.instagram)}" target="_blank" rel="noopener">@${esc(p.instagram)}</a>` : ""}
        ${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
        <button class="btn btn--claro" data-agendar-com="${esc(p.id)}">Agendar com a ${esc(p.nome)}</button>
      </article>`).join("");

    if (depoimentos.length) {
      document.getElementById("depoimentos").hidden = false;
      document.getElementById("link-depoimentos").hidden = false;
      document.getElementById("lista-depoimentos").innerHTML = depoimentos.map((d) => `
        <figure class="depoimento"><blockquote>${esc(d.texto)}</blockquote><cite>${esc(d.nome)}</cite></figure>`).join("");
    }

    if (estudio.cidade) document.querySelectorAll("[data-cidade]").forEach((e) => (e.textContent = estudio.cidade));
    const end = [estudio.endereco, estudio.cidade].filter(Boolean).join(", ");
    document.getElementById("endereco").innerHTML = end
      ? `${esc(end)}${estudio.maps_url ? `<br><a href="${esc(estudio.maps_url)}" target="_blank" rel="noopener">Abrir no mapa</a>` : ""}`
      : esc(estudio.cidade || "");
    if (estudio.instagram) {
      const a = document.getElementById("insta-estudio");
      a.href = `https://instagram.com/${estudio.instagram}`;
      a.textContent = `@${estudio.instagram}`;
    }

    const comZap = profissionais.filter((p) => p.whatsapp);
    const msg = encodeURIComponent("Oi! Vim pelo site do Studio Beleza.");
    document.getElementById("zap-menu").innerHTML = comZap.map((p) =>
      `<a role="menuitem" href="https://wa.me/${esc(p.whatsapp)}?text=${msg}" target="_blank" rel="noopener">Falar com a ${esc(p.nome)}<br><small>${esc(fmtWhats(p.whatsapp))}</small></a>`).join("");
    document.getElementById("zap").hidden = !comZap.length;
    document.getElementById("botoes-contato").insertAdjacentHTML("beforeend", comZap.map((p) =>
      `<a class="btn btn--claro" href="https://wa.me/${esc(p.whatsapp)}?text=${msg}" target="_blank" rel="noopener">WhatsApp da ${esc(p.nome)}</a>`).join(""));
  }

  const carregado = api("/api/catalogo")
    .then((j) => { catalogo = j; renderSite(); })
    .catch(() => {
      document.getElementById("lista-servicos").innerHTML = `<li class="vazio">Não foi possível carregar os serviços. Atualize a página.</li>`;
    });

  // WhatsApp flutuante
  const zap = document.getElementById("zap");
  zap.querySelector("button").addEventListener("click", (e) => {
    const aberto = zap.classList.toggle("aberto");
    e.currentTarget.setAttribute("aria-expanded", aberto);
  });
  document.addEventListener("click", (e) => { if (!zap.contains(e.target)) zap.classList.remove("aberto"); });

  // ---------------------------------------------------------------- agendamento
  const el = {
    raiz: $("#agenda"), titulo: $("#ag-titulo"), corpo: $("#ag-corpo"), rodape: $("#ag-rodape"),
    continuar: $("#ag-continuar"), voltar: $("#ag-voltar"), fechar: $("#ag-fechar"),
    passos: [...document.querySelectorAll("#ag-passos span")], rotulo: $("#ag-rotulo"),
  };
  const TITULOS = ["Escolha o serviço", "Com quem?", "Data e horário", "Seus dados", "Confira e confirme"];
  let st;
  let ultimoFoco = null;

  const salvos = (() => { try { return JSON.parse(localStorage.getItem("sb-cliente") || "{}"); } catch { return {}; } })();

  function novoEstado() {
    return { passo: 0, servico: null, prof: null, mes: hoje().slice(0, 7), cache: {}, data: null, hora: null, slot: null,
      dados: { nome: salvos.nome || "", whatsapp: salvos.whatsapp || "", email: salvos.email || "", observacoes: "" } };
  }

  async function abrir({ servico = null, prof = null } = {}) {
    await carregado;
    st = novoEstado();
    if (prof) st.prof = prof;
    if (servico) { st.servico = catalogo.servicos.find((s) => s.id === servico) || null; }
    st.passo = st.servico ? (st.prof ? 2 : 1) : 0;
    ultimoFoco = document.activeElement;
    el.raiz.classList.add("aberta");
    el.raiz.setAttribute("aria-hidden", "false");
    document.body.classList.add("travado");
    if (location.hash !== "#agendar") history.pushState({ agenda: true }, "", "#agendar");
    render();
  }
  function fechar(daHistoria = false) {
    el.raiz.classList.remove("aberta");
    el.raiz.setAttribute("aria-hidden", "true");
    document.body.classList.remove("travado");
    if (!daHistoria && location.hash === "#agendar") history.back();
    ultimoFoco?.focus?.();
  }
  addEventListener("popstate", () => { if (el.raiz.classList.contains("aberta")) fechar(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el.raiz.classList.contains("aberta")) fechar(); });
  el.fechar.addEventListener("click", () => fechar());
  el.raiz.addEventListener("click", (e) => { if (e.target === el.raiz) fechar(); });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-agendar]");
    const s = e.target.closest("[data-servico]");
    const p = e.target.closest("[data-agendar-com]");
    if (a) abrir();
    else if (s) abrir({ servico: s.dataset.servico });
    else if (p) abrir({ prof: p.dataset.agendarCom });
  });

  el.voltar.addEventListener("click", () => {
    if (st.passo === 2) { st.data = null; st.hora = null; }
    st.passo = Math.max(0, st.passo - 1);
    render();
  });

  function cabecalho() {
    const final = st.passo > 4;
    el.titulo.textContent = final ? "Tudo certo" : TITULOS[st.passo];
    el.passos.forEach((s, i) => s.classList.toggle("feito", i <= st.passo));
    el.rotulo.textContent = final ? "Agendamento concluído" : `Etapa ${st.passo + 1} de 5`;
    el.voltar.hidden = st.passo === 0 || final;
    el.corpo.scrollTop = 0;
  }

  function render() {
    cabecalho();
    el.rodape.hidden = true;
    [passoServico, passoProf, passoData, passoDados, passoConfirmar, () => {}][st.passo]();
    el.corpo.focus({ preventScroll: true });
  }

  // Etapa 1 — serviço
  function passoServico() {
    if (!catalogo.servicos.length) {
      el.corpo.innerHTML = `<p class="vazio">Ainda não há serviços disponíveis para agendar online. Fale com a gente pelo WhatsApp.</p>`;
      return;
    }
    el.corpo.innerHTML = `<div class="opcoes">${catalogo.servicos.map((s) => `
      <button class="opcao ${s.foto_url ? "" : "opcao--sem-foto"}" data-id="${esc(s.id)}" aria-pressed="${st.servico?.id === s.id}">
        ${s.foto_url ? `<span class="foto"><img src="${esc(s.foto_url)}" alt=""></span>` : ""}
        <span><strong>${esc(s.nome)}</strong>${s.descricao ? `<small>${esc(s.descricao)}</small>` : ""}</span>
        <span class="lado"><b>${moeda(s.preco)}</b><small>${duracao(s.duracao_min)}</small></span>
      </button>`).join("")}</div>`;
    el.corpo.querySelectorAll(".opcao").forEach((b) => b.addEventListener("click", () => {
      st.servico = catalogo.servicos.find((s) => s.id === b.dataset.id);
      st.data = st.hora = st.slot = null; st.cache = {};
      st.passo = 1; render();
    }));
  }

  // Etapa 2 — profissional
  function passoProf() {
    const op = [...catalogo.profissionais.map((p) => ({ id: p.id, nome: p.nome, foto: p.foto_url, info: p.instagram ? `@${p.instagram}` : "" })),
      { id: "qualquer", nome: "Qualquer profissional disponível", info: "Mostra todos os horários livres das duas" }];
    el.corpo.innerHTML = `<div class="opcoes">${op.map((p) => `
      <button class="opcao" data-id="${esc(p.id)}" aria-pressed="${st.prof === p.id}">
        <span class="foto">${p.foto ? `<img src="${esc(p.foto)}" alt="">` : p.id === "qualquer" ? "✦" : esc(p.nome[0])}</span>
        <span><strong>${esc(p.nome)}</strong>${p.info ? `<small>${esc(p.info)}</small>` : ""}</span>
        <span class="lado"><svg width="20" height="20" aria-hidden="true"><use href="#i-prox"/></svg></span>
      </button>`).join("")}</div>`;
    el.corpo.querySelectorAll(".opcao").forEach((b) => b.addEventListener("click", () => {
      if (st.prof !== b.dataset.id) { st.data = st.hora = st.slot = null; st.cache = {}; }
      st.prof = b.dataset.id;
      st.passo = 2; render();
    }));
  }

  // Etapa 3 — data e horário
  const chaveMes = () => `${st.servico.id}|${st.prof}|${st.mes}`;
  async function carregarMes() {
    const k = chaveMes();
    if (st.cache[k]) return st.cache[k];
    const [a, m] = st.mes.split("-").map(Number);
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const q = new URLSearchParams({ servico: st.servico.id, profissional: st.prof, de: `${st.mes}-01`, ate: `${st.mes}-${String(ultimo).padStart(2, "0")}` });
    const j = await api(`/api/disponibilidade?${q}`);
    st.cache[k] = j.dias;
    return j.dias;
  }

  async function passoData() {
    const [a, m] = st.mes.split("-").map(Number);
    const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 15))).replace(/^./, (c) => c.toUpperCase());
    const noMesAtual = st.mes <= hoje().slice(0, 7);
    el.corpo.innerHTML = `
      <div class="cal-topo">
        <button class="icone" id="mes-ant" aria-label="Mês anterior" ${noMesAtual ? "disabled" : ""}><svg><use href="#i-voltar"/></svg></button>
        <h3 aria-live="polite">${esc(nomeMes)}</h3>
        <button class="icone" id="mes-prox" aria-label="Próximo mês"><svg><use href="#i-prox"/></svg></button>
      </div>
      <div class="cal" id="cal">${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((d) => `<span class="dsem">${d}</span>`).join("")}</div>
      <p class="cal-aviso" id="cal-aviso"></p>
      <div id="horas-area"></div>`;
    $("#mes-ant").addEventListener("click", () => mudarMes(-1));
    $("#mes-prox").addEventListener("click", () => mudarMes(1));

    const cal = $("#cal");
    const aviso = $("#cal-aviso");
    aviso.textContent = "Procurando horários livres…";
    let dias = {};
    try { dias = await carregarMes(); aviso.textContent = ""; }
    catch (e) { aviso.textContent = e.message; }
    if (!el.raiz.classList.contains("aberta") || st.passo !== 2) return;

    const primeiroDia = new Date(Date.UTC(a, m - 1, 1)).getUTCDay();
    const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const h = hoje();
    let html = "";
    for (let i = 0; i < primeiroDia; i++) html += "<span></span>";
    for (let d = 1; d <= total; d++) {
      const data = `${st.mes}-${String(d).padStart(2, "0")}`;
      const livre = !!dias[data]?.length;
      html += `<button data-dia="${data}" class="${livre ? "livre" : ""} ${data === h ? "hoje" : ""}" ${livre ? "" : "disabled"}
        aria-pressed="${st.data === data}" aria-label="${dataLonga(data)}${livre ? ", com horários livres" : ", sem horários"}">${d}</button>`;
    }
    cal.insertAdjacentHTML("beforeend", html);
    if (!Object.keys(dias).length && !aviso.textContent) aviso.textContent = "Nenhum horário livre neste mês. Veja o próximo.";

    cal.querySelectorAll("button[data-dia]").forEach((b) => b.addEventListener("click", () => {
      st.data = b.dataset.dia; st.hora = null; st.slot = null;
      cal.querySelectorAll("button[data-dia]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      mostrarHoras(dias[st.data] || []);
    }));
    if (st.data && dias[st.data]) mostrarHoras(dias[st.data]);
  }

  function mudarMes(delta) {
    const [a, m] = st.mes.split("-").map(Number);
    const d = new Date(Date.UTC(a, m - 1 + delta, 1));
    st.mes = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    st.data = st.hora = st.slot = null;
    passoData();
  }

  function mostrarHoras(slots) {
    const area = $("#horas-area");
    area.innerHTML = `<h4 class="horas-titulo">${esc(dataLonga(st.data))}</h4>
      <div class="horas" role="group" aria-label="Horários livres">${slots.map((s) =>
        `<button data-hora="${s.hora}" aria-pressed="${st.hora === s.hora}">${s.hora}</button>`).join("")}</div>`;
    const preparar = () => {
      el.rodape.hidden = false;
      el.continuar.textContent = `Continuar com ${st.hora}`;
      el.continuar.disabled = false;
      el.continuar.onclick = () => { st.passo = 3; render(); };
    };
    area.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      st.hora = b.dataset.hora;
      st.slot = slots.find((s) => s.hora === st.hora);
      area.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      preparar();
    }));
    if (st.hora && slots.some((s) => s.hora === st.hora)) preparar();
    area.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }

  // Etapa 4 — dados
  function passoDados() {
    const d = st.dados;
    el.corpo.innerHTML = `
      <form id="form-dados" novalidate>
        <div class="alerta" id="dados-erro" role="alert" hidden></div>
        <div class="campo"><label for="f-nome">Nome completo</label>
          <input id="f-nome" name="nome" autocomplete="name" required value="${esc(d.nome)}"></div>
        <div class="campo"><label for="f-whats">WhatsApp com DDD</label>
          <input id="f-whats" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(24) 99999-9999" required value="${esc(d.whatsapp)}"></div>
        <div class="campo"><label for="f-email">E-mail</label>
          <input id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(d.email)}">
          <small class="nota" style="margin:0">Você recebe a confirmação e o convite para a sua agenda.</small></div>
        <div class="campo"><label for="f-obs">Alguma observação? (opcional)</label>
          <textarea id="f-obs" name="observacoes" maxlength="500">${esc(d.observacoes)}</textarea></div>
        <input class="isca" name="empresa" tabindex="-1" autocomplete="off" aria-hidden="true">
      </form>`;
    const whats = $("#f-whats");
    whats.addEventListener("input", () => {
      const n = whats.value.replace(/\D/g, "").slice(0, 11);
      whats.value = n.length > 6 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : n.length > 2 ? `(${n.slice(0, 2)}) ${n.slice(2)}` : n;
    });
    el.rodape.hidden = false;
    el.continuar.disabled = false;
    el.continuar.textContent = "Revisar agendamento";
    el.continuar.onclick = () => {
      const f = $("#form-dados");
      const v = Object.fromEntries(new FormData(f));
      const erroEl = $("#dados-erro");
      const digitos = v.whatsapp.replace(/\D/g, "");
      let msg = "";
      if (v.nome.trim().split(/\s+/).length < 2) msg = "Escreva seu nome e sobrenome.";
      else if (digitos.length < 10 || digitos.length > 11) msg = "Confira o WhatsApp: DDD + número.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) msg = "Confira o e-mail.";
      if (msg) { erroEl.textContent = msg; erroEl.hidden = false; return; }
      st.dados = { nome: v.nome.trim(), whatsapp: v.whatsapp, email: v.email.trim(), observacoes: v.observacoes.trim(), empresa: v.empresa };
      st.passo = 4; render();
    };
  }

  // Etapa 5 — confirmação
  function nomeProf() {
    if (st.prof !== "qualquer") return catalogo.profissionais.find((p) => p.id === st.prof)?.nome;
    const ids = st.slot?.profissionais || [];
    return ids.length === 1 ? catalogo.profissionais.find((p) => p.id === ids[0])?.nome : "A primeira disponível";
  }
  function passoConfirmar() {
    const s = st.servico;
    el.corpo.innerHTML = `
      <div class="alerta" id="conf-erro" role="alert" hidden></div>
      <dl class="resumo">
        <div><dt>Serviço</dt><dd>${esc(s.nome)}</dd></div>
        <div><dt>Profissional</dt><dd>${esc(nomeProf())}</dd></div>
        <div><dt>Data</dt><dd>${esc(dataLonga(st.data))}</dd></div>
        <div><dt>Horário</dt><dd>${esc(st.hora)} (${duracao(s.duracao_min)})</dd></div>
        <div><dt>Valor</dt><dd>${moeda(s.preco)}</dd></div>
        <div><dt>Nome</dt><dd>${esc(st.dados.nome)}</dd></div>
        <div><dt>WhatsApp</dt><dd>${esc(st.dados.whatsapp)}</dd></div>
        <div><dt>E-mail</dt><dd>${esc(st.dados.email)}</dd></div>
      </dl>
      <p class="nota">O pagamento é feito no estúdio, no dia do atendimento.</p>`;
    el.rodape.hidden = false;
    el.continuar.disabled = false;
    el.continuar.textContent = "Confirmar agendamento";
    el.continuar.onclick = confirmar;
  }

  async function confirmar() {
    el.continuar.disabled = true;
    el.continuar.textContent = "Agendando…";
    const erroEl = $("#conf-erro");
    try {
      const j = await api("/api/agendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          servico_id: st.servico.id, profissional_id: st.prof, data: st.data, hora: st.hora, ...st.dados,
        }),
      });
      try { localStorage.setItem("sb-cliente", JSON.stringify({ nome: st.dados.nome, whatsapp: st.dados.whatsapp, email: st.dados.email })); } catch {}
      sucesso(j.agendamento);
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.hidden = false;
      el.continuar.disabled = false;
      if (e.status === 409) {
        st.cache = {};
        el.continuar.textContent = "Escolher outro horário";
        el.continuar.onclick = () => { st.hora = st.slot = null; st.passo = 2; render(); };
      } else {
        el.continuar.textContent = "Tentar de novo";
      }
    }
  }

  // Tela final
  const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  function sucesso(ag) {
    st.passo = 5;
    cabecalho();
    el.rodape.hidden = true;
    const e = catalogo.estudio;
    const local = [e.nome, e.endereco, e.cidade].filter(Boolean).join(", ");
    const titulo = `${ag.servico} – Studio Beleza`;
    const detalhes = `Profissional: ${ag.profissional}\nDuração: ${duracao(ag.duracao_min)}`;
    const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({
      action: "TEMPLATE", text: titulo, dates: `${utc(ag.inicio)}/${utc(ag.fim)}`, details: detalhes, location: local })}`;
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Studio Beleza//PT", "BEGIN:VEVENT",
      `UID:${ag.id}@studiobeleza`, `DTSTAMP:${utc(Date.now())}`, `DTSTART:${utc(ag.inicio)}`, `DTEND:${utc(ag.fim)}`,
      `SUMMARY:${titulo}`, `LOCATION:${local.replace(/,/g, "\\,")}`, `DESCRIPTION:${detalhes.replace(/\n/g, "\\n")}`,
      "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Lembrete", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const icsUrl = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const data = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ag.inicio));
    const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ag.inicio));

    el.corpo.innerHTML = `
      <div class="sucesso">
        <div class="selo"><svg aria-hidden="true"><use href="#i-ok"/></svg></div>
        <h3>Seu horário foi agendado com sucesso! 💗</h3>
        <p>Estamos esperando por você no Studio Beleza!</p>
        <dl class="resumo">
          <div><dt>Serviço</dt><dd>${esc(ag.servico)}</dd></div>
          <div><dt>Com</dt><dd>${esc(ag.profissional)}</dd></div>
          <div><dt>Quando</dt><dd>${esc(dataLonga(data))}, ${esc(hora)}</dd></div>
        </dl>
        <p class="nota">${ag.convite_enviado
          ? `Enviamos um convite para ${esc(st.dados.email)}. Aceite o convite para o horário aparecer na sua agenda.`
          : `Enviamos a confirmação para ${esc(st.dados.email)}.`}</p>
        <div class="acoes">
          ${ag.convite_enviado ? "" : `<a class="btn" href="${esc(google)}" target="_blank" rel="noopener">Adicionar ao Google Agenda</a>`}
          <a class="btn btn--claro" href="${icsUrl}" download="studio-beleza.ics">Salvar na agenda do celular</a>
          <button class="btn btn--claro" id="fim-voltar">Voltar ao site</button>
        </div>
      </div>`;
    $("#fim-voltar").addEventListener("click", () => fechar());
  }

  if (location.hash === "#agendar") { history.replaceState(null, "", location.pathname); abrir(); }
})();
