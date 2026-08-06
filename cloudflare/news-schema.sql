CREATE TABLE IF NOT EXISTS news_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  content TEXT NOT NULL,
  season TEXT,
  category TEXT NOT NULL DEFAULT 'Ανακοίνωση',
  cover_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author_email TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_articles_status_date
  ON news_articles (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_articles_slug
  ON news_articles (slug);

CREATE TABLE IF NOT EXISTS news_attachments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_news_attachments_article_position
  ON news_attachments (article_id, position ASC);
