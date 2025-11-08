-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 07, 2025 at 05:09 AM
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
(46, 'Badminton', 'Available', NULL, 'asset/image/batminton.png');

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
  `actual_return_date` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `request_log`
--

INSERT INTO `request_log` (`request_id`, `borrower_id`, `asset_id`, `borrow_date`, `return_date`, `approval_status`, `lender_id`, `approval_date`, `staff_id`, `return_status`, `actual_return_date`) VALUES
(60, 16, 46, '2025-11-07', '2025-11-14', 'Approved', NULL, NULL, NULL, 'Returned', NULL);

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
(16, 'test@gamil.com', 'Toon', '$2b$10$i81X/3Xy.j9AQ9INrUmhXucmxhSRD853yda/3mSDbt08TagjfcX2K', 1);

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
  MODIFY `asset_id` smallint(6) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=47;

--
-- AUTO_INCREMENT for table `request_log`
--
ALTER TABLE `request_log`
  MODIFY `request_id` smallint(6) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=61;

--
-- AUTO_INCREMENT for table `user`
--
ALTER TABLE `user`
  MODIFY `user_id` smallint(6) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=17;

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
