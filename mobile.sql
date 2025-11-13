-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 13, 2025 at 10:22 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `mobile`
--

-- --------------------------------------------------------

--
-- Table structure for table `asset`
--

CREATE TABLE `asset` (
  `asset_id` smallint(6) UNSIGNED NOT NULL,
  `asset_name` varchar(20) NOT NULL,
  `asset_status` enum('Available','Pending','Borrowed','Disabled') NOT NULL DEFAULT 'Available',
  `description` varchar(255) DEFAULT NULL,
  `image` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `asset`
--

INSERT INTO `asset` (`asset_id`, `asset_name`, `asset_status`, `description`, `image`) VALUES
(56, 'basketball', 'Borrowed', 'Sport Equipment', '/public/image/basketball.png'),
(57, 'badminton', 'Available', 'Sport Equipment', '/public/image/badminton.png'),
(58, 'volleyball', 'Available', 'Sport Equipment', '/public/image/volleyball.png'),
(59, 'football', 'Available', 'Sport Equipment', '/public/image/football.png');

-- --------------------------------------------------------

--
-- Table structure for table `request_log`
--

CREATE TABLE `request_log` (
  `request_id` smallint(6) UNSIGNED NOT NULL,
  `borrower_id` smallint(6) UNSIGNED NOT NULL,
  `asset_id` smallint(6) UNSIGNED NOT NULL,
  `borrow_date` date NOT NULL,
  `return_date` date NOT NULL,
  `approval_status` enum('Pending','Approved','Rejected') DEFAULT 'Pending',
  `lender_id` smallint(6) UNSIGNED DEFAULT NULL,
  `approval_date` date DEFAULT NULL,
  `staff_id` smallint(6) UNSIGNED DEFAULT NULL,
  `return_status` enum('Not Returned','Requested Return','Returned') DEFAULT 'Not Returned',
  `actual_return_date` date DEFAULT NULL,
  `can_borrow_today` int(5) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `request_log`
--

INSERT INTO `request_log` (`request_id`, `borrower_id`, `asset_id`, `borrow_date`, `return_date`, `approval_status`, `lender_id`, `approval_date`, `staff_id`, `return_status`, `actual_return_date`, `can_borrow_today`) VALUES
(89, 23, 56, '2025-11-11', '2025-11-18', 'Approved', NULL, NULL, 18, 'Returned', '2025-11-11', 1),
(96, 24, 56, '2025-11-13', '2025-11-20', 'Approved', 21, NULL, NULL, 'Not Returned', NULL, 0),
(97, 16, 57, '2025-11-13', '2025-11-20', 'Rejected', 21, NULL, NULL, 'Not Returned', NULL, 1),
(103, 16, 57, '2025-11-13', '2025-11-20', 'Rejected', NULL, NULL, NULL, 'Not Returned', NULL, 0);

--
-- Triggers `request_log`
--
DELIMITER $$
CREATE TRIGGER `after_asset_return` AFTER UPDATE ON `request_log` FOR EACH ROW BEGIN
    IF OLD.return_status <> 'Returned' AND NEW.return_status = 'Returned' THEN
        UPDATE asset
        SET asset_status = 'Available'
        WHERE asset_id = NEW.asset_id;
    END IF;
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `after_request_approval` AFTER UPDATE ON `request_log` FOR EACH ROW BEGIN
    -- ทำงานเฉพาะตอน approval_status เปลี่ยนจริง
    IF OLD.approval_status <> 'Approved' AND NEW.approval_status = 'Approved' THEN
        UPDATE asset
        SET asset_status = 'Borrowed'
        WHERE asset_id = NEW.asset_id;
    ELSEIF OLD.approval_status <> 'Rejected' AND NEW.approval_status = 'Rejected' THEN
        UPDATE asset
        SET asset_status = 'Available'
        WHERE asset_id = NEW.asset_id;
    END IF;

END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `user`
--

CREATE TABLE `user` (
  `user_id` smallint(6) UNSIGNED NOT NULL,
  `email` varchar(50) NOT NULL,
  `username` varchar(20) NOT NULL,
  `password` varchar(60) NOT NULL,
  `role` tinyint(3) UNSIGNED NOT NULL COMMENT '1=student 2=staff 3=lender'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `user`
--

INSERT INTO `user` (`user_id`, `email`, `username`, `password`, `role`) VALUES
(16, 'test@gamil.com', 'Toon', '$2b$10$i81X/3Xy.j9AQ9INrUmhXucmxhSRD853yda/3mSDbt08TagjfcX2K', 1),
(18, 'boss@gmail.com', 'boss', '$2b$10$iHhk7XBZ2tTG2KTYZ9P/8uyoUtrmAwg4SsfiHZTS4U9r/PaFq1w9y', 2),
(19, 'Aom@gmail.com', 'Aom', '$2b$10$3CTAIxOLOfPkBHv9FoVSiutMqOapQi9FdT//aU0r.zo502wnZ8j1K', 1),
(21, 'lender@gmail.com', 'lender', '$2b$10$ZPWz1wLI844NvtZdnHubRu7FXGbWTf92tkiKSxnQNZjWQ5gshRf3.', 3),
(22, 'p@gmail.com', 'p', '$2b$10$strGIlOEeJRKzo4iLWtFMuTHOtRkAk1gI//X3TLSRsWrHKyGilhR.', 1),
(23, 'bb@gmail.com', 'bb', '$2b$10$mL2HImMFTXKWpxCqZoWFY.EdDDQ9DbOupvsr8WYF6VBLUxYo2JNVa', 1),
(24, 'Time@gmail.com', 'Time', '$2b$10$Co2M8qLO1BsSwNBtWKSZ5.Dj7OWe9.ZduKrQpQ5vAUmdUu4o7OFsS', 1),
(25, 'staff@gmail.com', 'staff', '$2b$10$MI4byqUv.34a25ScvxfzhOaCsyAnltZHRmtM/292NCjZ8F85.IYh2', 2);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `asset`
--
ALTER TABLE `asset`
  ADD PRIMARY KEY (`asset_id`);

--
-- Indexes for table `request_log`
--
ALTER TABLE `request_log`
  ADD PRIMARY KEY (`request_id`),
  ADD UNIQUE KEY `request_id` (`request_id`),
  ADD KEY `borrower_id` (`borrower_id`),
  ADD KEY `asset_id` (`asset_id`),
  ADD KEY `fk_approve_by_lender` (`lender_id`),
  ADD KEY `fk_staff_id` (`staff_id`);

--
-- Indexes for table `user`
--
ALTER TABLE `user`
  ADD PRIMARY KEY (`user_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `asset`
--
ALTER TABLE `asset`
  MODIFY `asset_id` smallint(6) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=60;

--
-- AUTO_INCREMENT for table `request_log`
--
ALTER TABLE `request_log`
  MODIFY `request_id` smallint(6) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=104;

--
-- AUTO_INCREMENT for table `user`
--
ALTER TABLE `user`
  MODIFY `user_id` smallint(6) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=26;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `request_log`
--
ALTER TABLE `request_log`
  ADD CONSTRAINT `fk_approve_by_lender` FOREIGN KEY (`lender_id`) REFERENCES `user` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_staff_id` FOREIGN KEY (`staff_id`) REFERENCES `user` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `request_log_ibfk_1` FOREIGN KEY (`borrower_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `request_log_ibfk_2` FOREIGN KEY (`asset_id`) REFERENCES `asset` (`asset_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `request_log_ibfk_3` FOREIGN KEY (`lender_id`) REFERENCES `user` (`user_id`) ON DELETE SET NULL;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
