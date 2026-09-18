# KomoBasket production site baseline

Release: root-phase competition participants, including the Καμία predecessor option.
Active Cloudflare deployment: ad96f7e6-b68d-41bf-b98a-16164acdee78
Active Cloudflare version: b801d3f8-ffd3-4921-90ec-fac47d5d66a1 (100% traffic).
Production D1: 34 applied migrations, 0 pending, quick_check ok, 0 FK violations.

site-source-sha256.txt inventories current local website/Worker source, configuration, public assets, and canonical SQL migrations. It excludes tests, desktop runtime, generated artifacts, credentials, and backups.
The source checkpoint is a monorepo commit and may include KomoControl source; the hash inventory is site-only.
The JSON git_commit records the initial source checkpoint. The annotated git_tag points to the final metadata commit.
This checkpoint documents the accepted release state; it is not a cryptographic equivalence proof between local source and the deployed Worker artifact.
No build, deploy, migration, production write, or Git push is part of this baseline operation.
