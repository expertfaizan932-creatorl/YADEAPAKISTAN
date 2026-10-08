-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Aug 09, 2026 at 06:37 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `evee_crm`
--

-- --------------------------------------------------------

--
-- Table structure for table `appointments`
--

CREATE TABLE `appointments` (
  `id` int(10) UNSIGNED NOT NULL,
  `contact_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL DEFAULT '',
  `calendar` varchar(150) NOT NULL DEFAULT '',
  `host` varchar(120) NOT NULL DEFAULT '',
  `date` varchar(20) NOT NULL DEFAULT '',
  `start_time` varchar(20) NOT NULL DEFAULT '',
  `end_time` varchar(20) NOT NULL DEFAULT '',
  `location` varchar(150) NOT NULL DEFAULT '',
  `status` varchar(50) NOT NULL DEFAULT 'Completed',
  `notes` text DEFAULT NULL,
  `category` varchar(20) NOT NULL DEFAULT 'past',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `appointments`
--

INSERT INTO `appointments` (`id`, `contact_id`, `title`, `calendar`, `host`, `date`, `start_time`, `end_time`, `location`, `status`, `notes`, `category`, `created_at`) VALUES
(3, 12, 'Test Ride & Sales Consultation', 'Sales Consultation Calendar', 'Asad B Zaman', '2026-08-08', '10:00 AM', '10:30 AM', 'Google Meet Video Link', 'Completed', 'Customer requested a test ride for Evee electric scooter model.', 'past', '2026-08-09 17:58:29'),
(4, 12, 'Out of office / Slot Blocked', 'General Support Calendar', 'Asad B Zaman', '2026-08-09', '09:00 AM', '05:00 PM', 'Calendar Lock', 'Blocked', NULL, 'past', '2026-08-09 17:58:39');

-- --------------------------------------------------------

--
-- Table structure for table `contacts`
--

CREATE TABLE `contacts` (
  `id` int(10) UNSIGNED NOT NULL,
  `first_name` varchar(100) NOT NULL DEFAULT '',
  `last_name` varchar(100) NOT NULL DEFAULT '',
  `full_name` varchar(201) GENERATED ALWAYS AS (concat(`first_name`,' ',`last_name`)) STORED,
  `phone` varchar(40) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `business_name` varchar(190) DEFAULT NULL,
  `contact_type` enum('','Lead','Customer','Vendor','Partner') NOT NULL DEFAULT '',
  `is_lead` tinyint(1) NOT NULL DEFAULT 0,
  `avatar_color` varchar(60) NOT NULL DEFAULT 'bg-emerald-200 text-emerald-800',
  `avatar_data` mediumtext DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_activity_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `contacts`
--

INSERT INTO `contacts` (`id`, `first_name`, `last_name`, `phone`, `email`, `business_name`, `contact_type`, `is_lead`, `avatar_color`, `avatar_data`, `notes`, `created_at`, `last_activity_at`, `updated_at`) VALUES
(1, 'Muhammad', 'Faizan', '0371 1520951', 'faizan@gmail.com', 'Evee', 'Lead', 1, 'bg-emerald-200 text-emerald-800', NULL, NULL, '2026-08-08 15:50:00', NULL, '2026-08-08 22:41:47'),
(2, 'Tahira', 'Abbas', '0371 1520051', 'orixzylum@gmail.com', NULL, '', 0, 'bg-sky-200 text-sky-800', NULL, NULL, '2026-08-08 14:06:00', NULL, '2026-08-08 22:41:47'),
(3, '(Example) Casey', 'Mo...', '+16541234567', NULL, '(Example) Dunder Miff...', '', 0, 'bg-purple-200 text-purple-800', NULL, NULL, '2026-08-08 13:32:00', NULL, '2026-08-08 22:41:47'),
(4, '(Example) Taylor', 'Re...', '+178655689546', NULL, '(Example) MacLaren\'s...', '', 0, 'bg-sky-200 text-sky-800', NULL, NULL, '2026-08-08 13:32:00', NULL, '2026-08-08 22:41:47'),
(5, '(Example) Jordan', 'S...', NULL, 'jordan.smith@exampl...', '(Example) MacLaren\'s...', '', 0, 'bg-blue-200 text-blue-800', NULL, NULL, '2026-08-08 13:32:00', NULL, '2026-08-08 22:41:47'),
(6, '(Example) Alex', 'Doe ...', NULL, 'alex.carter@business...', '(Example) Goliath Nati...', '', 0, 'bg-indigo-200 text-indigo-800', NULL, NULL, '2026-08-08 13:31:00', NULL, '2026-08-08 22:41:47'),
(7, '(Example) Riley', 'Ben...', '+13141236547', 'riley.bennett@corpor...', '(Example) Goliath Nati...', 'Lead', 1, 'bg-emerald-200 text-emerald-800', NULL, NULL, '2026-08-08 13:31:00', NULL, '2026-08-08 22:41:47'),
(9, 'Waheed', 'Muraad', '+92 3249837880', 'waheed@gmail.com', NULL, 'Lead', 1, 'bg-purple-200 text-purple-800', NULL, NULL, '2026-08-08 22:53:21', NULL, '2026-08-08 22:53:21'),
(12, 'John', 'Doe', NULL, NULL, NULL, 'Lead', 1, 'bg-amber-200 text-amber-800', NULL, NULL, '2026-08-08 23:03:22', NULL, '2026-08-08 23:03:22');

-- --------------------------------------------------------

--
-- Table structure for table `contact_tags`
--

CREATE TABLE `contact_tags` (
  `contact_id` int(10) UNSIGNED NOT NULL,
  `tag_id` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `contact_tags`
--

INSERT INTO `contact_tags` (`contact_id`, `tag_id`) VALUES
(1, 1),
(3, 4),
(3, 5),
(4, 4),
(5, 4),
(6, 4),
(7, 1),
(7, 5),
(9, 6),
(12, 6);

-- --------------------------------------------------------

--
-- Table structure for table `notes`
--

CREATE TABLE `notes` (
  `id` int(10) UNSIGNED NOT NULL,
  `contact_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL DEFAULT 'Note',
  `content` text DEFAULT NULL,
  `author` varchar(120) NOT NULL DEFAULT 'Asad B Zaman',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `opportunities`
--

CREATE TABLE `opportunities` (
  `id` int(10) UNSIGNED NOT NULL,
  `contact_id` int(10) UNSIGNED NOT NULL,
  `name` varchar(255) NOT NULL DEFAULT '',
  `pipeline` varchar(100) NOT NULL DEFAULT 'Marketing Pipeline',
  `stage` varchar(100) NOT NULL DEFAULT 'New Lead',
  `status` varchar(50) NOT NULL DEFAULT 'Open',
  `value` varchar(100) NOT NULL DEFAULT 'Rs 0',
  `business_name` varchar(255) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `opportunities`
--

INSERT INTO `opportunities` (`id`, `contact_id`, `name`, `pipeline`, `stage`, `status`, `value`, `business_name`, `created_at`) VALUES
(2, 12, 'John Doe', 'Marketing Pipeline', 'New Lead', 'Open', 'Rs 0', 'Evee', '2026-08-09 17:53:05');

-- --------------------------------------------------------

--
-- Table structure for table `tags`
--

CREATE TABLE `tags` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(60) NOT NULL,
  `color` varchar(30) NOT NULL DEFAULT 'bg-slate-100 text-slate-600'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `tags`
--

INSERT INTO `tags` (`id`, `name`, `color`) VALUES
(1, 'warm lead', 'bg-amber-50 text-amber-700'),
(2, 'hot lead', 'bg-rose-50 text-rose-700'),
(3, 'cold lead', 'bg-slate-100 text-slate-600'),
(4, 'follow-up', 'bg-blue-50 text-blue-700'),
(5, 'customer', 'bg-green-50 text-green-700'),
(6, 'lead', 'bg-slate-100 text-slate-600');

-- --------------------------------------------------------

--
-- Table structure for table `tasks`
--

CREATE TABLE `tasks` (
  `id` int(10) UNSIGNED NOT NULL,
  `contact_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL DEFAULT '',
  `status` varchar(50) NOT NULL DEFAULT 'Pending',
  `due_date` varchar(120) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_contacts_with_tags`
-- (See below for the actual view)
--
CREATE TABLE `v_contacts_with_tags` (
`id` int(10) unsigned
,`name` varchar(201)
,`first_name` varchar(100)
,`last_name` varchar(100)
,`phone` varchar(40)
,`email` varchar(190)
,`business_name` varchar(190)
,`contact_type` enum('','Lead','Customer','Vendor','Partner')
,`is_lead` tinyint(1)
,`avatar_color` varchar(60)
,`avatar_data` mediumtext
,`notes` text
,`created_at` datetime
,`last_activity_at` datetime
,`updated_at` datetime
,`tags` mediumtext
,`tag_ids` mediumtext
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_leads`
-- (See below for the actual view)
--
CREATE TABLE `v_leads` (
`id` int(10) unsigned
,`name` varchar(201)
,`first_name` varchar(100)
,`last_name` varchar(100)
,`phone` varchar(40)
,`email` varchar(190)
,`business_name` varchar(190)
,`contact_type` enum('','Lead','Customer','Vendor','Partner')
,`is_lead` tinyint(1)
,`avatar_color` varchar(60)
,`avatar_data` mediumtext
,`notes` text
,`created_at` datetime
,`last_activity_at` datetime
,`updated_at` datetime
,`tags` mediumtext
,`tag_ids` mediumtext
);

-- --------------------------------------------------------

--
-- Structure for view `v_contacts_with_tags`
--
DROP TABLE IF EXISTS `v_contacts_with_tags`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v_contacts_with_tags`  AS SELECT `c`.`id` AS `id`, `c`.`full_name` AS `name`, `c`.`first_name` AS `first_name`, `c`.`last_name` AS `last_name`, `c`.`phone` AS `phone`, `c`.`email` AS `email`, `c`.`business_name` AS `business_name`, `c`.`contact_type` AS `contact_type`, `c`.`is_lead` AS `is_lead`, `c`.`avatar_color` AS `avatar_color`, `c`.`avatar_data` AS `avatar_data`, `c`.`notes` AS `notes`, `c`.`created_at` AS `created_at`, `c`.`last_activity_at` AS `last_activity_at`, `c`.`updated_at` AS `updated_at`, coalesce(group_concat(`t`.`name` order by `t`.`name` ASC separator ','),'') AS `tags`, coalesce(group_concat(`t`.`id` order by `t`.`name` ASC separator ','),'') AS `tag_ids` FROM ((`contacts` `c` left join `contact_tags` `ct` on(`ct`.`contact_id` = `c`.`id`)) left join `tags` `t` on(`t`.`id` = `ct`.`tag_id`)) GROUP BY `c`.`id` ;

-- --------------------------------------------------------

--
-- Structure for view `v_leads`
--
DROP TABLE IF EXISTS `v_leads`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v_leads`  AS SELECT `v_contacts_with_tags`.`id` AS `id`, `v_contacts_with_tags`.`name` AS `name`, `v_contacts_with_tags`.`first_name` AS `first_name`, `v_contacts_with_tags`.`last_name` AS `last_name`, `v_contacts_with_tags`.`phone` AS `phone`, `v_contacts_with_tags`.`email` AS `email`, `v_contacts_with_tags`.`business_name` AS `business_name`, `v_contacts_with_tags`.`contact_type` AS `contact_type`, `v_contacts_with_tags`.`is_lead` AS `is_lead`, `v_contacts_with_tags`.`avatar_color` AS `avatar_color`, `v_contacts_with_tags`.`avatar_data` AS `avatar_data`, `v_contacts_with_tags`.`notes` AS `notes`, `v_contacts_with_tags`.`created_at` AS `created_at`, `v_contacts_with_tags`.`last_activity_at` AS `last_activity_at`, `v_contacts_with_tags`.`updated_at` AS `updated_at`, `v_contacts_with_tags`.`tags` AS `tags`, `v_contacts_with_tags`.`tag_ids` AS `tag_ids` FROM `v_contacts_with_tags` WHERE `v_contacts_with_tags`.`is_lead` = 1 OR `v_contacts_with_tags`.`contact_type` = 'Lead' OR find_in_set('warm lead',`v_contacts_with_tags`.`tags`) OR find_in_set('hot lead',`v_contacts_with_tags`.`tags`) OR find_in_set('cold lead',`v_contacts_with_tags`.`tags`) ;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `appointments`
--
ALTER TABLE `appointments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_appt_contact` (`contact_id`);

--
-- Indexes for table `contacts`
--
ALTER TABLE `contacts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_contact_phone` (`phone`),
  ADD KEY `idx_contact_email` (`email`),
  ADD KEY `idx_contact_name` (`last_name`,`first_name`),
  ADD KEY `idx_contact_type` (`contact_type`),
  ADD KEY `idx_contact_lead` (`is_lead`),
  ADD KEY `idx_contact_created` (`created_at`),
  ADD KEY `idx_contact_activity` (`last_activity_at`);
ALTER TABLE `contacts` ADD FULLTEXT KEY `ft_contact_search` (`first_name`,`last_name`,`email`,`business_name`);

--
-- Indexes for table `contact_tags`
--
ALTER TABLE `contact_tags`
  ADD PRIMARY KEY (`contact_id`,`tag_id`),
  ADD KEY `idx_contact_tags_tag` (`tag_id`);

--
-- Indexes for table `notes`
--
ALTER TABLE `notes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_note_contact` (`contact_id`);

--
-- Indexes for table `opportunities`
--
ALTER TABLE `opportunities`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_opp_contact` (`contact_id`);

--
-- Indexes for table `tags`
--
ALTER TABLE `tags`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_tag_name` (`name`);

--
-- Indexes for table `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_task_contact` (`contact_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `appointments`
--
ALTER TABLE `appointments`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `contacts`
--
ALTER TABLE `contacts`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `notes`
--
ALTER TABLE `notes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `opportunities`
--
ALTER TABLE `opportunities`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `tags`
--
ALTER TABLE `tags`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `appointments`
--
ALTER TABLE `appointments`
  ADD CONSTRAINT `fk_appt_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `contact_tags`
--
ALTER TABLE `contact_tags`
  ADD CONSTRAINT `fk_ct_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ct_tag` FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `notes`
--
ALTER TABLE `notes`
  ADD CONSTRAINT `fk_note_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `opportunities`
--
ALTER TABLE `opportunities`
  ADD CONSTRAINT `fk_opp_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `fk_task_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
