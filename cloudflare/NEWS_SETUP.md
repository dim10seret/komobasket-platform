# KomoBasket News administration

The site is ready to use local JSON storage during `next dev`. Production uses:

- D1 binding `NEWS_DB`
- R2 binding `NEWS_IMAGES` (cover images and post attachments)
- environment variable `ADMIN_EMAIL`
- Cloudflare Access in front of `/admin*` and `/api/admin/*`

## Production resources

1. Create a D1 database named `komobasket-news`.
2. Apply `cloudflare/news-schema.sql`.
3. Create an R2 bucket named `komobasket-news-assets`. The same private bucket
   stores cover images and post attachments; files are served only through the
   site's checked API routes.
4. Add both bindings to the production `wrangler.jsonc`. The required fragment is
   in `cloudflare/wrangler-news-bindings.example.jsonc`.
5. Add `ADMIN_EMAIL=komobasketleague@gmail.com` as a production variable.
6. In Cloudflare Zero Trust, create a self-hosted Access application that protects
   both `/admin*` and `/api/admin/*`, allowing only the administrator email.

When the database already exists, apply `cloudflare/news-schema.sql` again before
deploying this version. The script uses `CREATE TABLE IF NOT EXISTS`, so it keeps
all existing articles and adds only the attachments table and index.

The API checks the Cloudflare Access email and Access token again before every
write operation. The public news routes never expose drafts.
