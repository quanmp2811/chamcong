CREATE DATABASE IF NOT EXISTS cham_cong
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cham_cong;

CREATE TABLE IF NOT EXISTS stores (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  city VARCHAR(255) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS nhan_vien (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  store_code VARCHAR(64) DEFAULT NULL,
  role VARCHAR(255) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS cham_cong (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) DEFAULT NULL,
  employee_code VARCHAR(64) DEFAULT NULL,
  employee_name VARCHAR(255) DEFAULT NULL,
  ten VARCHAR(64) NOT NULL,
  time DATETIME NOT NULL,
  status VARCHAR(50) DEFAULT 'present',
  note TEXT DEFAULT NULL,
  INDEX idx_cham_cong_time (time),
  INDEX idx_cham_cong_store (ten),
  INDEX idx_cham_cong_employee (employee_id)
);
