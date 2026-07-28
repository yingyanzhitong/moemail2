WITH RECURSIVE
`periods` AS (
  SELECT
    `period`.`id`,
    `period`.`license_id`,
    `period`.`starts_at` AS `old_starts_at`,
    CAST((`period`.`expires_at` - `period`.`starts_at`) / 86400000 AS INTEGER) AS `duration_days`
  FROM `desktop_license_periods` AS `period`
  JOIN `desktop_licenses` AS `license` ON `license`.`id` = `period`.`license_id`
  WHERE `license`.`status` = 'active'
    AND `period`.`expires_at` > CAST(strftime('%s', 'now') AS INTEGER) * 1000
),
`fixed` (`id`, `license_id`, `old_starts_at`, `starts_at`, `expires_at`) AS (
  SELECT
    `period`.`id`,
    `period`.`license_id`,
    `period`.`old_starts_at`,
    `period`.`old_starts_at`,
    CASE WHEN `period`.`duration_days` % 30 = 0 THEN
      CAST(strftime('%s', date(
        `period`.`old_starts_at` / 1000,
        'unixepoch',
        'start of month',
        printf('+%d months', `period`.`duration_days` / 30),
        printf('+%d days', MIN(
          CAST(strftime('%d', datetime(`period`.`old_starts_at` / 1000, 'unixepoch')) AS INTEGER),
          CAST(strftime('%d', date(`period`.`old_starts_at` / 1000, 'unixepoch', 'start of month', printf('+%d months', `period`.`duration_days` / 30 + 1), '-1 day')) AS INTEGER)
        ) - 1)
      )) AS INTEGER) * 1000 + (`period`.`old_starts_at` % 86400000)
    ELSE `period`.`old_starts_at` + `period`.`duration_days` * 86400000 END
  FROM `periods` AS `period`
  WHERE `period`.`old_starts_at` = (
    SELECT MIN(`first_period`.`old_starts_at`)
    FROM `periods` AS `first_period`
    WHERE `first_period`.`license_id` = `period`.`license_id`
  )

  UNION ALL

  SELECT
    `period`.`id`,
    `period`.`license_id`,
    `period`.`old_starts_at`,
    `fixed`.`expires_at`,
    CASE WHEN `period`.`duration_days` % 30 = 0 THEN
      CAST(strftime('%s', date(
        `fixed`.`expires_at` / 1000,
        'unixepoch',
        'start of month',
        printf('+%d months', `period`.`duration_days` / 30),
        printf('+%d days', MIN(
          CAST(strftime('%d', datetime(`fixed`.`expires_at` / 1000, 'unixepoch')) AS INTEGER),
          CAST(strftime('%d', date(`fixed`.`expires_at` / 1000, 'unixepoch', 'start of month', printf('+%d months', `period`.`duration_days` / 30 + 1), '-1 day')) AS INTEGER)
        ) - 1)
      )) AS INTEGER) * 1000 + (`fixed`.`expires_at` % 86400000)
    ELSE `fixed`.`expires_at` + `period`.`duration_days` * 86400000 END
  FROM `fixed`
  JOIN `periods` AS `period`
    ON `period`.`license_id` = `fixed`.`license_id`
    AND `period`.`old_starts_at` = (
      SELECT MIN(`next_period`.`old_starts_at`)
      FROM `periods` AS `next_period`
      WHERE `next_period`.`license_id` = `fixed`.`license_id`
        AND `next_period`.`old_starts_at` > `fixed`.`old_starts_at`
    )
)
UPDATE `desktop_license_periods` AS `period`
SET
  `starts_at` = (SELECT `starts_at` FROM `fixed` WHERE `fixed`.`id` = `period`.`id`),
  `expires_at` = (SELECT `expires_at` FROM `fixed` WHERE `fixed`.`id` = `period`.`id`)
WHERE `period`.`id` IN (SELECT `id` FROM `fixed`)
  AND (
    `period`.`starts_at` != (SELECT `starts_at` FROM `fixed` WHERE `fixed`.`id` = `period`.`id`)
    OR `period`.`expires_at` != (SELECT `expires_at` FROM `fixed` WHERE `fixed`.`id` = `period`.`id`)
  );
