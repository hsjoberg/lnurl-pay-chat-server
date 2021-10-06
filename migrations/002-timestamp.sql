-- Up
ALTER TABLE `message` ADD `timestamp` INTEGER;

-- Down
ALTER TABLE `message` DROP COLUMN `timestamp`; -- WARNING: Support was added in SQLite 3.35.0
