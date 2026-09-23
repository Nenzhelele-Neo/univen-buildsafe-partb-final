-- MySQL 8.0+. The setup script selects the database named by DB_NAME.
-- BIGINT retains existing timestamp IDs; AUTO_INCREMENT supplies new IDs.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(64) NULL,
  name VARCHAR(150) NOT NULL,
  location VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  latitude DECIMAL(11,8) NULL,
  longitude DECIMAL(11,8) NULL,
  photo_url VARCHAR(512) NULL,
  published_title VARCHAR(255) NULL,
  published_category VARCHAR(64) NULL,
  published_work_type VARCHAR(20) NULL,
  published_status VARCHAR(20) NULL,
  published_location VARCHAR(255) NULL,
  published_description TEXT NULL,
  published_affected_area VARCHAR(255) NULL,
  published_start_date DATE NULL,
  published_end_date DATE NULL,
  published_latitude DECIMAL(11,8) NULL,
  published_longitude DECIMAL(11,8) NULL,
  published_show_on_map BOOLEAN NULL,
  published_type VARCHAR(20) NULL,
  published_item_id BIGINT UNSIGNED NULL,
  published_notice_id BIGINT UNSIGNED NULL,
  KEY idx_reports_status_date (status, date),
  KEY idx_reports_publication (published_type, published_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Publication pointers in reports are polymorphic application-managed references.
-- No reverse FK: it would introduce a circular insert/delete dependency.
-- A report has at most one publication in each table; transactions enforce one type.
CREATE TABLE IF NOT EXISTS projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL,
  work_type VARCHAR(20) NOT NULL DEFAULT 'Construction',
  start_date DATE NULL,
  end_date DATE NULL,
  affected_area VARCHAR(255) NOT NULL DEFAULT '',
  latitude DECIMAL(11,8) NULL,
  longitude DECIMAL(11,8) NULL,
  source_report_id BIGINT UNSIGNED NULL,
  photo_url VARCHAR(512) NULL,
  UNIQUE KEY uq_projects_report (source_report_id),
  KEY idx_projects_status (status),
  CONSTRAINT fk_projects_report FOREIGN KEY (source_report_id)
    REFERENCES reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(64) NULL,
  location VARCHAR(255) NULL,
  message TEXT NOT NULL,
  date DATE NOT NULL,
  latitude DECIMAL(11,8) NULL,
  longitude DECIMAL(11,8) NULL,
  show_on_map BOOLEAN NOT NULL DEFAULT FALSE,
  photo_url VARCHAR(512) NULL,
  source_report_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_announcements_report (source_report_id),
  KEY idx_announcements_date (date, id),
  CONSTRAINT fk_announcements_report FOREIGN KEY (source_report_id)
    REFERENCES reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campus_locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NULL,
  latitude DECIMAL(11,8) NOT NULL,
  longitude DECIMAL(11,8) NOT NULL,
  KEY idx_locations_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS routes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  route_name VARCHAR(255) NOT NULL,
  start_location_id BIGINT UNSIGNED NOT NULL,
  end_location_id BIGINT UNSIGNED NOT NULL,
  route_type VARCHAR(32) NOT NULL,
  distance_meters DECIMAL(10,2) NOT NULL,
  estimated_minutes DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Open',
  pedestrian_accessible BOOLEAN NOT NULL DEFAULT FALSE,
  vehicle_accessible BOOLEAN NOT NULL DEFAULT FALSE,
  path_coordinates JSON NOT NULL,
  affected_areas JSON NOT NULL,
  KEY idx_routes_end (end_location_id),
  KEY idx_routes_start (start_location_id),
  CONSTRAINT fk_routes_start FOREIGN KEY (start_location_id)
    REFERENCES campus_locations (id),
  CONSTRAINT fk_routes_end FOREIGN KEY (end_location_id)
    REFERENCES campus_locations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
