-- Up
CREATE TABLE `message` (
  `id`     INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `text`   TEXT NOT NULL
);

-- Down
DROP TABLE `message`;