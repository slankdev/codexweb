CREATE TABLE IF NOT EXISTS `tasks` (
  `id` VARCHAR(36) NOT NULL,
  `title` TEXT NOT NULL,
  `prompt` TEXT NOT NULL,
  `cwd` TEXT NOT NULL,
  `model` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tasks_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_events` (
  `seq` BIGINT NOT NULL AUTO_INCREMENT,
  `id` VARCHAR(36) NOT NULL,
  `task_id` VARCHAR(36) NOT NULL,
  `ts` BIGINT NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `payload` JSON NOT NULL,
  PRIMARY KEY (`seq`),
  UNIQUE KEY `uniq_id` (`id`),
  KEY `idx_task_seq` (`task_id`, `seq`),
  CONSTRAINT `fk_task_events_task`
    FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
