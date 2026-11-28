BEGIN;
CREATE SCHEMA feature_board;
REVOKE ALL ON SCHEMA feature_board FROM PUBLIC;

CREATE TABLE feature_board.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  vote_limit integer CHECK (vote_limit BETWEEN 1 AND 1000)
);
INSERT INTO feature_board.settings DEFAULT VALUES;

CREATE TABLE feature_board.requests (
  id uuid PRIMARY KEY,
  author_id text,
  display_name text,
  title text NOT NULL,
  title_key text NOT NULL,
  use_case text NOT NULL,
  category text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'New' CHECK (status IN ('New','Under review','Planned','In progress','Shipped','Not planned')),
  release_url text,
  has_image boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  merged_into uuid REFERENCES feature_board.requests(id),
  retained_votes integer NOT NULL DEFAULT 0 CHECK (retained_votes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX board_active_titles ON feature_board.requests(title_key) WHERE NOT hidden AND merged_into IS NULL;
CREATE INDEX board_request_author ON feature_board.requests(author_id);

CREATE TABLE feature_board.participation (
  request_id uuid NOT NULL REFERENCES feature_board.requests(id),
  actor_id text NOT NULL,
  voted boolean NOT NULL DEFAULT false,
  following boolean NOT NULL DEFAULT false,
  PRIMARY KEY(request_id,actor_id)
);
CREATE INDEX board_participation_actor ON feature_board.participation(actor_id);

CREATE TABLE feature_board.comments (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES feature_board.requests(id),
  author_id text,
  display_name text,
  body text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_comment_request ON feature_board.comments(request_id,created_at);
CREATE INDEX board_comment_author ON feature_board.comments(author_id);

CREATE TABLE feature_board.history (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES feature_board.requests(id),
  actor_id text,
  status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_history_request ON feature_board.history(request_id,created_at);

CREATE TABLE feature_board.inbox (
  event_id uuid NOT NULL REFERENCES feature_board.history(id),
  actor_id text NOT NULL,
  read_at timestamptz,
  PRIMARY KEY(event_id,actor_id)
);
CREATE INDEX board_inbox_actor ON feature_board.inbox(actor_id);

CREATE TABLE feature_board.preferences (
  actor_id text PRIMARY KEY,
  notifications boolean NOT NULL DEFAULT false
);

CREATE TABLE feature_board.reports (
  id uuid PRIMARY KEY,
  reporter_id text NOT NULL,
  request_id uuid NOT NULL REFERENCES feature_board.requests(id),
  comment_id uuid REFERENCES feature_board.comments(id),
  reason text NOT NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX board_unique_report ON feature_board.reports(reporter_id,request_id,COALESCE(comment_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE feature_board.audit (
  id uuid PRIMARY KEY,
  actor_id text,
  action text NOT NULL,
  request_id uuid REFERENCES feature_board.requests(id),
  comment_id uuid REFERENCES feature_board.comments(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_board.limits (
  actor_id text NOT NULL,
  action text NOT NULL,
  count integer NOT NULL,
  until timestamptz NOT NULL,
  PRIMARY KEY(actor_id,action)
);
COMMIT;
