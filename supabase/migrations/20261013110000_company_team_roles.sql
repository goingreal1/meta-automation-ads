alter table companies add column if not exists team_roles text[] not null default '{}';
