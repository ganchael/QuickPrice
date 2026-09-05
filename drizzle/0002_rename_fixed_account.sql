UPDATE `catalogs`
SET `user_id` = 'account:888'
WHERE `user_id` = 'account:zlw';
--> statement-breakpoint
DELETE FROM `auth_sessions`;
