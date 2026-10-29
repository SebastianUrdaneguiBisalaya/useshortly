DROP TRIGGER IF EXISTS trg_channels_detach_links;
DROP INDEX IF EXISTS idx_links_channel_id;
ALTER TABLE links DROP COLUMN channel_id;
DROP INDEX IF EXISTS idx_channels_campaign_name;
DROP TABLE IF EXISTS channels;
DROP INDEX IF EXISTS idx_campaigns_tenant_name;
DROP TABLE IF EXISTS campaigns;
