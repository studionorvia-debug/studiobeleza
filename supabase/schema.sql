-- =============================================================
-- STUDIO BELEZA — Banco de dados (Supabase / PostgreSQL)
-- Cole tudo no SQL Editor do Supabase e clique em "Run".
-- =============================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- Profissionais ------------------------------------------------
create table if not exists profissionais (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  slug                  text unique not null,
  email                 text unique,                 -- e-mail de login no painel (minúsculo)
  whatsapp              text,                        -- só números, com 55 + DDD
  instagram             text,
  bio                   text,
  foto_url              text,
  ativo                 boolean not null default true,
  ordem                 int not null default 0,
  google_email          text,
  google_refresh_token  text,                        -- criptografado (AES-256-GCM)
  google_calendar_id    text not null default 'primary',
  google_status         text,                        -- null | ok | reconectar
  criado_em             timestamptz not null default now()
);

-- Serviços -----------------------------------------------------
create table if not exists servicos (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  descricao    text,
  preco        numeric(10,2) not null default 0,
  duracao_min  int not null check (duracao_min between 5 and 600),
  foto_url     text,
  ativo        boolean not null default true,
  ordem        int not null default 0,
  criado_em    timestamptz not null default now()
);

-- Horários de atendimento (várias faixas por dia = intervalos) --
create table if not exists horarios (
  id               uuid primary key default gen_random_uuid(),
  profissional_id  uuid not null references profissionais(id) on delete cascade,
  dia_semana       int not null check (dia_semana between 0 and 6),  -- 0 = domingo
  inicio           time not null,
  fim              time not null,
  check (fim > inicio)
);
create index if not exists horarios_prof_idx on horarios(profissional_id, dia_semana);

-- Bloqueios: folgas, feriados, compromissos (profissional nula = estúdio inteiro)
create table if not exists bloqueios (
  id               uuid primary key default gen_random_uuid(),
  profissional_id  uuid references profissionais(id) on delete cascade,
  inicio           timestamptz not null,
  fim              timestamptz not null,
  motivo           text,
  criado_em        timestamptz not null default now(),
  check (fim > inicio)
);
create index if not exists bloqueios_periodo_idx on bloqueios(inicio, fim);

-- Clientes -----------------------------------------------------
create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  whatsapp   text not null unique,
  email      text,
  criado_em  timestamptz not null default now()
);

-- Agendamentos -------------------------------------------------
create table if not exists agendamentos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete restrict,
  profissional_id     uuid not null references profissionais(id) on delete restrict,
  servico_id          uuid references servicos(id) on delete set null,
  servico_nome        text not null,
  servico_preco       numeric(10,2),
  duracao_min         int not null,
  inicio              timestamptz not null,
  fim                 timestamptz not null,
  status              text not null default 'confirmado'
                      check (status in ('confirmado','cancelado','concluido','faltou')),
  origem              text not null default 'site',   -- site | painel
  observacoes         text,
  google_event_id     text,
  lembrete_24h_em     timestamptz,
  lembrete_curto_em   timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  check (fim > inicio),
  -- Impede dois atendimentos sobrepostos para a mesma profissional,
  -- mesmo que duas clientes cliquem no mesmo segundo.
  constraint sem_conflito exclude using gist (
    profissional_id with =,
    tstzrange(inicio, fim, '[)') with &&
  ) where (status in ('confirmado','concluido'))
);
create index if not exists agendamentos_inicio_idx on agendamentos(inicio);
create index if not exists agendamentos_cliente_idx on agendamentos(cliente_id);

-- Depoimentos (só aparecem no site quando cadastrados) ---------
create table if not exists depoimentos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  texto      text not null,
  visivel    boolean not null default true,
  ordem      int not null default 0,
  criado_em  timestamptz not null default now()
);

-- Configurações do estúdio (chave/valor) -----------------------
create table if not exists config (
  chave  text primary key,
  valor  text
);

-- Segurança: RLS ligado e nenhuma política pública.
-- Todo acesso passa pelas funções do servidor (chave service_role).
alter table profissionais enable row level security;
alter table servicos      enable row level security;
alter table horarios      enable row level security;
alter table bloqueios     enable row level security;
alter table clientes      enable row level security;
alter table agendamentos  enable row level security;
alter table depoimentos   enable row level security;
alter table config        enable row level security;

-- Dados iniciais -----------------------------------------------
-- Confira se cada número de WhatsApp está com a profissional certa.
insert into profissionais (nome, slug, whatsapp, instagram, ordem) values
  ('Manu',   'manu',   '5524981082665', 'emanueleportes', 1),
  ('Mylena', 'mylena', '5522981049534', 'mylena__veiga',  2)
on conflict (slug) do nothing;

insert into config (chave, valor) values
  ('nome',                 'Studio Beleza'),
  ('cidade',               'Miguel Pereira – RJ'),
  ('endereco',             ''),
  ('maps_url',             ''),
  ('instagram',            'studiobelezaesmalteria'),
  ('intervalo_slots',      '30'),   -- de quantos em quantos minutos os horários aparecem
  ('antecedencia_min',     '120'),  -- antecedência mínima para agendar (minutos)
  ('dias_max',             '60'),   -- até quantos dias à frente a agenda abre
  ('lembrete_curto_horas', '3')     -- lembrete "algumas horas antes"
on conflict (chave) do nothing;

-- Depois de criar os usuários em Authentication > Users, ligue cada
-- e-mail à sua profissional (sempre em letras minúsculas):
-- update profissionais set email = 'email.da.manu@gmail.com'   where slug = 'manu';
-- update profissionais set email = 'email.da.mylena@gmail.com' where slug = 'mylena';
