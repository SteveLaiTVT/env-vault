CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  kdf_salt text NOT NULL,
  kdf_memory integer NOT NULL,
  kdf_iterations integer NOT NULL,
  kdf_parallelism integer NOT NULL,
  auth_salt text NOT NULL,
  auth_hash text NOT NULL,
  wrapped_dek text NOT NULL,
  dek_iv text NOT NULL,
  org_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servers (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id text,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id text,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS project_servers (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  PRIMARY KEY (project_id, server_id)
);

CREATE TABLE IF NOT EXISTS variables (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id text,
  scope_type text NOT NULL CHECK (scope_type IN ('public', 'server', 'project')),
  server_id text REFERENCES servers(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  value_cipher text NOT NULL,
  value_iv text NOT NULL,
  note_cipher text,
  note_iv text,
  type text NOT NULL CHECK (type IN ('secret', 'plain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_type = 'public' AND server_id IS NULL AND project_id IS NULL) OR
    (scope_type = 'server' AND server_id IS NOT NULL AND project_id IS NULL) OR
    (scope_type = 'project' AND project_id IS NOT NULL AND server_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS variables_public_key ON variables (user_id, key) WHERE scope_type = 'public';
CREATE UNIQUE INDEX IF NOT EXISTS variables_server_key ON variables (user_id, server_id, key) WHERE scope_type = 'server';
CREATE UNIQUE INDEX IF NOT EXISTS variables_project_key ON variables (user_id, project_id, key) WHERE scope_type = 'project';

CREATE TABLE IF NOT EXISTS variable_versions (
  id text PRIMARY KEY,
  variable_id text NOT NULL REFERENCES variables(id) ON DELETE CASCADE,
  value_cipher text NOT NULL,
  value_iv text NOT NULL,
  note_cipher text,
  note_iv text,
  type text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL,
  result text NOT NULL,
  scope_type text,
  scope_name text,
  key_name text,
  token_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_created ON audit_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS machine_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  public_id text NOT NULL UNIQUE,
  auth_secret_hash text NOT NULL,
  public_key_spki text NOT NULL,
  wrapped_dek text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('public', 'server', 'project')),
  server_id text REFERENCES servers(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  can_inject boolean NOT NULL,
  can_replace boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (can_inject OR can_replace),
  CHECK (
    (scope_type = 'public' AND server_id IS NULL AND project_id IS NULL) OR
    (scope_type = 'server' AND server_id IS NOT NULL AND project_id IS NULL) OR
    (scope_type = 'project' AND project_id IS NOT NULL AND server_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS templates (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  body_cipher text NOT NULL,
  body_iv text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
