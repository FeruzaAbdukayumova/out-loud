create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- only a hash of each token is stored, so a database leak doesn't hand out live sessions
create table sessions (
  token_hash text primary key,
  user_id uuid not null references users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

-- one counter across all synced tables: a client asks for "everything after N"
create sequence sync_seq;

create table texts (
  user_id uuid not null references users on delete cascade,
  id text not null,
  title text not null,
  body text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  seq bigint not null default nextval('sync_seq'),
  primary key (user_id, id)
);
create index texts_seq on texts (user_id, seq);

create table attempts (
  user_id uuid not null references users on delete cascade,
  id text not null,
  text_id text not null,
  at bigint not null,
  score int not null,
  read int not null,
  total int not null,
  practice jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  seq bigint not null default nextval('sync_seq'),
  primary key (user_id, id)
);
create index attempts_seq on attempts (user_id, seq);

create table cards (
  user_id uuid not null references users on delete cascade,
  word text not null,
  box int not null,
  due bigint not null,
  misses int not null,
  example text not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  seq bigint not null default nextval('sync_seq'),
  primary key (user_id, word)
);
create index cards_seq on cards (user_id, seq);

create table client_errors (
  id bigserial primary key,
  user_id uuid references users on delete set null,
  message text not null,
  stack text,
  url text,
  user_agent text,
  created_at timestamptz not null default now()
);
